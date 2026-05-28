# 0004 — Use Brevo for transactional email

- **Status**: Accepted
- **Date**: 2026-05-25
- **Decision-makers**: VirtualGifts engineering team
- **Tags**: email, vendor

## Context

We need to send transactional email — order confirmations, refund notices, optional notification digests, admin alerts. Auth-related email (verification, password reset) is **not** in scope here; Clerk handles those ([ADR-0003](./0003-delegate-auth-to-clerk.md)).

Requirements for the email provider:

- **Deliverability** — reach inboxes, not spam folders. This is the dominant requirement; everything else is solvable.
- **Templates** managed outside the codebase so marketing/support can update copy without a deploy.
- **Webhook callbacks** for deliveries / bounces / complaints, so we can suppress sending to addresses that bounce hard.
- **EU-friendly** — the team and a meaningful chunk of customers are EU-based. GDPR posture matters.
- **Reasonable free tier** for dev/staging and the first months of production.
- A maintained TypeScript/Node SDK.

Candidates evaluated:

- **Brevo** (formerly Sendinblue) — EU-based, deliverability competitive, free tier (300/day), TypeScript SDK (`@getbrevo/brevo`).
- **Postmark** — best-in-class deliverability reputation, US-based. No free tier; pay-per-1k from day one.
- **SendGrid** — large, mature, US-based. Documented bias toward marketing email; transactional setup is fine but the UI noise around marketing features is friction.
- **Resend** — newest, very developer-friendly, React-Email integration. Less battle-tested at scale; US-based.
- **AWS SES** — cheapest, but raw API with no template UI, no built-in suppression list management, and a sandbox-graduation process that surprises new accounts.

## Decision

Use **Brevo** for transactional email. Concretely:

- SDK: `@getbrevo/brevo`.
- Templates managed in Brevo's UI; referenced by numeric `templateId` aliased in `src/modules/mail/templates.ts`.
- Inline HTML reserved for one-off internal alerts (admin / on-call).
- Webhook endpoint at `POST /api/v1/webhooks/brevo`, authenticated by header token (`BREVO_WEBHOOK_TOKEN`).
- DNS: SPF + DKIM + DMARC published per environment.
- All sends are post-commit and fire-and-forget through `MailerService`; consumers never hold a request open waiting for Brevo.

See [`13-emails-brevo.md`](../architecture/13-emails-brevo.md) for the integration design.

## Consequences

**Good**

- EU-hosted, GDPR-friendly.
- Templates editable by non-engineers — copy changes don't need a deploy.
- Built-in suppression list management (bounced/complained addresses auto-suppress without us reinventing it).
- Free tier covers dev + early prod.
- Webhook events surface delivery failures we'd otherwise discover from a customer complaint.

**Bad / cost**

- Locked into Brevo's template system; migration requires re-creating templates in the destination provider (cost: a few hours per template).
- Brevo's API rate limits are reasonable but not extraordinary — large fan-outs need batching or a queue, not raw concurrent calls.
- Deliverability is **competitive** with Postmark but not better. If we ever have a deliverability incident traceable to Brevo (vs. our DNS), revisit.

**Follow-ups**

- Domain warming: don't go from 0 → 10k/day overnight on a new domain. ESPs throttle; Brevo's docs explain the ramp.
- When we adopt BullMQ, fan-out moves behind a queue so a slow Brevo response can't backpressure the API. The MailerService interface stays the same.

## Alternatives considered

- **Postmark**: best-in-class deliverability, but no free tier and US-only. Revisit if Brevo's deliverability ever underperforms in production.
- **SendGrid**: capable, but the marketing-product noise around it makes the transactional integration feel like a side feature. Pricing is also less clear.
- **Resend**: tempting DX. Set aside for now because it's the youngest provider; the cost of a deliverability surprise outweighs the DX advantage. Revisit in 12 months.
- **AWS SES**: cheapest at scale. Rejected for early-stage: too much DIY (no template UI, no suppression list out of the box, sandbox-graduation friction). Reconsider when monthly volume justifies the engineering effort.
- **Self-hosted Postfix**: not seriously considered. Anyone who's run their own SMTP can explain why.
