# 07 — Data flows

End-to-end walkthroughs of the most important business flows. Each shows: HTTP entry, service orchestration, transactional boundary, events emitted, and side-effects.

> Section index: [Request lifecycle](#request-lifecycle) · [Clerk user sync](#clerk-user-sync) · [Checkout](#checkout) · [Payment webhook](#payment-webhook) · [Refund](#refund) · [Review submission](#review-submission)

## Request lifecycle

Every authenticated request travels this path. Understanding the order matters when you're debugging "why didn't my guard fire" or "why did the response envelope wrap an error".

```
1.  Client sends HTTPS request → Authorization: Bearer <clerkSessionToken>
2.  Fastify hooks (registered in main.ts before Nest takes over):
      - @fastify/helmet (security headers)
      - @fastify/cors (allow only WEB_URL_ORIGIN)
      - body parser (JSON, except /webhooks/* which uses fastify-raw-body to preserve signatures)
3.  ThrottlerGuard       → 429 if over rate limit
4.  ClerkAuthGuard       → 401 if token missing/invalid (skipped on @Public routes)
5.  RolesGuard           → 403 if @Roles() doesn't match
6.  ValidationPipe       → 400 if DTO validation fails
7.  LoggingInterceptor   → start timer, log request line
8.  Controller method    → typically just calls the service
9.  Service              → may call repository, other services, or runInTransaction()
10. Repository           → Prisma query
11. PostgreSQL           → returns rows
12. Mapper               → Prisma row → DTO
13. ClassSerializerInterceptor → strips @Exclude() fields
14. TransformInterceptor → wraps in { success, data, meta? }
15. LoggingInterceptor   → log status + latency
16. Response sent
17. Domain events (post-commit) fire → consumers run
```

If anything throws between step 6 and step 16, `AllExceptionsFilter` (chained with `PrismaExceptionFilter`) catches it, logs it, and emits the error envelope.

## Clerk user sync

Sign-up, sign-in, MFA, password resets, and social providers are fully managed by [Clerk](https://clerk.com). The backend keeps a thin local `User` mirror via a webhook endpoint.

### Webhook flow (`POST /webhooks/clerk`)

```
Clerk fires event (user.created | user.updated | user.deleted | organization.*)
  ↓
POST /webhooks/clerk
  Headers: { svix-id, svix-timestamp, svix-signature }
  Body:    raw bytes
  ↓
@Public() — no ClerkAuthGuard
  ↓
AuthController.clerkWebhook(headers, rawBody)
  ↓
1. Verify signature using `svix` with CLERK_WEBHOOK_SIGNING_SECRET
     → throws on bad signature → 400
2. Parse event type:
     case 'user.created':
       UsersService.createFromClerk(event.data)
         - Create User { clerkId, email, name, avatar, status: ACTIVE, role: CUSTOMER }
         - Create Balance { userId, amount: 0 }
         - Create Cart { userId }
         - Create UserPreferences { userId }
     case 'user.updated':
       UsersService.syncFromClerk(event.data)
         - Update User { email, name, avatar } (match by clerkId)
     case 'user.deleted':
       UsersService.deactivateByClerkId(event.data.id)
         - Update User { status: INACTIVE } (or hard-delete per policy)
     case 'organization.*':
       (future — multi-tenant support)
  ↓
Return 200 { received: true }
```

### Why this pattern

- **Single source of truth**: Clerk owns identity. The local `User` table exists only for Prisma joins (orders, reviews, balance, etc.).
- **Idempotent**: `clerkId` is unique — `user.created` replays are caught by a P2002 unique constraint.
- **No credentials stored locally**: no passwords, no password hashes, no refresh tokens, no email verification tokens.
- **Email**: all transactional emails related to auth (verification, password reset, MFA) are sent by Clerk directly. App-level emails (order confirmation, refund notice) are sent via [Brevo](https://www.brevo.com).

## Checkout

This is the most complex flow. It must be atomic (all-or-nothing) and idempotent on retry.

```
POST /orders/checkout { useBalance?: boolean, shipping: ShippingDto }
  ↓
ClerkAuthGuard → user authenticated
ValidationPipe → CheckoutDto
  ↓
OrdersService.checkout(userId, dto)
  ↓
runInTransaction(tx):
  1. Load Cart with items (tx.cart.findUnique({ include: { items: { include: { product, service }}}}))
     - If cart is empty → throw BadRequestException
  2. For each item where kind === PRODUCT:
       - Verify item.product.stock >= item.quantity
       - If not → throw ConflictException("insufficient stock for <name>")
  3. Compute totals from current prices (NOT cart unitPrice — re-quote at checkout):
       subtotal = Σ (currentPrice * quantity)
       discount = 0  (or computed from coupon if added later)
       tax      = subtotal * taxRate (configurable)
       total    = subtotal - discount + tax
  4. Generate code with order-code util ("ORD-000123" style)
  5. Create ShippingInfo (from dto.shipping)
  6. Create Order { code, userId, status: PENDING, subtotal, discount, tax, total, shippingId }
  7. For each cart item, create OrderItem with PRICE SNAPSHOT (name, unitPrice, lineTotal)
  8. Create Payment { orderId, method: dto.method, status: PENDING, amount: total }
  9. For each PRODUCT item: tx.product.update({ stock: { decrement: qty }, popularity: { increment: 1 }})
  10. If dto.useBalance === true:
        - Verify Balance.amount >= total → otherwise throw ConflictException
        - tx.balance.update({ amount: { decrement: total }})
        - tx.ledgerEntry.create({ type: DEBIT, amount: total, description: "Order " + code, reference: order.id })
        - tx.payment.update({ status: CAPTURED, paidAt: now(), method: BALANCE })
        - tx.order.update({ status: PAID })
  11. Clear cart: tx.cartItem.deleteMany({ cartId })
  ↓
After tx commits:
  - emit('order.created', { orderId, userId })
  - If method !== BALANCE:
      gateway = paymentGatewayFactory(dto.method)
      intent = await gateway.createIntent(order)
      tx.payment.update({ providerId: intent.providerId })   // outside tx — separate write
      Return { order, paymentIntent: intent }
  - Else:
      Return { order, paymentIntent: null }
```

### Why each piece exists

- **Re-quote at checkout (step 3)**: cart `unitPrice` was correct when the user added the item, but a price change between then and now must take effect — or the user must be told.
- **Price snapshot in `OrderItem` (step 7)**: an order is a contract. Future price changes don't rewrite history.
- **Stock decrement inside the transaction (step 9)**: prevents two concurrent checkouts from over-selling. If you ever see negative stock, a write happened outside the transaction.
- **Balance + ledger paired (step 10)**: every motion of money has a corresponding `LedgerEntry`. Reading just `Balance.amount` gives a number; reading the ledger explains how it got there.
- **Cart cleared (step 11)**: prevents accidental double-checkout if the user double-clicks. Combined with payment idempotency on the gateway side, double-charge is prevented.
- **Event after commit**: if the transaction rolls back, no `order.created` notification is sent. Inside the transaction, an emit might fire even if a later step rolls back.

## Payment webhook

```
POST /api/v1/webhooks/:provider
  Headers: { Stripe-Signature: ... }
  Body:    raw bytes (NOT JSON-parsed — preserved by per-route raw body parser)
  ↓
PaymentsController.webhook(provider, headers, rawBody)
  ↓
gateway = paymentGatewayFactory(provider)
event   = gateway.verifyWebhook(headers, rawBody)
  → throws on bad signature → 400
  ↓
WebhookEventStore.alreadyProcessed(event.id)?
  → yes → return 200 (idempotent replay)
  → no  → continue
  ↓
runInTransaction(tx):
  1. Record event.id (so a replay is short-circuited next time)
  2. Switch on event.type:
       case 'payment.captured':
         payment = tx.payment.findUnique({ where: { providerId: event.providerId }})
         tx.payment.update({ status: CAPTURED, paidAt: now(), providerRaw: event.raw })
         OrdersService.markPaid(tx, payment.orderId)   // transitions to PAID, validates state
       case 'payment.failed':
         tx.payment.update({ status: FAILED, providerRaw: event.raw })
         OrdersService.markCancelled(tx, payment.orderId, reason: 'payment_failed')
       case 'charge.refunded':
         RefundsService.recordProviderRefund(tx, ...)
  ↓
After tx commits:
  - Emit 'order.statusChanged' or 'refund.created' as appropriate
  ↓
Return 200 { received: true }
```

### Why webhooks are special

- **Public route** (`@Public()`): the provider can't carry our Clerk session token.
- **Raw body**: `fastify-raw-body` is registered for the webhook routes *before* the global JSON parser, because signatures are computed over raw bytes. Parsing JSON destroys the signature.
- **Idempotent**: providers retry on `5xx` or timeout. Without idempotency, a retry of `payment.captured` would mark the order PAID twice and emit two notifications.
- **Don't trust the body**: signature verification must run *before* trusting any field on the event. Otherwise an attacker spoofs `payment.captured` and gets free goods.

## Refund

```
POST /refunds { orderId, amount, reason, isChargeback? }
  Auth: Admin
  ↓
RefundsService.create(adminId, dto)
  ↓
runInTransaction(tx):
  1. order = tx.order.findUnique({ orderId, include: { payment, refunds: true }})
     - If !order → 404
     - If order.status NOT IN [PAID, PROCESSING, COMPLETED] → throw ConflictException
  2. totalRefunded = sum(order.refunds.amount) + dto.amount
     - If totalRefunded > order.total → throw ConflictException("refund exceeds order total")
  3. tx.refund.create({ orderId, amount, reason, isChargeback, processedAt: now() })
  4. If totalRefunded === order.total:
       tx.order.update({ status: dto.isChargeback ? CHARGEBACK : REFUNDED })
     Else:
       (partial — order stays in current status; the refund row records the partial)
  5. If payment was captured via gateway:
       gateway.refund(payment.providerId, amount)   // OUTSIDE the DB transaction; see note below
  6. Credit user balance:
       tx.balance.upsert({ where: { userId: order.userId }, create: { ... }, update: { amount: { increment: amount }}})
       tx.ledgerEntry.create({ userId: order.userId, type: CREDIT, amount, description: 'Refund ' + order.code, reference: refund.id })
  ↓
After tx commits:
  - emit('refund.created', { refundId, orderId, userId, amount })
```

### Note on step 5

Calling the gateway is a network operation that doesn't belong inside `runInTransaction()` (it would hold the DB transaction open during a remote call). Two options:

1. **Two-phase**: write the refund row in PENDING state, commit, call the gateway, then update to PROCESSED in a second short transaction. Reconcile orphans (PENDING refunds older than N minutes) via a scheduled job.
2. **Trust the gateway later**: write the refund row, credit the balance, then call the gateway. If the gateway fails, the user has the credit but the gateway never refunded — visible in reconciliation reports.

Resolved by [ADR-0006](../decisions/0006-wallet-as-ledger.md): we use **option 2 (immediate-credit)**. The drift case is rare and surfaces in [`wallet-reconciliation.md`](../runbooks/wallet-reconciliation.md).

## Review submission

```
POST /products/:id/reviews { rating, comment }
  Auth: Authenticated (Clerk)
  ↓
ReviewsService.create(userId, productId, dto)
  ↓
1. Verify product exists and is ACTIVE
2. Verify user has a verified purchase:
     OrdersService.userPurchasedProduct(userId, productId) → boolean
     (queries OrderItem joined to Order WHERE userId AND status IN [PAID, COMPLETED])
   - If false → throw ForbiddenException
3. Try insert Review { productId, userId, rating, comment }
   - Unique (productId, userId) → P2002 if user already reviewed → ConflictException
4. Return new review
```

The unique constraint is the source of truth for "one review per (product, user)" — don't pre-check, just let the DB tell you. Pre-checking introduces a race window and an extra round trip.

## Common patterns across flows

- **Idempotency**: every external-facing action (webhooks, payment retries, double-clicks on checkout) must be safe to repeat. Either via DB-unique keys, idempotency tokens, or "already processed" tables.
- **Transaction scope**: a transaction holds DB row locks. Don't make network calls (mail, gateway, S3) inside one. Call them after commit, ideally via events.
- **Events fire after commit**: if a transaction rolls back, the event must not fire. Emit only after `runInTransaction()` returns successfully.
- **Snapshot what you sell**: `OrderItem.name`, `OrderItem.unitPrice`, `OrderItem.lineTotal` are denormalized on purpose. The product can change later — the order can't.
