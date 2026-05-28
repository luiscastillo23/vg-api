# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

It is an **index**, not a duplicate of `docs/architecture/`. Each section links to the canonical doc; update the canonical doc when behavior changes, then update the link here if it moved.

## Project state

This backend is in **scaffolding phase**. `src/` contains the Nest bootstrap (`main.ts`, `app.module.ts`, `app.controller.ts`, `app.service.ts`), the cross-cutting layer at `src/common/` (filters, interceptors, pipes, decorators, prisma, dto, utils — all globally registered in `main.ts`), and feature module skeletons at `src/modules/`. `src/modules/` holds DTO-only skeletons except `payments/gateways/`, which has `stripe.gateway.ts` and the `IPaymentGateway` interface. `AppModule.imports` only wires `ConfigModule` and `PrismaModule` so far — feature modules must each be added when their `@Module` class is created. Most of the architecture in `README.md` (guards, transactional checkout, providers other than Stripe, Brevo mailer, S3 uploads, chat gateway) is **planned, not implemented** — `README.md` is the target spec, the `docs/architecture/` set is the design.

> Earlier scaffolding placed `modules/` and `common/` at the repo root, but `nest-cli.json` sets `sourceRoot: src` and the jest `rootDir` is `src`, so anything outside `src/` is invisible to the build and test pipeline. Both directories have been consolidated under `src/` — do not recreate the root copies. See ADR-0008 for the rationale.

The Prisma schema is real: `prisma/schema.prisma`, init migration at `prisma/migrations/20260525153237_init/`. The client is generated to `generated/prisma/` via the new `provider = "prisma-client"` generator. **Import enums from `generated/prisma/enums`, model types from `generated/prisma/models`, `PrismaClient` from `generated/prisma/client`, and `PrismaClientKnownRequestError` from `@prisma/client/runtime/library`** — `@prisma/client` only exports the bare `PrismaClient` class with this generator. See ADR-0007.

## Commands

This is a **pnpm** workspace; do not use `npm` or `yarn`.

| Task                | Command                                  |
| ------------------- | ---------------------------------------- |
| Install             | `pnpm install`                           |
| Dev (watch)         | `pnpm start:dev`                         |
| Debug (inspector)   | `pnpm start:debug`                       |
| Build               | `pnpm build`                             |
| Prod                | `pnpm start:prod`                        |
| Lint (auto-fix)     | `pnpm lint`                              |
| Format              | `pnpm format`                            |
| Unit tests          | `pnpm test`                              |
| Single unit test    | `pnpm test -- path/to/file.spec.ts`      |
| Test by name        | `pnpm test -- -t "partial test name"`    |
| Watch tests         | `pnpm test:watch`                        |
| Coverage            | `pnpm test:cov`                          |
| E2E tests           | `pnpm test:e2e`                          |
| Prisma migrate      | `pnpm prisma migrate dev --name <slug>`  |
| Prisma deploy       | `pnpm prisma migrate deploy`             |
| Prisma studio       | `pnpm prisma studio`                     |
| Regen Prisma client | `pnpm prisma generate`                   |

Notes:
- Jest `rootDir` is `src/` (see `package.json#jest`) — unit specs live alongside source as `*.spec.ts`.
- E2E uses `test/jest-e2e.json` matching `*.e2e-spec.ts`.
- `typecheck` / `db:seed` / `verify` scripts mentioned in `README.md` do **not** exist in `package.json` yet — run `tsc --noEmit` directly via `pnpm exec` if you need typecheck.
- The local Postgres in `docker-compose.yml` is the only infra service wired up (no Redis / MinIO yet).
- Full deploy / rollback procedure: [`docs/runbooks/deploy.md`](docs/runbooks/deploy.md), [`docs/runbooks/rollback.md`](docs/runbooks/rollback.md).

## Non-negotiable architecture rules

These are the rules every PR must follow. Each links to its canonical source.

| Rule | Canonical source |
| ---- | ---------------- |
| **Modular monolith + 4 layers per module** (Controller → Service → Repository → Prisma) | [`docs/architecture/03-directory-structure.md`](docs/architecture/03-directory-structure.md), [`docs/architecture/05-patterns.md#layered-architecture`](docs/architecture/05-patterns.md#layered-architecture) |
| **`common/` holds cross-cutting concerns** (decorators, guards, filters, interceptors, pipes, Prisma module, shared utils) | [`docs/architecture/03-directory-structure.md`](docs/architecture/03-directory-structure.md) |
| **Global API prefix `/api/v1`** — never hardcode the prefix in controllers | [`docs/architecture/04-api-rest.md#conventions`](docs/architecture/04-api-rest.md#conventions) |
| **Fastify adapter** (`@nestjs/platform-fastify`), `fastify-raw-body` on `/webhooks/*`, `@fastify/helmet`, `@fastify/cors` | [`docs/architecture/01-stack.md`](docs/architecture/01-stack.md) |
| **Response envelope** wrapped by `TransformInterceptor` (`{ success, data, meta? }`) on top of `ValidationPipe` (`whitelist + forbidNonWhitelisted + transform`) and `ClassSerializerInterceptor` — controllers never hand-wrap | [`docs/architecture/04-api-rest.md#response-envelope`](docs/architecture/04-api-rest.md#response-envelope), [`docs/architecture/05-patterns.md#validation--dtos`](docs/architecture/05-patterns.md#validation--dtos) |
| **Global `ClerkAuthGuard`** with `@Public()` opt-out — auth delegated to Clerk; no local passwords | [`docs/architecture/08-auth-clerk.md`](docs/architecture/08-auth-clerk.md), [`docs/decisions/0003-delegate-auth-to-clerk.md`](docs/decisions/0003-delegate-auth-to-clerk.md) |
| **`RolesGuard` for ADMIN/MANAGER/CUSTOMER** via `@Roles(...)` — role read from local `User.role`, never from the token | [`docs/architecture/05-patterns.md#auth--rbac`](docs/architecture/05-patterns.md#auth--rbac), [`docs/architecture/08-auth-clerk.md#public--roles`](docs/architecture/08-auth-clerk.md#public--roles) |
| **`PrismaService.runInTransaction(fn)` for every multi-write business rule** (checkout, refund, balance adjust, top-up capture) — use the transactional `tx`, not `this.prisma` | [`docs/architecture/05-patterns.md#transactions`](docs/architecture/05-patterns.md#transactions), [`docs/architecture/07-data-flows.md`](docs/architecture/07-data-flows.md) |
| **Naming**: files `kebab-case.ts`, classes `PascalCase`, vars/functions `camelCase`, Prisma enums `SCREAMING_SNAKE_CASE` | [`docs/architecture/05-patterns.md#code-conventions`](docs/architecture/05-patterns.md#code-conventions) |
| **Path aliases `@common/*` and `@modules/*`** are the target — currently **not wired** in `tsconfig.json` or `nest-cli.json`; use relative imports until they're added (in both files) | [`docs/architecture/03-directory-structure.md#path-aliases`](docs/architecture/03-directory-structure.md#path-aliases) |
| **Stratification**: controllers never import `PrismaService`; services never import another module's repository; cross-module communication is via the other module's service **or** via `@nestjs/event-emitter` events | [`docs/architecture/05-patterns.md#layered-architecture`](docs/architecture/05-patterns.md#layered-architecture), [`docs/architecture/05-patterns.md#domain-events`](docs/architecture/05-patterns.md#domain-events) |

> Quick scaffolding template for a new feature module:
> ```
> modules/<feature>/
> ├── <feature>.module.ts        # imports PrismaModule, declares controller + service + repository
> ├── <feature>.controller.ts    # routes, guards, DTO validation; never calls Prisma
> ├── <feature>.service.ts       # business rules, events, transactions
> ├── <feature>.repository.ts    # Prisma calls, returns Prisma types
> ├── dto/                       # class-validator input + response DTOs
> ├── entities/                  # domain types (when richer than Prisma types)
> └── mappers/                   # Prisma -> DTO/entity
> ```
> New modules must be wired into `AppModule.imports` — adding a file alone does nothing.

## Cross-cutting wiring (target)

Global pipes/interceptors/guards live in `src/main.ts` (`ValidationPipe`, `ClassSerializerInterceptor`, helmet, CORS, raw-body for webhooks) and as global providers in `AppModule` (`TransformInterceptor`, `ClerkAuthGuard`, `RolesGuard`, `AllExceptionsFilter`, `PrismaExceptionFilter`, throttler). None of this is in code yet — add it in `main.ts` / `AppModule` when implementing; do not re-implement these inside individual controllers.

Full target wiring: [`docs/architecture/06-infrastructure.md`](docs/architecture/06-infrastructure.md), request lifecycle in [`docs/architecture/07-data-flows.md#request-lifecycle`](docs/architecture/07-data-flows.md#request-lifecycle).

## Persistence

- `common/prisma/PrismaModule` is `@Global()`, so `PrismaService` is injectable everywhere without re-importing.
- The soft-delete `$use` middleware is keyed by `softDeleteModels` (currently empty). Opt a model into soft delete by adding it to that set, not by rewriting delete logic per repository.
- Slow-query logging warns on queries > 250 ms — fix the index, don't raise the threshold.

Full schema intent, ownership table, polymorphism rules: [`docs/architecture/02-data-model.md`](docs/architecture/02-data-model.md).

## Pagination & response envelope

- List endpoints accept `common/dto/PaginationDto` (`page`, `limit ≤ 100`, `search`, `sortBy`, `sortOrder`).
- Repositories call `paginate(delegate, args, page, limit)` from `common/utils/paginate.ts`.
- The global `TransformInterceptor` reshapes the result into `{ success, data, meta }`. **Controllers must not hand-wrap responses.**

Full contract: [`docs/architecture/04-api-rest.md#response-envelope`](docs/architecture/04-api-rest.md#response-envelope), [`docs/architecture/04-api-rest.md#pagination-filtering--sorting`](docs/architecture/04-api-rest.md#pagination-filtering--sorting). Mirrored in `memory/response-envelope-shape.md` and `memory/pagination-contract.md`.

## Auth model

Authentication is **delegated entirely to Clerk** — no local password flow. `User.passwordHash` is non-optional in the current Prisma schema but **must never be populated**; treat it as a legacy artifact slated for removal. The `ClerkAuthGuard` verifies the Clerk session token via `@clerk/backend.verifyToken()` and attaches `req.auth = { userId, sessionId, orgId }` plus `req.user` (the local `User` mirror). `@Public()` opts a route out; `@Roles(Role.ADMIN, ...)` enforces role against the local `User.role`. Clerk webhooks (`POST /webhooks/clerk`) are Svix-signed and require the raw body.

Full design: [`docs/architecture/08-auth-clerk.md`](docs/architecture/08-auth-clerk.md). Decision rationale: [`docs/decisions/0003-delegate-auth-to-clerk.md`](docs/decisions/0003-delegate-auth-to-clerk.md). Mirrored in `memory/auth-model-clerk.md`.

## Domain events

Cross-module side effects flow through `@nestjs/event-emitter` — **never** by importing another module's service for fire-and-forget work, and **never** emitted from inside a `runInTransaction` callback (emit after commit). Full producer → consumer table: [`docs/architecture/05-patterns.md#domain-events`](docs/architecture/05-patterns.md#domain-events). Mirrored in `memory/domain-events-map.md`.

## Payments

All gateways implement `modules/payments/gateways/payment-gateway.interface.ts` (`createIntent`, `parseWebhook`, `refund`). `stripe.gateway.ts` is the reference implementation — copy its shape when adding PayPal / Binance Pay / Lemon Squeezy / NOWPayments / BitPay. Each gateway is `@Injectable()`; `PaymentGatewayFactory.get(name)` resolves the right one. Webhooks verify signatures against the **raw body** before any JSON parsing — `fastify-raw-body` is registered on `/api/v1/webhooks/*`.

Full design: [`docs/architecture/09-payments.md`](docs/architecture/09-payments.md), checkout sequence at [`docs/architecture/07-data-flows.md#checkout`](docs/architecture/07-data-flows.md#checkout), webhook sequence at [`docs/architecture/07-data-flows.md#payment-webhook`](docs/architecture/07-data-flows.md#payment-webhook). Decision rationale: [`docs/decisions/0005-payment-provider-abstraction.md`](docs/decisions/0005-payment-provider-abstraction.md).

## Wallet & ledger

`Balance` (mutable amount) + `LedgerEntry` (append-only motions). Every change to `Balance.amount` writes one `LedgerEntry` in the same transaction. Refunds credit the wallet **immediately**, before the gateway call ([`docs/decisions/0006-wallet-as-ledger.md`](docs/decisions/0006-wallet-as-ledger.md)) — drift surfaces in [`docs/runbooks/wallet-reconciliation.md`](docs/runbooks/wallet-reconciliation.md), not in user-visible state. Full design: [`docs/architecture/10-wallet.md`](docs/architecture/10-wallet.md).

## Environment variables

The canonical list — required/optional, defaults, group — lives in [`docs/architecture/06-infrastructure.md#configuration`](docs/architecture/06-infrastructure.md#configuration). The runnable template lives in [`.env.example`](.env.example) at the repo root; copy it to `.env` for local dev.

Adding a new variable:

1. Add a Joi validator to `@nestjs/config` so a bad value fails at boot, not at runtime.
2. If the variable controls behavior, document the env-vs-behavior mapping in the relevant `docs/architecture/*` file.

Provider-specific env groupings (Clerk, Brevo, S3/Cloudinary, Stripe/PayPal/etc., Redis, throttler) are each scoped in their respective architecture doc.

## Conventions

- **Logging:** inject `Logger` from `@nestjs/common` with the class name as context: `new Logger(MyService.name)`. Underlying logger is `pino`. Never `console.log`. Full policy: [`docs/architecture/16-observability.md#logs`](docs/architecture/16-observability.md#logs).
- **Errors:** throw Nest HTTP exceptions (`BadRequestException`, `NotFoundException`, `ConflictException`, …). The planned `PrismaExceptionFilter` maps `P2002` → 409, `P2025` → 404, `P2003` → 409 — do not catch-and-rethrow Prisma errors in services. Full policy: [`docs/architecture/04-api-rest.md#error-model`](docs/architecture/04-api-rest.md#error-model), [`docs/architecture/05-patterns.md#error-handling`](docs/architecture/05-patterns.md#error-handling).
- **TS config:** `strictNullChecks: true` but `noImplicitAny: false` and `strictBindCallApply: false` — explicit types preferred over `any`.

## Document index

`README.md` is the user-facing target spec. `docs/architecture/` is the engineering design set.

| File | Scope |
| ---- | ----- |
| [`docs/architecture/00-overview.md`](docs/architecture/00-overview.md) | What & why; bounded contexts |
| [`docs/architecture/01-stack.md`](docs/architecture/01-stack.md) | Runtime, framework (Fastify), libraries |
| [`docs/architecture/02-data-model.md`](docs/architecture/02-data-model.md) | Prisma schema explained |
| [`docs/architecture/03-directory-structure.md`](docs/architecture/03-directory-structure.md) | Repo layout + per-module shape |
| [`docs/architecture/04-api-rest.md`](docs/architecture/04-api-rest.md) | URL prefix, module map, envelope, errors, pagination |
| [`docs/architecture/05-patterns.md`](docs/architecture/05-patterns.md) | Layer rules, DTOs, auth, transactions, events |
| [`docs/architecture/06-infrastructure.md`](docs/architecture/06-infrastructure.md) | DB, cache, storage, mail, security, **env vars**, deployment |
| [`docs/architecture/07-data-flows.md`](docs/architecture/07-data-flows.md) | Request lifecycle, checkout, webhooks, refund, review |
| [`docs/architecture/08-auth-clerk.md`](docs/architecture/08-auth-clerk.md) | Clerk integration, guards, webhook sync |
| [`docs/architecture/09-payments.md`](docs/architecture/09-payments.md) | Gateway abstraction, webhook idempotency |
| [`docs/architecture/10-wallet.md`](docs/architecture/10-wallet.md) | Balance + ledger, invariants, reconciliation |
| [`docs/architecture/11-realtime-chat.md`](docs/architecture/11-realtime-chat.md) | Socket.IO gateway, rooms, scaling |
| [`docs/architecture/12-uploads.md`](docs/architecture/12-uploads.md) | Direct + presigned uploads, scopes |
| [`docs/architecture/13-emails-brevo.md`](docs/architecture/13-emails-brevo.md) | Templates, non-blocking sends, bounces |
| [`docs/architecture/14-reports.md`](docs/architecture/14-reports.md) | Aggregates, cache, exports |
| [`docs/architecture/15-security.md`](docs/architecture/15-security.md) | Threat model, controls, release checklist |
| [`docs/architecture/16-observability.md`](docs/architecture/16-observability.md) | Logs, metrics, traces, SLOs |
| [`docs/architecture/17-testing-strategy.md`](docs/architecture/17-testing-strategy.md) | Unit / integration / e2e / contract |

`docs/decisions/` (immutable ADRs — what we chose and why):

- [`0001-record-architecture-decisions.md`](docs/decisions/0001-record-architecture-decisions.md)
- [`0002-choose-pnpm.md`](docs/decisions/0002-choose-pnpm.md)
- [`0003-delegate-auth-to-clerk.md`](docs/decisions/0003-delegate-auth-to-clerk.md)
- [`0004-use-brevo-for-email.md`](docs/decisions/0004-use-brevo-for-email.md)
- [`0005-payment-provider-abstraction.md`](docs/decisions/0005-payment-provider-abstraction.md)
- [`0006-wallet-as-ledger.md`](docs/decisions/0006-wallet-as-ledger.md)

`docs/runbooks/` (operational playbooks):

- [`deploy.md`](docs/runbooks/deploy.md) — pre-flight + deploy + smoke
- [`rollback.md`](docs/runbooks/rollback.md) — when and how to revert
- [`clerk-webhook-failure.md`](docs/runbooks/clerk-webhook-failure.md)
- [`stripe-webhook-failure.md`](docs/runbooks/stripe-webhook-failure.md)
- [`wallet-reconciliation.md`](docs/runbooks/wallet-reconciliation.md)
- [`s3-outage.md`](docs/runbooks/s3-outage.md)
- [`incident-template.md`](docs/runbooks/incident-template.md) — postmortem template
