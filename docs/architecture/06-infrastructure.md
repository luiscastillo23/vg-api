# 06 — Infrastructure & runtime

This file covers everything that runs *around* the code: database, cache, storage, mail, observability, security, and deployment.

> Section index: [Database](#database) · [Cache](#cache) · [Storage](#storage) · [Mail](#mail) · [Payments](#payments) · [Security](#security) · [Observability](#observability) · [Configuration](#configuration) · [Deployment](#deployment)

## Database

- **Engine**: PostgreSQL 16.
- **ORM**: Prisma 6 with the new `prisma-client` generator (output at `generated/prisma/`). Note the [import-path gotcha](./03-directory-structure.md#critical-gotcha--prisma-client-import-path).
- **Connection**: `DATABASE_URL` env var, validated at boot.
- **Migrations**:
  - Dev: `npx prisma migrate dev --name <descriptive_name>` (no `prisma:*` npm wrappers exist — invoke `npx` directly).
  - Prod: `npx prisma migrate deploy` in the release pipeline. **Never** `migrate dev` against production.
- **Schema**: single source of truth at `prisma/schema.prisma`. See [02-data-model.md](./02-data-model.md).
- **Seed**: `prisma/seed.ts` does not exist yet — when added, it should create at minimum: an `ADMIN` user, a handful of categories/subcategories, and a few products/services.

### `PrismaService`

Lives at `src/common/prisma/prisma.service.ts`. Today it:

- Extends `PrismaClient`.
- Wires a query-event listener that warns on queries > 250 ms.
- Exposes `runInTransaction(fn)` — the **only** approved way to run multi-write business rules.
- Has a soft-delete middleware scaffold (`softDeleteModels` set, currently empty). Extend that set rather than reinventing soft-delete per model.

### Connection pooling

Default pool is fine for development. In production, set `connection_limit` in the `DATABASE_URL` (`?connection_limit=10`) appropriate to the deployment topology — typically `(num_cpus * 2 + 1)` per instance, capped by Postgres `max_connections`.

## Cache

- **Engine**: Redis 7.
- **Library**: `cache-manager` + `cache-manager-ioredis-yet` (or equivalent).
- **Scope**: today, only the `reports` module uses cache. TTL is **5–15 minutes** keyed by query parameters (`from`, `to`, `granularity`, `kind`).
- **Connection**: `REDIS_URL` env var.

When other modules eventually need cache (e.g. catalog hot reads), use the same `CacheModule` and key by a deterministic string. **Never** cache user-scoped data without including the userId in the key.

## Storage

- **Providers**: S3 or Cloudinary, behind a `StorageService` interface (strategy pattern).
- **Selection**: `STORAGE_PROVIDER` env var (`s3` | `cloudinary`).
- **Endpoints**:
  - `POST /uploads/images` (Authenticated via Clerk) — multipart upload, MIME + size validated.
  - `POST /uploads/sign` (Admin) — issues a signed URL for direct-to-bucket upload.
- **Conventions**:
  - Validate MIME type (`image/jpeg`, `image/png`, `image/webp`) and max size (config: typically 5 MB).
  - Generate a server-side filename — never trust the client filename.
  - Persist only the public URL on the entity (`Product.images: String[]`).

## Mail

- **Provider**: [Brevo](https://www.brevo.com) via the official `@getbrevo/brevo` SDK. Templates are created and managed in Brevo's UI and referenced by `templateId`; ad-hoc transactional sends use inline HTML.
- **Env vars**: `BREVO_API_KEY`, `BREVO_SENDER_NAME`, `BREVO_SENDER_EMAIL`.
- **Triggers** (consumed events):
  - `order.created` → confirmation email
  - `order.statusChanged` → status update email
  - `refund.created` → refund notice
- **Failure mode**: mail sending **must not block** the request path. Either move to a queue (BullMQ) or run the consumer with `async: true` and log+retry on failure.

## Payments

- **Providers**: Stripe, PayPal, Binance Pay, Lemon Squeezy, NOWPayments, BitPay — all behind the `PaymentProvider` interface. See [05-patterns.md#strategy-pattern](./05-patterns.md#strategy-pattern).
- **Selection**: per-request (`provider` field in the checkout payload).
- **Webhook endpoints**: `POST /api/v1/webhooks/:provider` (one per provider) + `POST /api/v1/webhooks/clerk` (Clerk user events).
  - **Public** (no Clerk session token — providers can't carry our tokens).
  - **Payment webhooks**: signature-verified using the gateway's `verifyWebhook(headers, rawBody)`.
  - **Clerk webhooks**: signature-verified using `svix` with `CLERK_WEBHOOK_SIGNING_SECRET`.
  - **Raw body required** — register `fastify-raw-body` for the `/webhooks/*` routes before the global JSON parser.
  - **Idempotent**: persist the provider event ID; replays return `200 OK` without re-processing.
- **Captured events** trigger order state transitions — see [07-data-flows.md](./07-data-flows.md).

## Security

| Concern              | Implementation                                                                  |
| -------------------- | ------------------------------------------------------------------------------- |
| Security headers     | `helmet()` registered globally in `main.ts`.                                     |
| CORS                 | Restricted to `WEB_URL_ORIGIN` (Next.js client). `credentials: true`.                |
| CSRF                 | **Disabled** — the API is stateless and uses bearer tokens.                      |
| Authentication       | Delegated to [Clerk](https://clerk.com). Session tokens verified via `ClerkAuthGuard`. |
| Session management   | Managed by Clerk (short-lived tokens, revocation, MFA).                          |
| Webhook signatures   | Clerk: `svix`. Payment providers: per-gateway verification.                      |
| Rate limiting        | `@nestjs/throttler` global guard. Default: 120 req / 60 s / IP.                  |
| Input validation     | Global `ValidationPipe` with `whitelist: true, forbidNonWhitelisted: true`.       |
| SQL injection        | Prisma parameterizes everything; **never** use `$queryRawUnsafe` with user input. |
| Sensitive log fields | `clerkId`, internal IDs, full headers — never logged.                            |
| HTTPS                | Terminated at the edge (reverse proxy / load balancer).                          |

### Throttler tuning

The global default (`THROTTLE_TTL=60000`, `THROTTLE_LIMIT=120`) is conservative. Override per-endpoint when needed:

- Webhooks: tighter (e.g. 30/min) to prevent replay floods, but rely primarily on signature + idempotency.
- Public catalog reads: looser (200+/min) since they're cacheable.

## Observability

| Layer    | Tool                                                                  |
| -------- | --------------------------------------------------------------------- |
| Logs     | `pino` + Nest `Logger`. JSON in prod, pretty in dev. `LOG_LEVEL` env. |
| Tracing  | OpenTelemetry-compatible (not yet wired). Plan: instrument HTTP + Prisma when scaling beyond one instance. |
| Metrics  | Pull from logs initially (count, latency from `LoggingInterceptor`). Switch to a metrics endpoint (`/metrics`) when you have a scrape target. |
| Health   | `GET /health` via `@nestjs/terminus`. Checks Postgres + Redis. Wire to LB liveness/readiness. |
| Errors   | All errors land in `AllExceptionsFilter` and are logged with the request path + correlation. Forward to Sentry/Bugsnag when added. |

### Slow-query log

`PrismaService` warns on queries > 250 ms. Treat each warning as a missing index, an N+1 query, or a service that should be paginating. **Don't raise the threshold**.

## Configuration

- **Source**: `@nestjs/config` reading `.env` files, with **Joi schema validation at boot**. A boot failure due to invalid env is preferable to a runtime crash.
- **Files**:
  - `.env` — local dev (gitignored). Copy from `.env.example`.
  - `.env.test` — test runs.
  - Production: env vars from the secret manager (no `.env` file in containers).

### Variables

| Variable                                                            | Required     | Default                 | Notes                                            |
| ------------------------------------------------------------------- | ------------ | ----------------------- | ------------------------------------------------ |
| `NODE_ENV`                                                          | yes          | `development`           | `development` / `test` / `production`            |
| `PORT`                                                              | no           | `3000`                  | HTTP port                                        |
| `APP_URL`                                                           | no           | `http://localhost:3000` | Public URL of this API (used in webhook docs + signed URLs) |
| `WEB_URL_ORIGIN`                                                        | yes          | `http://localhost:3001` | CORS origin (Next.js client)                     |
| `DATABASE_URL`                                                      | yes          | —                       | PostgreSQL DSN                                   |
| `PRISMA_LOG_QUERIES`                                                | no           | `false`                 | Log every SQL query at debug level               |
| `CLERK_PUBLISHABLE_KEY`                                             | yes          | —                       | Clerk publishable key                            |
| `CLERK_SECRET_KEY`                                                  | yes          | —                       | Clerk secret key (token verification)            |
| `CLERK_JWT_KEY`                                                     | no           | —                       | PEM for networkless verification (optional)      |
| `CLERK_WEBHOOK_SIGNING_SECRET`                                      | yes          | —                       | Svix secret for Clerk webhook signature          |
| `CLERK_AUTHORIZED_PARTIES`                                          | yes          | —                       | Comma-separated origins allowed in tokens        |
| `REDIS_URL`                                                         | no           | —                       | Required when reports cache is enabled           |
| `BREVO_API_KEY`                                                     | yes (prod)   | —                       | Brevo transactional email API key                |
| `BREVO_SENDER_NAME`                                                 | yes (prod)   | —                       | Email sender display name                        |
| `BREVO_SENDER_EMAIL`                                                | yes (prod)   | —                       | Verified sender email address                    |
| `BREVO_WEBHOOK_TOKEN`                                               | yes (prod)   | —                       | Bearer token compared on `POST /api/v1/webhooks/brevo` |
| `MAIL_PROVIDER`                                                     | no           | `brevo`                 | `brevo` (live) or `preview` (logs sends in dev — see [13-emails-brevo.md](./13-emails-brevo.md#dev-preview-mode)) |
| `STORAGE_PROVIDER`                                                  | yes          | `s3`                    | `s3` or `cloudinary`                             |
| `AWS_S3_BUCKET` / `AWS_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | conditional | — | When `STORAGE_PROVIDER=s3`                 |
| `AWS_S3_PUBLIC_URL`                                                 | conditional  | —                       | Public/CDN URL base for S3 objects; when `STORAGE_PROVIDER=s3` |
| `AWS_S3_ENDPOINT`                                                   | no (dev-only) | —                      | MinIO / LocalStack endpoint. **Must be empty in production** (env validator rejects otherwise) |
| `AWS_S3_FORCE_PATH_STYLE`                                           | no           | `false`                 | Set `true` for MinIO / LocalStack; leave `false` for AWS S3 |
| `CLOUDINARY_URL`                                                    | conditional  | —                       | When `STORAGE_PROVIDER=cloudinary`               |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`                       | conditional  | —                       | Stripe gateway                                   |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` / `PAYPAL_WEBHOOK_ID`   | conditional  | —                       | PayPal gateway                                   |
| `PAYPAL_ENV`                                                        | conditional  | `sandbox`               | `sandbox` or `live`; when PayPal is wired         |
| `BINANCE_PAY_API_KEY` / `BINANCE_PAY_API_SECRET`                    | conditional  | —                       | Binance Pay gateway                              |
| `LEMONSQUEEZY_API_KEY` / `LEMONSQUEEZY_STORE_ID` / `LEMONSQUEEZY_WEBHOOK_SECRET` | conditional | — | Lemon Squeezy gateway                  |
| `NOWPAYMENTS_API_KEY` / `NOWPAYMENTS_IPN_SECRET`                    | conditional  | —                       | NOWPayments gateway                              |
| `BITPAY_TOKEN`                                                      | conditional  | —                       | BitPay gateway API token                         |
| `BITPAY_ENV`                                                        | conditional  | `test`                  | `test` or `prod`; when BitPay is wired            |
| `BITPAY_NOTIFICATION_TOKEN`                                         | conditional  | —                       | Bearer token compared on `POST /api/v1/webhooks/bitpay` |
| `THROTTLE_TTL` / `THROTTLE_LIMIT`                                   | no           | `60000` / `120`         | Global throttler                                 |
| `LOG_LEVEL`                                                         | no           | `info`                  | pino log level                                   |
| `SENTRY_DSN`                                                        | no           | —                       | DSN for error tracking; absence disables Sentry (see [16-observability.md#error-tracking](./16-observability.md#error-tracking)) |
| `GIT_SHA`                                                           | no           | —                       | Release identifier injected by the deploy pipeline; tags Sentry events with the commit |

## Deployment

### Local

```bash
docker compose up -d postgres redis
pnpm install
npx prisma migrate dev
pnpm run start:dev
```

API at `http://localhost:3000/api/v1`; Swagger at `http://localhost:3000/api/docs`.

### `docker-compose.yml`

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: vg
      POSTGRES_PASSWORD: vg
      POSTGRES_DB: vg_api_db
    ports: ['5432:5432']
    volumes: ['pg_data:/var/lib/postgresql/data']
  redis:
    image: redis:7-alpine
    ports: ['6379:6379']
  api:
    build: .
    env_file: .env
    depends_on: [postgres, redis]
    ports: ['3000:3000']
volumes:
  pg_data:
```

### Production checklist

- [ ] `prisma migrate deploy` runs in the release pipeline (never `migrate dev`).
- [ ] `CLERK_SECRET_KEY` and `CLERK_WEBHOOK_SIGNING_SECRET` are stored in the secret manager.
- [ ] `CLERK_AUTHORIZED_PARTIES` locked to production origin(s) only.
- [ ] `WEB_URL_ORIGIN` locked to the production storefront origin(s) only.
- [ ] HTTPS terminated at the edge (LB/reverse proxy).
- [ ] Redis provisioned for the reports cache.
- [ ] Brevo API key configured; sender domain verified (SPF/DKIM/DMARC).
- [ ] Structured logs forwarded to the aggregator (Datadog / Logtail / Grafana Loki).
- [ ] Alerts on `/health` failures and on error-rate spikes (track `AllExceptionsFilter` log volume).
- [ ] `THROTTLE_*` set to production values.
- [ ] Payment webhook secrets configured and verified end-to-end with a provider test event.
- [ ] Clerk webhook endpoint tested with a `svix` test event.
- [ ] Swagger UI either disabled or behind VPN/auth in production.

### Scaling notes

- The monolith scales **horizontally** behind a load balancer. State is in Postgres + Redis — instances are stateless.
- The in-process event bus (`@nestjs/event-emitter`) means each event is delivered **once per instance** that produced it. Cross-instance fan-out (e.g. one Brevo mail sender, regardless of which API instance booked the order) requires moving to BullMQ + Redis.
- Rate limiting is per-instance with the in-memory throttler. For a fleet, switch to the Redis throttler storage so limits are global.
