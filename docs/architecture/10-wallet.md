# 10 — Wallet & ledger

Every user has exactly one wallet (`Balance`) and an append-only stream of motions (`LedgerEntry`). The wallet pays for orders when the user opts in (`useBalance: true` at checkout) and receives refund credit. Admins can manually credit/debit with a reason. This file covers the invariants, the API, the concurrency model, and reconciliation.

> Section index: [Model](#model) · [Invariants](#invariants) · [API](#api) · [Top-up](#top-up) · [Checkout debit](#checkout-debit) · [Refund credit](#refund-credit) · [Admin credit/debit](#admin-creditdebit) · [Concurrency](#concurrency) · [Reconciliation](#reconciliation) · [Edge cases](#edge-cases)

## Model

```prisma
model Balance {
  id        String       @id @default(cuid())
  userId    String       @unique
  amount    Decimal      @db.Decimal(12, 2) @default(0)
  currency  String       @default("USD")
  createdAt DateTime     @default(now())
  updatedAt DateTime     @updatedAt
  user      User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  entries   LedgerEntry[]
  @@index([userId])
}

model LedgerEntry {
  id            String     @id @default(cuid())
  userId        String                          // denormalized for fast filter
  balanceId     String
  type          LedgerType                      // CREDIT | DEBIT
  amount        Decimal    @db.Decimal(12, 2)   // always positive
  reason        String                          // free-text — "Order ORD-000123", "Manual credit (chargeback resolution)"
  reference     String?                         // orderId | refundId | adminActionId | topupId
  referenceType String?                         // 'ORDER' | 'REFUND' | 'TOPUP' | 'ADMIN_ADJUST'
  createdAt     DateTime   @default(now())
  user          User       @relation(fields: [userId], references: [id])
  balance       Balance    @relation(fields: [balanceId], references: [id], onDelete: Cascade)
  @@index([userId, createdAt])
  @@index([referenceType, reference])
}

enum LedgerType {
  CREDIT
  DEBIT
}
```

`Balance.amount` is the **only** mutable money field on a user. Everything else (orders, payments, refunds) holds its own immutable snapshots.

## Invariants

Application-level rules — the schema can't enforce them, services must:

1. **Every motion is paired.** Any change to `Balance.amount` writes exactly one `LedgerEntry` in the same transaction.
2. **`LedgerEntry.amount` is positive.** Sign comes from `type`. Aggregates use `sum(case when type=CREDIT then amount else -amount end)`.
3. **Reconstruction matches.** At any point, `sum(credits) - sum(debits) == Balance.amount`. A nightly job verifies this — see [Reconciliation](#reconciliation).
4. **Never go negative.** Checkout/admin debit must guard `if (current < amount) throw ConflictException`.
5. **Single-currency per user.** If we ever support multi-currency, it's one wallet per `(userId, currency)`, not a denormalized array.
6. **Append-only.** Never delete or update a `LedgerEntry`. Correcting an entry means writing a reversing entry plus a new correct entry.

## API

| Method | Path                              | Auth                  | Description                                                |
| ------ | --------------------------------- | --------------------- | ---------------------------------------------------------- |
| GET    | `/account/balance`                | Authenticated (Clerk) | Current user balance + currency.                            |
| GET    | `/account/balance/movements`      | Authenticated (Clerk) | Paginated ledger entries (newest first). Accepts `PaginationDto`. |
| POST   | `/account/balance/top-up`         | Authenticated (Clerk) | Creates a `Payment` (provider chosen by client) that credits the wallet on `payment.captured`. |
| POST   | `/users/:userId/balance/credit`   | Admin                 | Manual credit. Body: `{ amount, reason }`. Writes a CREDIT entry. |
| POST   | `/users/:userId/balance/debit`    | Admin                 | Manual debit. Body: `{ amount, reason }`. Writes a DEBIT entry. Refuses if it would overdraw. |
| GET    | `/users/:userId/balance`          | Admin                 | Read any user's balance + ledger (for support). Lives under the admin `/users/*` namespace per [04-api-rest.md](./04-api-rest.md). |

Responses are wrapped by the global envelope ([04-api-rest.md#response-envelope](./04-api-rest.md#response-envelope)). Paginated ledger fits the standard pagination contract.

## Top-up

```
POST /account/balance/top-up { amount, currency, provider, successUrl, cancelUrl }
  → ClerkAuthGuard
  → BalanceService.topUp(userId, dto)
      1. validate amount > 0, currency supported
      2. runInTransaction(tx):
           order   = tx.order.create({ userId, kind: 'TOPUP', total: amount, status: PENDING })
           payment = tx.payment.create({ orderId: order.id, status: PENDING, method: <from provider>, amount })
      3. After commit: intent = gateway.createIntent({ orderId, amount, currency, ... })
      4. tx.payment.update({ providerId: intent.providerId })
      5. Return { paymentIntent: intent }
```

The actual wallet credit happens **on `payment.captured` webhook**, not now:

```
on 'payment.captured' for a TOPUP order:
  runInTransaction(tx):
    tx.payment.update({ status: CAPTURED, paidAt })
    tx.order.update({ status: COMPLETED })
    tx.balance.update({ where: { userId }, data: { amount: { increment: amount } } })
    tx.ledgerEntry.create({
      userId, balanceId, type: CREDIT, amount,
      reason: `Top-up via ${provider}`,
      reference: order.id,
      referenceType: 'TOPUP',
    })
  emit('balance.credited', { userId, amount, reference: order.id })
```

Why a synthetic `Order` row? Because the rest of the system (payments, refunds, audit) already understands orders. Modeling a top-up as "a thing the user bought, except the thing is wallet credit" keeps the surface area small and uniform.

## Checkout debit

When `useBalance: true` at checkout, `OrdersService.checkout` runs inside the existing transaction:

```ts
if (dto.useBalance) {
  const balance = await tx.balance.findUnique({ where: { userId } });
  if (!balance || balance.amount.lessThan(order.total)) {
    throw new ConflictException('insufficient balance');
  }
  await tx.balance.update({
    where: { userId },
    data: { amount: { decrement: order.total } },
  });
  await tx.ledgerEntry.create({
    data: {
      userId, balanceId: balance.id,
      type: 'DEBIT', amount: order.total,
      reason: `Order ${order.code}`,
      reference: order.id, referenceType: 'ORDER',
    },
  });
  await tx.payment.update({
    where: { orderId: order.id },
    data: { status: 'CAPTURED', paidAt: new Date(), method: 'BALANCE' },
  });
  await tx.order.update({ where: { id: order.id }, data: { status: 'PAID' } });
}
```

Because everything runs inside `runInTransaction`, a failure anywhere (stock, ledger write, order update) rolls back the debit. The user never loses money to a half-finished checkout.

## Refund credit

`RefundsService.create` writes the credit synchronously in the same transaction that creates the `Refund` row. The gateway call (`gateway.refund(...)`) happens AFTER commit — see [07-data-flows.md#refund](./07-data-flows.md#refund) and [`0006-wallet-as-ledger`](../decisions/0006-wallet-as-ledger.md):

```ts
runInTransaction(tx):
  tx.refund.create({ orderId, amount, reason, isChargeback, processedAt: now() })
  tx.balance.upsert({
    where: { userId },
    create: { userId, amount, currency: 'USD' },
    update: { amount: { increment: amount } },
  })
  tx.ledgerEntry.create({
    userId, balanceId, type: 'CREDIT', amount,
    reason: `Refund for order ${order.code}`,
    reference: refund.id, referenceType: 'REFUND',
  })
  if (totalRefunded === order.total) {
    tx.order.update({ status: isChargeback ? 'CHARGEBACK' : 'REFUNDED' })
  }
```

The decision to credit before the gateway call (rather than two-phase) is captured in [ADR-0006](../decisions/0006-wallet-as-ledger.md). Trade-off: in the rare case where the gateway refund fails, the user has the credit but the provider never refunded. That gap surfaces in reconciliation reports, not in user-visible state.

## Admin credit/debit

```
POST /users/:userId/balance/credit { amount, reason }
  → @Roles(Role.ADMIN)
  → runInTransaction(tx):
      tx.balance.upsert(...)        // create if missing
      tx.ledgerEntry.create({ type: CREDIT, reason, reference: adminActionId, referenceType: 'ADMIN_ADJUST' })
      tx.activityLog.create({ actorId: admin.id, action: 'BALANCE_CREDIT', targetId: userId, payload: { amount, reason } })
```

`reason` is **required** and free-text — it must be present in the `LedgerEntry` and in the `ActivityLog` so support can reconstruct "who credited what and why" months later. A 1–2 sentence reason is the norm; an empty string is rejected at the DTO layer.

Admin **debit** is identical except it enforces the non-negative guard and is the only path that can intentionally reduce a balance without an order/refund attached.

## Concurrency

Two scenarios to design for:

### Concurrent checkouts using the same balance

User clicks "Place order" twice in rapid succession. Both transactions race to `tx.balance.update({ decrement: total })`. Postgres serializes the row-level locks; the second transaction either:

- Succeeds (balance had enough for both) — fine, two orders paid from balance, both ledger entries present.
- Fails the post-condition check (balance now negative) — we throw `ConflictException` and the second transaction rolls back.

The post-condition isn't optional: a naive `decrement` doesn't check for negative balance, it just goes negative. Always re-read inside the transaction:

```ts
const post = await tx.balance.findUnique({ where: { userId } });
if (post.amount.isNegative()) throw new ConflictException('insufficient balance');
```

Alternatively, use a raw `UPDATE ... WHERE amount >= $1 RETURNING amount` and treat zero affected rows as the conflict.

### Concurrent webhooks crediting top-up

Stripe retries `payment.captured` while our first delivery is still mid-transaction. The `WebhookEvent` unique constraint on `(provider, eventId)` is the gate: whichever transaction commits first wins, the second gets `P2002`, treats it as an idempotent replay, and acks 200.

## Reconciliation

A nightly job (see [`wallet-reconciliation.md`](../runbooks/wallet-reconciliation.md)) verifies for every user:

```sql
SELECT b."userId",
       b.amount AS stored,
       COALESCE(SUM(CASE WHEN l.type = 'CREDIT' THEN l.amount ELSE -l.amount END), 0) AS computed
FROM "Balance" b
LEFT JOIN "LedgerEntry" l ON l."userId" = b."userId"
GROUP BY b."userId", b.amount
HAVING b.amount <> COALESCE(SUM(CASE WHEN l.type = 'CREDIT' THEN l.amount ELSE -l.amount END), 0);
```

Any row returned is an inconsistency. The runbook covers diagnosis. Common causes (none of which we'd expect, but we still look):

- A direct `UPDATE` ran against `Balance` outside `BalanceService` (someone bypassed the layer). Add a tripwire test that asserts there's no `tx.balance.update` outside the balance module.
- A `LedgerEntry` row was deleted by hand (forbidden — but if it happened, the audit log should show who).
- Decimal rounding drift — defended against by `Decimal(12,2)` everywhere.

A second reconciliation compares `Payment.status = CAPTURED` for TOPUP orders against the provider's settlement report — see [09-payments.md#operational-concerns](./09-payments.md#operational-concerns).

## Edge cases

| Case | Handling |
| ---- | -------- |
| User has no `Balance` row yet | All write paths `upsert`. Reads return `{ amount: 0, currency: 'USD' }`. |
| Refund amount > original order total | `RefundsService` rejects with `ConflictException` before any write. |
| Top-up succeeds but webhook never lands | Reconciliation job catches it (Payment CAPTURED in the provider, but our `Payment` is still PENDING). Runbook: re-trigger the webhook from the provider dashboard. |
| Admin debit attempted on negative balance | `BalanceService.debit` re-reads in the same transaction and rejects. |
| Chargeback after refund already issued | The chargeback writes a second DEBIT entry (we owe the money back to the provider) and marks the order `CHARGEBACK`. The user's net position depends on whether they actually had the goods. |
| Currency mismatch (top-up in EUR, order in USD) | Not supported. Reject at the top-up DTO until multi-currency lands. |

## Cross-references

- [02-data-model.md](./02-data-model.md) — schema-level invariants
- [04-api-rest.md](./04-api-rest.md) — `/account/balance/*` endpoints
- [07-data-flows.md#checkout](./07-data-flows.md#checkout) — checkout debit
- [07-data-flows.md#refund](./07-data-flows.md#refund) — refund credit
- [09-payments.md](./09-payments.md) — gateways used by top-up
- [`0006-wallet-as-ledger.md`](../decisions/0006-wallet-as-ledger.md) — design rationale
- [`wallet-reconciliation.md`](../runbooks/wallet-reconciliation.md) — nightly reconciliation runbook
