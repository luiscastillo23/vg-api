# 09 — Payments

The payments module owns the `Payment` model and the abstraction over external gateways. Orders are the source of truth for "what was sold"; payments are the source of truth for "how it was paid." This file covers the gateway interface, webhook handling, idempotency, and the per-provider quirks.

> Section index: [Goals](#goals) · [Gateway interface](#gateway-interface) · [Provider catalogue](#provider-catalogue) · [Selection](#selection) · [Checkout intent flow](#checkout-intent-flow) · [Webhook flow](#webhook-flow) · [Idempotency](#idempotency) · [Raw body](#raw-body) · [Refunds](#refunds) · [Order ↔ Payment state machine](#order--payment-state-machine) · [Currency & money](#currency--money) · [Testing](#testing) · [Operational concerns](#operational-concerns)

## Goals

1. **Provider-agnostic core**: `OrdersService` knows nothing about Stripe vs PayPal vs BitPay. It speaks only to `PaymentsService`.
2. **Signature-verified webhooks**: every webhook is HMAC-verified before any side effect runs.
3. **Idempotent webhooks**: replays (deliberate or accidental) never double-mark an order paid.
4. **Atomic state transitions**: order status changes inside `runInTransaction` together with the `Payment` update.
5. **Audit trail**: persist the full provider event (`Payment.providerRaw: Json`) for reconciliation.

## Gateway interface

```ts
// modules/payments/gateways/payment-gateway.interface.ts
export interface IPaymentGateway {
  readonly name: PaymentProviderName;

  /**
   * Create a payment intent / session in the provider.
   * Called inside the checkout flow, AFTER the DB transaction commits.
   */
  createIntent(input: CreateIntentInput): Promise<CreateIntentResult>;

  /**
   * Verify webhook signature against the raw body and parse the event.
   * Must throw on bad signature — never return a falsy/normalized event.
   */
  parseWebhook(rawBody: Buffer, headers: Record<string, string>): Promise<WebhookEvent>;

  /**
   * Issue a refund through the provider.
   * Called from RefundsService, OUTSIDE any DB transaction (network call).
   */
  refund(input: RefundInput): Promise<RefundResult>;
}

export type PaymentProviderName =
  | 'stripe'
  | 'paypal'
  | 'binance-pay'
  | 'lemonsqueezy'
  | 'nowpayments'
  | 'bitpay';

export interface CreateIntentInput {
  orderId: string;
  amount: number;       // major units (USD/EUR), NOT cents
  currency: string;     // ISO-4217 uppercase
  successUrl?: string;  // hosted-checkout providers only
  cancelUrl?: string;
}

export interface CreateIntentResult {
  providerId: string;        // gateway-side identifier (PaymentIntent.id, Order.id, …)
  clientSecret?: string;     // Stripe-style client confirm flow
  redirectUrl?: string;      // PayPal / Lemon Squeezy / NOWPayments-style redirect flow
}

export interface WebhookEvent {
  id: string;                                 // provider-side event id — used for idempotency
  providerId: string;                         // payment id this event refers to
  type: 'captured' | 'failed' | 'refunded' | 'disputed' | 'ignored';
  amount?: number;
  currency?: string;
  raw: unknown;                               // persisted into Payment.providerRaw
}
```

The interface lives in `modules/payments/gateways/`. Each provider implements it in its own file (`stripe.gateway.ts`, `paypal.gateway.ts`, …). The current scaffold already has `stripe.gateway.ts` — copy its shape when adding others.

## Provider catalogue

| Provider       | Adapter file               | Flow type                | Confirmation        | Notes |
| -------------- | -------------------------- | ------------------------ | ------------------- | ----- |
| Stripe         | `stripe.gateway.ts`        | PaymentIntent + client-side confirm | `clientSecret` | Most flexible. SCA out of the box. |
| PayPal         | `paypal.gateway.ts`        | Orders v2 + redirect     | `redirectUrl`       | Capture happens after redirect-back; webhook `PAYMENT.CAPTURE.COMPLETED` is authoritative. |
| Binance Pay    | `binance-pay.gateway.ts`   | Hosted checkout + redirect | `redirectUrl`     | Crypto. Settlement to USDT or local fiat per merchant config. |
| Lemon Squeezy  | `lemonsqueezy.gateway.ts`  | Hosted checkout + redirect | `redirectUrl`     | Merchant of Record — they collect VAT/sales tax for us. |
| NOWPayments    | `nowpayments.gateway.ts`   | Hosted checkout + redirect | `redirectUrl`     | Crypto. IPN webhook with HMAC-SHA512 signature. |
| BitPay         | `bitpay.gateway.ts`        | Invoice + redirect       | `redirectUrl`       | Crypto. Webhook authenticated by Bearer token, NOT HMAC. |

> The current scaffold ships only `stripe.gateway.ts`. Add the others when a feature requires them — don't pre-implement six gateways nobody calls.

## Selection

The client sends a `provider` field in the checkout payload:

```http
POST /api/v1/payments/checkout
Authorization: Bearer <clerkToken>
Content-Type: application/json

{
  "orderId": "cuid_...",
  "provider": "stripe",
  "successUrl": "https://app.example.com/orders/cuid_.../success",
  "cancelUrl":  "https://app.example.com/orders/cuid_.../cancel"
}
```

`PaymentsService` resolves the provider via a factory:

```ts
// modules/payments/payment-gateway.factory.ts
@Injectable()
export class PaymentGatewayFactory {
  constructor(
    private readonly stripe: StripeGateway,
    private readonly paypal: PayPalGateway,
    // ...
  ) {}
  get(name: PaymentProviderName): IPaymentGateway {
    switch (name) {
      case 'stripe':       return this.stripe;
      case 'paypal':       return this.paypal;
      // ...
      default: throw new BadRequestException(`Unknown payment provider: ${name}`);
    }
  }
}
```

Don't inject specific gateway classes into `OrdersService` or `PaymentsService` — go through the factory so an unknown provider is a controlled 400, not a crash.

## Checkout intent flow

```
POST /payments/checkout { orderId, provider, ... }
  → ClerkAuthGuard, ValidationPipe
  → PaymentsService.createIntent({ orderId, provider, ... })
      1. Load order (must belong to caller; must be PENDING with method !== BALANCE)
      2. Idempotency check: if Payment already has providerId, return the existing intent
      3. gateway = factory.get(provider)
      4. intent = await gateway.createIntent({ orderId, amount: order.total, currency, successUrl, cancelUrl })
      5. tx.payment.update({ where: { orderId }, data: { providerId: intent.providerId } })
      6. Return { providerId, clientSecret?, redirectUrl? }
```

Step 5 is a single write so it doesn't need `runInTransaction`. The DB-side commerce work (order/payment row creation, stock decrement, balance debit) already happened inside the checkout transaction — see [07-data-flows.md#checkout](./07-data-flows.md#checkout).

## Webhook flow

`POST /api/v1/webhooks/:provider` — public, raw body, signature-verified, idempotent.

```
1. Controller receives provider param + raw body + headers
2. gateway = factory.get(provider)
3. event = gateway.parseWebhook(rawBody, headers)        // throws → 400
4. if (await webhookStore.alreadyProcessed(provider, event.id)) return 200
5. runInTransaction(tx):
     a. tx.webhookEvent.create({ provider, eventId: event.id })   // P2002 means a parallel processor won — treat as success
     b. payment = tx.payment.findUnique({ where: { providerId: event.providerId } })
        - If !payment → log + ack 200 (event for a stale/test payment; don't retry the provider)
     c. switch (event.type):
          'captured':
            tx.payment.update({ status: CAPTURED, paidAt: now(), providerRaw: event.raw })
            await OrdersService.markPaid(tx, payment.orderId)
          'failed':
            tx.payment.update({ status: FAILED, providerRaw: event.raw })
            await OrdersService.markCancelled(tx, payment.orderId, 'payment_failed')
          'refunded':
            await RefundsService.recordProviderRefund(tx, payment.orderId, event)
          'disputed':
            tx.payment.update({ status: FAILED, providerRaw: event.raw })
            await OrdersService.markChargeback(tx, payment.orderId)
          'ignored':
            (nothing — but we still recorded the event-id so future replays no-op)
6. After commit: emit('payment.captured' | 'order.statusChanged' | 'refund.created' | 'chargeback.recorded')
7. Return 200 { received: true }
```

### Why each piece exists

- **Step 3 before step 4**: signature verification first. If we trust the body before checking the signature, an attacker spoofs `payment.captured` and gets free goods.
- **Step 4 short-circuits step 5**: a confirmed replay never opens a transaction at all — fewer locks, faster ack.
- **Step 5a inside the transaction**: writing the event-id is part of the atomic update. If the tx rolls back, the event-id rolls back too, and the next retry can succeed.
- **Step 5b "log + 200" for unknown provider IDs**: prevents the provider from retrying forever a webhook that points at deleted test data.
- **Step 6 after commit**: events fire only on a successful commit. If the transaction rolls back, no `order.statusChanged` notification goes out.

## Idempotency

Two layers, defense-in-depth:

| Layer                          | Implementation                                       | Catches                                          |
| ------------------------------ | ---------------------------------------------------- | ------------------------------------------------ |
| Event-id dedupe table          | `WebhookEvent { provider, eventId @@unique }`        | Deliberate retries (5xx, timeout, "redeliver" button in provider dashboard). |
| State-machine guards in `OrdersService` | `markPaid` rejects if order is not in `PENDING`     | Race between two parallel webhook workers; out-of-order delivery (`refunded` before `captured`). |

A correctly-functioning provider also includes its own dedupe headers (e.g. Stripe's `Stripe-Signature` includes a timestamp that bounds replay attacks). We don't rely on those alone.

## Raw body

Fastify parses request bodies as JSON by default. Webhook signatures are HMACs over the **raw bytes** — any whitespace or key-ordering change destroys the signature.

```ts
// src/main.ts
app.register(import('fastify-raw-body'), {
  field: 'rawBody',
  global: false,
  encoding: false,
  runFirst: true,
  routes: ['/api/v1/webhooks/*'],
});
```

In the controller, accept the raw body via the Nest/Fastify `@RawBody()` (or via `req.rawBody` if you read the request directly):

```ts
@Public()
@Post(':provider')
async webhook(
  @Param('provider') provider: PaymentProviderName,
  @Headers() headers: Record<string, string>,
  @RawBody() rawBody: Buffer,
) {
  return this.payments.handleWebhook(provider, rawBody, headers);
}
```

If you ever see "invalid signature" in the logs and the headers/secret look right — check that the controller is reading `rawBody`, not the parsed `body`.

## Refunds

Refunds live in the `refunds` module, not here. The interaction with payments:

1. Admin issues `POST /refunds { orderId, amount, reason, isChargeback? }`.
2. `RefundsService` opens a transaction, writes the `Refund` row, credits the user's `Balance` + `LedgerEntry`, and updates the order status.
3. **After commit**, `RefundsService` calls `gateway.refund({ paymentId, amount })`. The gateway call is outside the DB transaction because it's a network round-trip — see [07-data-flows.md#refund](./07-data-flows.md#refund) and ADR [`0006-wallet-as-ledger`](../decisions/0006-wallet-as-ledger.md).
4. The provider eventually emits a `refunded` webhook. We persist it via `Payment.providerRaw` but the user-facing state has already moved — the webhook is for the audit trail.

## Order ↔ Payment state machine

```
Order.status:    PENDING ─pay→ PAID ─process→ PROCESSING ─fulfil→ COMPLETED
                    │             │                                   │
                    │             └─refund→ REFUNDED                  └─refund→ REFUNDED
                    ├─cancel→ CANCELLED
                    └─dispute→ CHARGEBACK

Payment.status:  PENDING ─authorize→ AUTHORIZED ─capture→ CAPTURED ─refund→ REFUNDED
                    │                                       │
                    └─fail→ FAILED                          └─dispute→ FAILED (status mirrors gateway)
```

Only `OrdersService` mutates `Order.status`. `PaymentsService` updates `Payment.status` and calls `OrdersService.markPaid/markCancelled/markChargeback` — never `tx.order.update` directly. See [05-patterns.md#layered-architecture](./05-patterns.md#layered-architecture) for why.

## Currency & money

- The API surface accepts and returns amounts in **major units** (e.g. `19.99` USD) with `Decimal(12,2)` semantics. **Never floats.**
- Gateways disagree on what the wire expects:
  - Stripe / PayPal: minor units (cents). The adapter converts on the way in (`Math.round(amount * 100)`).
  - Lemon Squeezy / Binance Pay / NOWPayments / BitPay: major units. No conversion in the adapter.
- Currency is required on `CreateIntentInput`. Reject mismatches between `Order.currency` and the gateway's response in the webhook handler.
- Multi-currency is not supported today; the order's currency is the platform's default. When multi-currency lands, add a currency column to `Order` and never compare/sum across currencies.

## Testing

| Layer                          | Approach                                                                   |
| ------------------------------ | -------------------------------------------------------------------------- |
| Gateway adapter unit tests     | Inject `Stripe`/`PayPal` SDK as a constructor arg; mock the SDK in tests.  |
| `PaymentsService` unit tests   | Mock the `PaymentGatewayFactory.get()` to return a fake gateway.           |
| Webhook contract tests         | Capture a real webhook payload per provider (saved fixture); replay through `parseWebhook` and assert the parsed shape. |
| E2E checkout                   | Hit `/payments/checkout` with `provider: 'stripe'` and `Stripe.SecretKey` pointing at the test mode. Use `stripe trigger payment_intent.succeeded` to inject the webhook. |
| Idempotency                    | Two-shot the same webhook event and assert the second call is a no-op.    |

## Operational concerns

- **Webhook delivery dashboards**: every provider exposes one. Add the link to [`stripe-webhook-failure.md`](../runbooks/stripe-webhook-failure.md) and equivalents.
- **Signing-secret rotation**: roll secrets via the provider dashboard, then update the env var, then redeploy. There's a short overlap window — the old secret is accepted by the provider until you confirm rotation.
- **Sandbox vs prod**: every provider has a separate sandbox key. Mixing keys across environments is the most common "why is my webhook 400?" cause.
- **Reconciliation**: a nightly job (see [10-wallet.md](./10-wallet.md) and [`wallet-reconciliation.md`](../runbooks/wallet-reconciliation.md)) compares `Payment.status = CAPTURED` against the provider's settlement report. Discrepancies become tickets, not silent corrections.

## Cross-references

- [04-api-rest.md#webhook-endpoints](./04-api-rest.md#webhook-endpoints) — webhook conventions
- [05-patterns.md#strategy-pattern](./05-patterns.md#strategy-pattern) — gateway strategy in context
- [07-data-flows.md#checkout](./07-data-flows.md#checkout) — checkout transaction
- [07-data-flows.md#payment-webhook](./07-data-flows.md#payment-webhook) — webhook sequence
- [`0005-payment-provider-abstraction.md`](../decisions/0005-payment-provider-abstraction.md) — the decision
- [`stripe-webhook-failure.md`](../runbooks/stripe-webhook-failure.md) — incident runbook
