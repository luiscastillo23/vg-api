# 15 — Security

This file consolidates the threat model, the controls already in the codebase or planned, and the operational practices the team must follow. Where another doc owns the topic (Clerk in [08](./08-auth-clerk.md), payments in [09](./09-payments.md), uploads in [12](./12-uploads.md)), this file references rather than duplicates.

> Section index: [Threat model](#threat-model) · [Identity & authorization](#identity--authorization) · [Transport & headers](#transport--headers) · [Input handling](#input-handling) · [Webhooks](#webhooks) · [Database](#database) · [Secrets](#secrets) · [PII & logging](#pii--logging) · [Rate limiting & abuse](#rate-limiting--abuse) · [Dependencies](#dependencies) · [Incident response](#incident-response) · [Checklist](#release-checklist)

## Threat model

Top threats and the layers that mitigate them:

| Threat                                                 | Where it lives                          | Primary mitigation                                                  |
| ------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------- |
| Credential stuffing / brute-force sign-in              | Clerk (we don't sign in users)          | Delegated to Clerk's anti-abuse infrastructure.                      |
| Stolen session token replay from a different origin    | API ingress                             | `authorizedParties` (`azp`) check in `verifyToken()`.                |
| Forged session token signed with attacker key          | API ingress                             | Clerk JWKS signature verification.                                   |
| Privilege escalation via tampered token claims         | API ingress                             | Role read from local `User`, **never** from the token.               |
| Webhook spoofing (Clerk / payment provider)            | Webhook endpoints                       | HMAC / Svix signature + event-id idempotency table.                  |
| SQL injection                                          | Repositories                            | Prisma parameterizes everything. Ban `$queryRawUnsafe` with user input. |
| Cross-site scripting (XSS)                             | Client (we're a JSON API)               | JSON-only responses; storefront escapes on render.                   |
| Cross-site request forgery (CSRF)                       | N/A                                     | Stateless bearer-token API — no cookie auth, so no CSRF surface.    |
| Open redirect                                          | Payment success/cancel URLs             | Validate against an allowlist of host prefixes in `PaymentsService`. |
| Mass assignment                                         | DTOs                                    | `ValidationPipe` `whitelist + forbidNonWhitelisted` — unknown fields rejected. |
| Insecure direct object reference (IDOR)                | Resource controllers                    | Every authenticated handler scopes the query to `req.user.id` or checks role + ownership. |
| Server-side request forgery (SSRF)                     | Outbound HTTP                           | Outbound HTTP allowlisted by provider (Stripe/PayPal/Brevo/Clerk SDKs only). No "fetch arbitrary URL" features. |
| Information leak in error responses                    | Global exception filter                 | `AllExceptionsFilter` strips stack traces in production.             |
| Token / secret leak in logs                            | `LoggingInterceptor` + redaction        | Redact `Authorization`, `cookie`, body fields like `password`, `token`. |
| Object/file leak via predictable URLs                  | Uploads                                 | CUID keys + signed read URLs (5–15 min). See [12-uploads.md](./12-uploads.md). |
| Wallet drift                                            | Wallet ledger                           | Reconciliation runbook + double-entry-lite invariants. See [10-wallet.md](./10-wallet.md). |
| Dependency CVE                                         | Build / CI                              | Renovate (or Dependabot) + weekly review; `pnpm audit` in CI.        |

## Identity & authorization

Full detail in [08-auth-clerk.md](./08-auth-clerk.md). The non-negotiables:

- Auth is **delegated** to Clerk. No passwords, no token issuance, no MFA logic in this codebase.
- `ClerkAuthGuard` is **global**. `@Public()` is the only opt-out.
- `RolesGuard` runs **after** `ClerkAuthGuard` and is the only authorization layer for role-gated routes.
- Resource ownership (IDOR) is enforced **inside the service**, not by the guard. Example:

  ```ts
  // OrdersService.findOne
  const order = await this.repo.findById(id);
  if (!order) throw new NotFoundException();
  if (order.userId !== caller.id && caller.role === 'CUSTOMER') throw new ForbiddenException();
  return order;
  ```

  Admins/managers bypass the ownership check via role. Customers see only their own.

## Transport & headers

| Concern               | Implementation                                                                |
| --------------------- | ----------------------------------------------------------------------------- |
| HTTPS                 | Terminated at the edge (LB / reverse proxy). Containers serve HTTP locally.   |
| HSTS                  | Set by the edge proxy with `max-age=63072000; includeSubDomains; preload`.    |
| Security headers      | `@fastify/helmet` globally — sets `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy`, etc. |
| CORS                  | `@fastify/cors`, restricted to `WEB_URL_ORIGIN`, `credentials: true`.          |
| CSP                   | Not set by the API (we serve JSON, not HTML). The storefront sets its own CSP. |

## Input handling

- **Global `ValidationPipe`** with `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`. Unknown fields → 400.
- **Per-endpoint DTOs** with `class-validator`. **No `any` body parameters** — always declare a DTO class.
- **Money** uses `@IsNumber({ maxDecimalPlaces: 2 })`, then mapped to `Decimal` in the service.
- **Strings** that flow to the DB are length-bounded (`@MaxLength(N)`) to prevent slow-query DoS via huge `LIKE` patterns.
- **Allowed sort fields** are explicit per-endpoint; an arbitrary `sortBy` is rejected. See [04-api-rest.md#pagination-filtering--sorting](./04-api-rest.md#pagination-filtering--sorting).
- **URL params** are CUIDs; validate with `@IsString() @Matches(/^c[a-z0-9]{24}$/)` or treat invalid IDs as 404 via Prisma's `P2025` (filter behavior, both work).

## Webhooks

| Provider               | Verification                                              | Idempotency key                |
| ---------------------- | --------------------------------------------------------- | ------------------------------ |
| Clerk                  | `svix` HMAC (`CLERK_WEBHOOK_SIGNING_SECRET`)              | `svix-id`                      |
| Stripe                 | `stripe.webhooks.constructEvent` (`STRIPE_WEBHOOK_SECRET`) | `event.id`                     |
| PayPal                 | `paypal-rest-sdk` `verifyWebhookSignature`                | `event.id`                     |
| Binance Pay            | HMAC-SHA512 over `BinancePay-Timestamp + Nonce + body`    | `bizId`                        |
| Lemon Squeezy          | HMAC-SHA256 (`LEMONSQUEEZY_WEBHOOK_SECRET`)               | `meta.event_id`                |
| NOWPayments            | HMAC-SHA512 (`NOWPAYMENTS_IPN_SECRET`)                    | `payment_id` + `payment_status`|
| BitPay                 | Bearer token compare (`BITPAY_NOTIFICATION_TOKEN`)        | `id`                           |
| Brevo (delivery)       | Header API token (`BREVO_WEBHOOK_TOKEN`)                  | `messageId`                    |

Hard rules:

1. **Raw body required.** `fastify-raw-body` runs on `/webhooks/*` before the JSON parser.
2. **Signature first, body trust second.** Any field used to dispatch logic must be read *after* signature verification passes.
3. **Idempotency table.** Persist `(provider, eventId)` with a unique constraint. Replays are short-circuited.
4. **Ack 200 on duplicate.** A replayed event returns 200 without side effects — the provider stops retrying.
5. **Throttle.** Webhook endpoints are still subject to the global throttler, with a tighter per-route override.

## Database

- Prisma parameterizes all queries. `$queryRaw` with **template literal** is safe; `$queryRawUnsafe` with user input is banned (add an ESLint rule to enforce).
- Foreign keys with `onDelete: Cascade` or `Restrict` per the rules in [02-data-model.md](./02-data-model.md). No "silent leftover rows" on user deletion (except those tracking financial history).
- Soft delete: opt-in via the middleware in `PrismaService` (`softDeleteModels` set). Never invent per-table soft-delete columns ad hoc.
- Migrations: every schema change ships its migration. **No** out-of-band SQL on production.
- Backups: managed Postgres provider does point-in-time recovery; verify restores quarterly per the deploy runbook.

## Secrets

- **Storage**: secret manager (AWS Secrets Manager / Doppler / 1Password) in non-dev environments. `.env` files only in dev.
- **Rotation**: rotate every quarter; rotate **immediately** after employee offboarding or suspected compromise.
- **Access**: principle of least privilege. Production secrets accessible to no more than 3 people. Compromise procedure: rotate → audit access logs → write postmortem.
- **CI/CD**: secrets injected from the secret manager into the deploy job at runtime, never echoed to logs.
- **Local `.env`**: gitignored. `.env.example` is the only committed env file and contains placeholders only (`pk_test_xxx`).

## PII & logging

| Field                         | Loggable?                                            |
| ----------------------------- | ---------------------------------------------------- |
| Email address                 | Hashed or masked (`u***@example.com`) only.          |
| Clerk session token           | **Never** logged. Auth header redacted.              |
| Webhook signing secrets       | **Never** logged.                                    |
| Card / bank numbers           | We never receive them — providers handle them.       |
| Password                      | We never store them (Clerk does).                    |
| User ID (`User.id`)           | OK — internal CUID, not directly addressable.        |
| Clerk ID (`User.clerkId`)     | OK — useful for tracing.                             |
| Order code (`ORD-000123`)     | OK — public to the user themselves.                  |
| Request body                  | Top-level only on errors; never POST body of `/auth/*` or `/webhooks/*`. |

Redaction is centralized in the `LoggingInterceptor` and the `pino` redact config:

```ts
pino({
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token', '*.clientSecret'],
    censor: '[REDACTED]',
  },
});
```

## Rate limiting & abuse

- **Global throttler** (`@nestjs/throttler`): 120 req/min/IP by default. Override per-route via `@Throttle()`.
- **Tighter limits** on:
  - Webhooks (30/min)
  - Login-adjacent paths (`/account/me` is harmless; we have no `/auth/login`)
  - Uploads (presign 10/min/user; direct 20/min/user)
- **Storage backend**: in-memory for single-instance dev; **Redis** in production so limits are fleet-global.
- **Bot signature** detection at the edge (CloudFront / Cloudflare) when needed.

## Dependencies

- `pnpm audit` runs in CI; high/critical CVEs fail the build.
- Renovate / Dependabot opens PRs weekly. Minor/patch auto-merge after CI; major requires human review.
- No `--ignore-scripts` skipped in CI — postinstall scripts can be malicious in compromised packages.
- Pin major versions in `package.json` (`^` allows minor/patch). Lockfile (`pnpm-lock.yaml`) committed and respected.

## Incident response

See `docs/runbooks/` for specifics. The general flow:

1. **Detect** — alert fires (error rate, webhook backlog, reconciliation drift).
2. **Mitigate** — minimize damage: flip a feature flag, revoke a token, scale up, roll back.
3. **Communicate** — status page + Slack #incidents update within 15 min.
4. **Eradicate** — root-cause fix in code.
5. **Postmortem** — write within 5 business days using [`incident-template.md`](../runbooks/incident-template.md). Add follow-ups to the backlog with deadlines.

For secrets compromise specifically: rotate first, investigate second. The investigation must not block the rotation.

## Release checklist

Block production deploys on these:

- [ ] All migrations are forward-compatible with the previous app version (rolling deploy safety).
- [ ] No new endpoint missing `ClerkAuthGuard` (or explicit `@Public()`) — grep CI rule.
- [ ] No new endpoint missing rate-limit override if it's expensive (search, reports).
- [ ] No `$queryRawUnsafe` introduced.
- [ ] No new env var without a default *or* a Joi validator (`required: true`).
- [ ] No new external HTTP call without timeout + retries + circuit-breaker (use `@nestjs/axios` interceptor).
- [ ] `pnpm audit` clean (or each finding has a ticket).
- [ ] CHANGELOG updated.
- [ ] Runbook updated if the deploy adds/removes a runbook-worthy concern.

## Cross-references

- [04-api-rest.md](./04-api-rest.md) — error model, throttling
- [05-patterns.md#auth--rbac](./05-patterns.md#auth--rbac) — guard wiring
- [06-infrastructure.md#security](./06-infrastructure.md#security) — header/CORS config
- [08-auth-clerk.md](./08-auth-clerk.md) — auth threat model
- [09-payments.md](./09-payments.md) — webhook signatures
- [12-uploads.md](./12-uploads.md) — file abuse / antivirus
- [`incident-template.md`](../runbooks/incident-template.md) — postmortem template
