# 13 — Transactional email (Brevo)

The backend sends three things over email: order/refund status updates, notification digests, and admin alerts. **Auth-related email (verification, password reset, MFA challenges) is sent by Clerk, not by us** — see [08-auth-clerk.md](./08-auth-clerk.md). This file covers the Brevo integration, the template strategy, the consumer model, and deliverability.

> Section index: [Goals](#goals) · [Service shape](#service-shape) · [Templates vs inline](#templates-vs-inline) · [Event-driven sending](#event-driven-sending) · [Non-blocking delivery](#non-blocking-delivery) · [Bounces & complaints](#bounces--complaints) · [Deliverability](#deliverability) · [Dev preview mode](#dev-preview-mode) · [Quotas & cost](#quotas--cost)

## Goals

1. **Never block a request** waiting on Brevo. All sends are post-commit, fire-and-forget (with retry).
2. **Idempotent at the dedupe layer**: re-emitting `order.created` twice doesn't email twice.
3. **Replaceable provider**: the `MailerService` interface should hide Brevo specifics. Swapping to Resend/Postmark later is a 1-day change.
4. **Auditable**: every send writes an `EmailLog` row (recipient, template, payload, providerMessageId, status).

## Service shape

```ts
// modules/mail/mailer.service.ts
@Injectable()
export class MailerService {
  send(input: SendInput): Promise<SendResult>;
}

export type SendInput =
  | { kind: 'template'; templateId: number; to: Recipient; params: Record<string, unknown>; tags?: string[] }
  | { kind: 'inline';   subject: string;     to: Recipient; html: string;                       tags?: string[] };

export interface Recipient { email: string; name?: string; userId?: string; }

export interface SendResult { providerMessageId: string; queuedAt: Date; }
```

Brevo implementation:

```ts
@Injectable()
export class BrevoMailerService implements MailerService {
  private readonly api: Brevo.TransactionalEmailsApi;
  private readonly sender: { name: string; email: string };

  constructor(private readonly config: ConfigService, private readonly logger: Logger) {
    this.api = new Brevo.TransactionalEmailsApi();
    this.api.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, config.getOrThrow('BREVO_API_KEY'));
    this.sender = {
      name:  config.getOrThrow('BREVO_SENDER_NAME'),
      email: config.getOrThrow('BREVO_SENDER_EMAIL'),
    };
  }

  async send(input: SendInput): Promise<SendResult> {
    const payload: Brevo.SendSmtpEmail = {
      sender: this.sender,
      to: [{ email: input.to.email, name: input.to.name }],
      tags: input.tags,
      ...(input.kind === 'template'
        ? { templateId: input.templateId, params: input.params }
        : { subject: input.subject, htmlContent: input.html }),
    };
    const res = await this.api.sendTransacEmail(payload);
    return { providerMessageId: res.body.messageId, queuedAt: new Date() };
  }
}
```

`MailerService` is injected wherever we need to send. **Modules never construct Brevo SDK objects directly.**

## Templates vs inline

| Use a Brevo template (recommended) | Use inline HTML |
| ---------------------------------- | --------------- |
| Marketing / branded user-facing email (order confirmation, refund notice, welcome) | One-off internal alerts (admin "stock low", on-call "wallet reconciliation drift") |
| Editable by non-engineers without a deploy | When the body is generated dynamically (e.g. a debug dump) |
| Per-locale variants managed in Brevo | English-only ops emails |

Templates are referenced by numeric `templateId` (Brevo assigns them). The mapping lives in `src/modules/mail/templates.ts` so the code says `Templates.OrderConfirmation` instead of magic numbers:

```ts
export const Templates = {
  OrderConfirmation:  1,
  OrderStatusUpdate:  2,
  RefundIssued:       3,
  Welcome:            4,
  // ...
} as const;
```

When a template is added or renamed in Brevo, update this file in the same PR as the consumer.

## Event-driven sending

Consumers subscribe to domain events emitted from `OrdersService`, `RefundsService`, etc.:

```ts
@Injectable()
export class OrderMailListener {
  constructor(private readonly mailer: MailerService, private readonly users: UsersService) {}

  @OnEvent('order.created', { async: true })
  async onOrderCreated({ orderId }: OrderCreatedEvent) {
    const order = await this.orders.findByIdLite(orderId); // includes user.email + total
    await this.mailer.send({
      kind: 'template',
      templateId: Templates.OrderConfirmation,
      to: { email: order.user.email, name: order.user.firstName, userId: order.userId },
      params: { code: order.code, total: order.total.toString(), itemsCount: order.itemsCount },
      tags: ['order', 'order.created'],
    });
  }

  @OnEvent('order.statusChanged', { async: true })
  async onStatusChanged({ orderId, from, to }: OrderStatusChangedEvent) { ... }
}
```

| Event                 | Template                  | When NOT to send                                     |
| --------------------- | ------------------------- | ---------------------------------------------------- |
| `order.created`       | OrderConfirmation         | When `userPreferences.transactionalEmails === false` (legally required emails like refund still go). |
| `order.statusChanged` | OrderStatusUpdate         | Same.                                                |
| `refund.created`      | RefundIssued              | Always send (financial record).                       |
| `user.welcome` *(post-`user.created` from Clerk webhook)* | Welcome | If user opted out at sign-up. |
| `chat.message`        | (digest, not real-time)   | Real-time messages are in-app only; offline digest batches every 30 min by default. |

## Non-blocking delivery

The send happens via `@OnEvent(..., { async: true })`, but `@nestjs/event-emitter` still runs handlers in the same process. Two implications:

1. **Latency**: a hot mail listener that does five round-trips to Brevo can delay a webhook ack. Always `await` only the Brevo call you initiated; don't batch unrelated sends inside one event handler.
2. **Single-instance fan-out**: each instance fires its own listener for its own emitted events. If two API instances both emit `order.created` (impossible — only one instance creates the order), only one would email. But once we move to BullMQ, the producer pushes the event and a worker pool consumes — at that point the worker is the single sender.

When per-event latency matters (mail listener is slow), promote that consumer to a queue worker:

```ts
@OnEvent('order.created', { async: true })
async onOrderCreated(e) {
  await this.mailQueue.add('send-order-confirmation', { orderId: e.orderId });
}
```

The handler now does one fast enqueue; the worker pulls and sends.

## Bounces & complaints

Brevo provides webhooks for delivery events. Endpoint:

```
POST /webhooks/brevo
  Headers: X-Mailin-Tag, X-Mailin-Custom (configured per template)
  Events: delivered, soft_bounce, hard_bounce, complaint, unsubscribe
```

| Event           | Action                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `delivered`     | Update `EmailLog.deliveredAt`. No user-facing action.                                                  |
| `soft_bounce`   | Increment `EmailLog.softBounceCount`. After 3 in 7 days, treat as a hard bounce.                       |
| `hard_bounce`   | Mark `User.emailDeliverable = false`. Suppress future transactional sends until the user updates email. |
| `complaint`     | Mark `User.preferences.transactionalEmails = false`. Notify on-call.                                  |
| `unsubscribe`   | Same as `complaint`, log the source.                                                                  |

Authenticate the webhook by API-token header (Brevo doesn't sign payloads with HMAC). Compare against `BREVO_WEBHOOK_TOKEN`.

## Deliverability

Set up once per environment:

- **SPF**: TXT record at the sending domain authorizing Brevo's sending IPs.
- **DKIM**: CNAME records published per the Brevo dashboard.
- **DMARC**: `v=DMARC1; p=quarantine; rua=mailto:dmarc@<yourdomain>` once SPF/DKIM are verified for 2 weeks.
- **Verified sender**: `BREVO_SENDER_EMAIL` must be a verified address on the Brevo account.
- **Reply-to**: set to `support@<yourdomain>` (not the sender) so customer replies hit the support inbox, not the no-reply.

Run a `mail-tester.com` check after DNS changes — score ≥ 9/10 is the target.

## Dev preview mode

For local development, set `MAIL_PROVIDER=preview`:

```ts
// modules/mail/preview-mailer.service.ts
@Injectable()
export class PreviewMailerService implements MailerService {
  send(input: SendInput) {
    this.logger.log({ event: 'mail.preview', input });
    // Optionally write HTML to ./mail-preview/<timestamp>.html
    return Promise.resolve({ providerMessageId: `preview_${Date.now()}`, queuedAt: new Date() });
  }
}
```

This avoids consuming Brevo's free-tier quota during development and avoids accidentally emailing real customers from a dev DB seeded with prod-like data.

## Quotas & cost

- Brevo free tier: 300 emails/day. Adequate for early dev and a small staging environment.
- Paid tiers: per-1k-email pricing. Tag every send (`tags: ['order', 'order.created']`) so Brevo's analytics break down volume by source.
- Set `MAIL_DAILY_BUDGET_ALERT_AT` on the on-call dashboard; alert at 80% of plan to avoid surprise overage.

## Cross-references

- [05-patterns.md#domain-events](./05-patterns.md#domain-events) — the event bus
- [06-infrastructure.md#mail](./06-infrastructure.md#mail) — env vars
- [08-auth-clerk.md](./08-auth-clerk.md) — Clerk sends auth-related email
- [0004-use-brevo-for-email.md](../decisions/0004-use-brevo-for-email.md) — provider decision
