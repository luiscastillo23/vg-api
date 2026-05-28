# 0005 — Abstract payments behind a gateway interface

- **Status**: Accepted
- **Date**: 2026-05-25
- **Decision-makers**: VirtualGifts engineering team
- **Tags**: payments, architecture, vendor

## Context

The product roadmap calls for **multiple payment providers** from day one: Stripe and PayPal for card/wallet, Lemon Squeezy as a Merchant of Record (handles VAT/sales tax for digital goods), and several crypto rails (Binance Pay, NOWPayments, BitPay). The list will grow — regions matter, and each new market often requires a regionally dominant provider.

Naïve options:

1. **Stripe only** — fastest to ship, but cuts off PayPal-only buyers, crypto buyers, and the MoR benefit of Lemon Squeezy.
2. **Hard-coded multi-provider** — `if (provider === 'stripe') {...} else if (provider === 'paypal') {...}` scattered across `OrdersService`, `PaymentsService`, and the webhook controller. Six providers in, this becomes unreadable.
3. **Strategy pattern behind an interface** — one `IPaymentGateway` interface, one adapter per provider, a factory that resolves the right adapter by name. `OrdersService` knows nothing about providers.

Cross-cutting concerns each provider has to satisfy:

- Create a payment intent / hosted-checkout session.
- Verify webhook signatures (different scheme per provider) against the raw body.
- Refund a captured payment.
- Surface a normalized event shape so downstream code is provider-agnostic.

## Decision

Adopt the **strategy pattern** behind `IPaymentGateway`:

```ts
export interface IPaymentGateway {
  readonly name: PaymentProviderName;
  createIntent(input: CreateIntentInput): Promise<CreateIntentResult>;
  parseWebhook(rawBody: Buffer, headers: Record<string, string>): Promise<WebhookEvent>;
  refund(input: RefundInput): Promise<RefundResult>;
}
```

Each provider is its own `@Injectable()` adapter in `modules/payments/gateways/<provider>.gateway.ts`. A `PaymentGatewayFactory` resolves the right adapter by name; consumers inject the factory, not concrete classes.

Webhook handling is centralized: `POST /api/v1/webhooks/:provider` → factory → `gateway.parseWebhook(rawBody, headers)` → normalized `WebhookEvent` → `PaymentsService` updates `Payment` + delegates state transitions to `OrdersService`.

See [`09-payments.md`](../architecture/09-payments.md) for the integration design.

## Consequences

**Good**

- Adding a new provider is one file + a registry entry. No edits to `OrdersService`.
- Webhook handling is uniform across providers — signature verification, idempotency, raw-body capture all live in one place.
- Testing is cleaner: contract tests against captured provider fixtures verify each adapter independently.
- The interface acts as documentation: anyone adding a provider knows exactly which surface they must implement.

**Bad / cost**

- The interface forces normalization. Provider features that don't map (e.g. PayPal's `auth → capture → settle` three-step vs Stripe's single `payment_intent.succeeded`) are flattened into a `WebhookEvent.type` enum. We lose some fidelity in the audit log — mitigated by persisting `Payment.providerRaw: Json` with the full event.
- Six adapters is six surfaces to keep up with as providers change their APIs. Contract tests with captured fixtures catch breakage at CI time.
- The factory introduces an indirection. `OrdersService` calls `factory.get('stripe').createIntent(...)` instead of `stripe.createIntent(...)`. Minor cost; pays for itself the second time we add a provider.

**Follow-ups**

- Only `stripe.gateway.ts` is implemented today. Other providers are added when a feature requires them — don't pre-implement six gateways nobody calls.
- A regression where one provider returns a malformed event must not crash the webhook handler for other providers. `parseWebhook` errors are caught per-call and ack-200 (with a logged warning), so a buggy adapter doesn't poison the queue.

## Alternatives considered

- **Stripe-only**: ships fastest, but the roadmap explicitly requires non-card and non-US providers. We'd be back here in three months.
- **Inline `if/else`**: works for two providers, becomes unreadable at four. We're starting at six. No.
- **Plugin system with dynamic loading**: over-engineered for our scale. The interface + factory pattern is enough.
- **Use a payments aggregator (Saleor / Spreedly / etc.)**: yet another vendor in the critical path, with its own fees and outage exposure. Not worth it for a system that's going to integrate ~6 providers.

## Adding a new provider — checklist

1. Implement `IPaymentGateway` in `modules/payments/gateways/<name>.gateway.ts`.
2. Register in `PaymentGatewayFactory.get()`.
3. Add `WebhookEvent` contract test with a captured fixture under `test/contract/fixtures/<name>/`.
4. Add the provider's env vars to [`06-infrastructure.md`](../architecture/06-infrastructure.md#configuration) and `.env.example`.
5. Document signing-secret rotation in [`stripe-webhook-failure.md`](../runbooks/stripe-webhook-failure.md) (or a parallel runbook if the failure mode differs materially).
6. If the provider has a sandbox mode, add an env flag and the sandbox URL to the config.
