# Webhook Rules

Applies to: `src/modules/**/webhooks.controller.ts`, `src/modules/**/webhook*.ts`, route handlers under `/webhooks/*`

## What webhook handlers do
- Receive a signed HTTP POST from an external provider, verify the signature, acknowledge quickly (2xx), and hand off work.

## Hard rules

### Preserve the raw body
Signature verification requires the exact bytes the provider signed. `fastify-raw-body` is registered on `/api/v1/webhooks/*` — do not JSON-parse the body before verification.

Inject via Fastify's request object:
```ts
const rawBody: Buffer = req.rawBody;
```

Never add body transformation middleware before the signature check.

### Verify signature first — before any other logic
Reject with `400` if verification fails. Do not process payload fields before the signature is valid.

```ts
// Stripe example
const event = this.stripe.webhooks.constructEvent(
  rawBody,
  signature,
  process.env.STRIPE_WEBHOOK_SECRET,
);
// Clerk / Svix example
const wh = new Webhook(process.env.CLERK_WEBHOOK_SIGNING_SECRET);
const payload = wh.verify(rawBody, headers);
```

### Deduplicate by event ID
External providers may deliver the same event more than once. Check `event.id` against a persisted record before processing. If already handled, return `200` immediately.

```ts
const existing = await this.idempotencyRepo.find(event.id);
if (existing) return { received: true };
```

### Enqueue heavy work via BullMQ
Do not perform database writes, external API calls, or multi-step business logic synchronously in the webhook handler. Enqueue a job and return `200` within ~3 s.

```ts
await this.paymentQueue.add('payment.captured', { eventId: event.id, payload });
return { received: true };
```

Exception: lightweight mirror updates (Clerk `user.created` → upsert local user row) that complete in a single fast transaction are acceptable inline.

### Respond 2xx quickly
Return `{ received: true }` (status `200`) as soon as the event is validated and enqueued. Never return `4xx`/`5xx` for business-logic failures after the signature passes — retry storms cost money.

### @Public() decorator
All webhook routes opt out of `ClerkAuthGuard` with `@Public()`. They authenticate via the provider's signature instead.

### Route placement
Webhook routes live under `POST /webhooks/:provider` (global prefix applies: `/api/v1/webhooks/:provider`). The provider-specific controller should be in the relevant module (e.g., `src/modules/payments/payments-webhook.controller.ts`).
