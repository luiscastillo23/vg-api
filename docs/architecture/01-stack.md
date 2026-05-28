# 01 — Tech stack

## Summary table

| Area              | Technology                                                  | Notes                                                          |
| ----------------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| Runtime           | Node.js ≥ 24 LTS                                              | Pinned via `.nvmrc` / `volta`.                                  |
| Language          | TypeScript ≥ 5.6.0                                               | Strict mode; `tsconfig.json` is the source of truth.            |
| Framework         | NestJS 11 (Fastify adapter via `@nestjs/platform-fastify`)  | Fastify chosen for throughput, schema-driven serialization, and first-class hooks. Raw-body access for webhook signature verification is handled via `fastify-raw-body` on the `/webhooks/*` routes. |
| ORM               | Prisma 6 (`prisma-client` generator)                        | Output to `generated/prisma/` — see "Critical gotcha" in `CLAUDE.md`. |
| Database          | PostgreSQL 16                                               | All invariants (FKs, uniques, cascades) enforced at the DB level. |
| Validation        | class-validator + class-transformer                         | Powers the global `ValidationPipe` and Swagger schema.          |
| Auth              | [Clerk](https://clerk.com) (`@clerk/backend` — framework-agnostic `verifyToken()`) | Delegation of sign-up, sign-in, MFA, and session token issuance. Token verification happens inside `ClerkAuthGuard`, so we don't need the Express- or Fastify-specific Clerk middleware. |
| Authorization     | `ClerkAuthGuard`, `RolesGuard` + `@Roles()` decorator       | Reads role from `User.role` (Prisma `Role` enum).               |
| Docs              | `@nestjs/swagger` (OpenAPI 3)                               | Served at `/api/docs`; JSON at `/api/docs-json`.                |
| Events            | `@nestjs/event-emitter`                                     | In-process, synchronous-by-default domain events.              |
| Rate limiting     | `@nestjs/throttler`                                         | Global guard, 120 req / 60 s / IP by default.                   |
| Security headers  | `helmet`                                                    | Plus strict CORS to `WEB_URL_ORIGIN`.                               |
| Logging           | `pino` + Nest `Logger`                                      | Structured JSON in production; pretty in dev.                   |
| Health checks     | `@nestjs/terminus`                                          | `GET /health` checks Postgres + Redis.                          |
| Cache             | `cache-manager` + Redis 7                                   | Currently scoped to the `reports` module (5–15 min TTL).        |
| Mail              | [Brevo](https://www.brevo.com) (`@getbrevo/brevo` SDK)      | Transactional email templates rendered and managed in Brevo.    |
| Object storage    | S3 **or** Cloudinary (strategy)                             | Selected by `STORAGE_PROVIDER` env var.                         |
| Payments          | Stripe **or** PayPal (strategy)                             | Behind a `PaymentGateway` interface. Webhooks are signature-verified and idempotent. |
| Testing           | Jest + Supertest                                            | Unit colocated; e2e under `test/` with an ephemeral Postgres.   |
| Container         | Docker + docker-compose                                     | `docker-compose.yml` brings up Postgres + Redis for local dev.  |

## What's installed today vs. promised

`package.json` currently pins only the bare minimum for a Nest 11 + Prisma 6 + Stripe + Swagger + class-validator project. **Many libraries above are referenced by the README but not yet installed.** Before relying on them, install them and wire them into `app.module.ts` (or a dedicated config module).

Not yet present in `package.json` (as of the initial scaffold):

- `@nestjs/platform-fastify`, `fastify`, `fastify-raw-body` *(replaces the currently-installed `@nestjs/platform-express`; swap in `main.ts` when wiring is done)*
- `@clerk/backend`, `@clerk/fastify` (or framework-agnostic verification via `@clerk/backend` alone), `svix`
- `@nestjs/event-emitter`
- `@nestjs/throttler`
- `@fastify/helmet` *(Fastify equivalent of `helmet`; the plain `helmet` package is Express-only)*
- `@fastify/cors`
- `pino`, `nestjs-pino` (or equivalent)
- `@nestjs/terminus`, `@nestjs/axios`
- `cache-manager`, `cache-manager-ioredis-yet`, `ioredis`
- `@getbrevo/brevo`
- `@aws-sdk/client-s3` / `@aws-sdk/s3-request-presigner` / `cloudinary`
- `joi` (for env validation in `@nestjs/config`)
- `compression` (`@fastify/compress` if you want it managed by Fastify directly)

Install them in the order modules need them — don't pre-install the full list and call it done.

## Versioning policy

- **Node.js**: pinned to the active LTS (currently 20). Bump when 22 reaches LTS.
- **NestJS**: stay on the current major; track minors actively, majors in their own PR.
- **Prisma**: bump on minors freely; majors require regenerating client + reviewing migration semantics.
- **TypeScript**: track Nest's supported version (currently 5.x).

## Why these choices (the short version)

- **NestJS over bare Node**: dependency injection, testable layering, first-class decorators for guards/interceptors/pipes, and `@nestjs/swagger` keeps the OpenAPI spec accurate with zero extra bookkeeping.
- **Fastify adapter over Express**: ~2× throughput on a JSON-heavy commerce API, native schema validation, and hooks (`onRequest`, `preHandler`, `onSend`) compose cleanly with Nest's guards/interceptors. Webhook raw-body access uses `fastify-raw-body` scoped to `/webhooks/*`.
- **Prisma over a query builder**: the schema *is* the documentation; migrations are diff-driven; the type-safety from generated types catches whole classes of bugs at compile time.
- **PostgreSQL over a NoSQL store**: this is a transactional commerce system — orders/payments/ledger entries demand FKs, uniques, and atomic multi-row writes.
- **Clerk over custom JWT auth**: Delegates the complexity of authentication, passwords, MFA, session management, and rotation to a specialized provider.
- **Brevo over SMTP/Nodemailer**: Abstracts email templating and reliable deliverability via a modern SDK instead of managing raw SMTP connections.
- **Strategy pattern for storage and payments**: lets us swap providers per environment (S3 in prod, MinIO in dev; Stripe live, Stripe test) without touching `OrdersService` or `UploadsService`.
- **Event emitter (in-process) before BullMQ**: avoids premature infra. Move to a queue when a single instance can no longer absorb the fan-out (mail, analytics rollups).

See [06-infrastructure.md](./06-infrastructure.md) for runtime details on each.
