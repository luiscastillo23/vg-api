# 05 — Patterns & conventions

This file covers the in-code rules: how layers talk, how DTOs/validation work, how auth is structured, transactions, events, and code conventions.

> Section index: [Layered architecture](#layered-architecture) · [Validation & DTOs](#validation--dtos) · [Auth & RBAC](#auth--rbac) · [Transactions](#transactions) · [Domain events](#domain-events) · [Strategy pattern](#strategy-pattern) · [Logging](#logging) · [Error handling](#error-handling) · [Testing](#testing) · [Code conventions](#code-conventions)

## Layered architecture

Each feature module is split into four layers. **The dependency graph only points downward.**

```
Presentation (Controller, DTO, Pipe, Guard, Interceptor)
        ↓
Application (Service — use cases, orchestration)
        ↓
Domain (Entity, Value Object, domain rules)   [optional — only when justified]
        ↓
Infrastructure (Repository, external clients)
```

### Hard rules

1. **Controllers never call Prisma.** They call their own service.
2. **Services never import other modules' repositories.** Cross-module reads/writes go through the other module's *service* or via a domain event.
3. **Repositories return Prisma types.** The service maps them to DTOs/entities before they leave the module.
4. **DTOs are dumb.** No business logic. Validation decorators only.
5. **A single migration per logical change.** Don't bundle unrelated schema changes.

If you find yourself wanting to break a rule, that's usually a sign the module boundary is wrong — not the rule.

### Cross-module communication — decision tree

- **Need data from another module?** Call its service (e.g. `usersService.findById(id)`).
- **Need to react to something that happened in another module?** Subscribe to a domain event (e.g. `@OnEvent('order.created')`).
- **Need to mutate state in another module?** Call its service. Never write directly to a model your module doesn't own.
- **Need cyclic-looking dependencies (A calls B, B calls A)?** Promote the shared concept to a third module (or `common/`), or rebalance ownership.

## Validation & DTOs

A single global `ValidationPipe` is registered in `main.ts`:

```ts
app.useGlobalPipes(new ValidationPipe({
  whitelist: true,                  // strip unknown fields
  forbidNonWhitelisted: true,       // 400 if unknown fields present
  transform: true,                  // primitives coerced via class-transformer
  transformOptions: { enableImplicitConversion: true },
}));
```

### DTO conventions

- **One DTO per use case**, not per model. `CreateProductDto`, `UpdateProductDto`, `ProductQueryDto`, `ProductResponseDto` — each is shaped for its endpoint.
- **Optional fields** use `@IsOptional()` plus the type validator (`@IsString()`, `@IsNumber()`, etc.).
- **Money** uses `@IsNumber({ maxDecimalPlaces: 2 })` and is converted to `Decimal` in the mapper.
- **Slugs and emails** use `@Matches(...)` or `@IsEmail()` with explicit options (no defaults).
- **Response DTOs** mark sensitive fields with `@Exclude()` (e.g. `clerkId`, internal IDs). The global `ClassSerializerInterceptor` strips them before serialization.
- **Reuse**: `ProductQueryDto extends PaginationDto` instead of duplicating `page`, `limit`, etc.

## Auth & RBAC

### Authentication — [Clerk](https://clerk.com)

The backend **does not store passwords**, issue tokens, or manage OAuth flows. All of that is delegated to [Clerk](https://clerk.com). The backend's only responsibilities are:

1. **Verify** the Clerk session token on every request (`ClerkAuthGuard`, registered globally).
2. **Sync** the local `User` mirror via Clerk webhooks (`user.created`, `user.updated`, `user.deleted`).

The guard extracts the token from `Authorization: Bearer <token>`, calls `verifyToken()` from `@clerk/backend`, and attaches `{ userId, sessionId, orgId }` to the request.

### Roles

`Role` enum: `ADMIN`, `MANAGER`, `CUSTOMER`. Implementation:

- `@Roles(Role.ADMIN, Role.MANAGER)` decorator on a controller class or method.
- `RolesGuard` (global) reads the metadata and enforces.
- `@Public()` decorator opts a route out of `ClerkAuthGuard` entirely — used for public catalog, webhooks, and `/health`.

### Account lifecycle

```
Clerk user.created webhook  →  User { status: ACTIVE, clerkId }
Clerk user.updated webhook  →  User fields synced (email, name, avatar)
Clerk user.deleted webhook  →  User { status: INACTIVE } (or hard-delete per policy)
```

Sign-up, email verification, password resets, MFA, and social providers are managed entirely in Clerk's hosted UI and APIs. The backend receives the result via webhooks and keeps the local mirror up to date.

## Transactions

`PrismaService.runInTransaction(fn)` (defined in `src/common/prisma/prisma.service.ts:71`) is the **only** approved way to run multi-write business rules. Use it for:

- Checkout (validate stock, snapshot prices, create order/payment, decrement stock, debit balance, emit event).
- Refund (decrement order total, credit balance, write ledger entry).
- Balance adjust (write ledger + update balance).
- Any domain rule that must be atomic across two or more rows.

Inside the transaction callback, **use the transactional client passed in**, not `this.prisma`:

```ts
return this.prisma.runInTransaction(async (tx) => {
  await tx.order.create({ ... });
  await tx.payment.create({ ... });
  await tx.product.update({ where: { id }, data: { stock: { decrement: qty } } });
});
```

Common mistakes:

- ❌ Using `this.prisma.product.update(...)` inside the callback — runs **outside** the transaction.
- ❌ `await Promise.all([tx.x(), tx.y()])` for writes — Prisma's interactive transactions serialize writes; parallelizing offers no win and complicates debugging.
- ❌ Calling another module's repository from inside the callback — the other module owns its own transaction boundaries.

## Domain events

Producer/consumer table (intent — implement as modules grow):

| Event                    | Producer                       | Consumers                                  |
| ------------------------ | ------------------------------ | ------------------------------------------ |
| `order.created`          | `OrdersService.checkout`       | `NotificationsService`, `BrevoMailService` |
| `order.statusChanged`    | `OrdersService.updateStatus`   | `NotificationsService`                     |
| `payment.captured`       | `PaymentsService` (webhook)    | `OrdersService`, `NotificationsService`    |
| `refund.created`         | `RefundsService.create`        | `NotificationsService`, `BalanceService`   |
| `chat.message`           | `ConversationsService.send`    | `NotificationsService`                     |

Rules:

- Events are **in-process** (`@nestjs/event-emitter`) by default. Synchronous unless the consumer marks the handler `@OnEvent('...', { async: true })`.
- Producers **emit after** the transaction commits — never inside `runInTransaction()`. If the transaction rolls back, the event never fires.
- Consumers must be **idempotent**: a double-fire (manual replay, future migration to a queue) must not double-charge, double-mail, or double-write.
- When consumer count or latency outgrows in-process events, swap the bus for BullMQ + Redis. The producer/consumer surface (event name + payload) stays the same.

## Strategy pattern

Two places use the strategy pattern today:

### `PaymentGateway` (`payments` module)

```ts
export interface PaymentGateway {
  createIntent(order: Order): Promise<{ providerId: string; clientSecret?: string }>;
  verifyWebhook(headers: Record<string, string>, rawBody: Buffer): WebhookEvent;
}
```

Implementations: `StripeGateway`, `PayPalGateway`, `BinancePayGateway`, `LemonSqueezyGateway`, `NOWPaymentsGateway`, `BitPayGateway`. The provider is selected per request (the client sends a `provider` field). `OrdersService` knows nothing about the specific gateway.

### `StorageService` (`uploads` module)

S3 and Cloudinary adapters behind a common interface (`upload`, `getSignedUrl`, `delete`). Selected via `STORAGE_PROVIDER` env var.

## Logging

- Use `Logger` from `@nestjs/common` with the **class name as context**: `private readonly logger = new Logger(OrdersService.name);`.
- The underlying logger is `pino`. `LOG_LEVEL` env var controls verbosity.
- Never `console.log`. Never log secrets, tokens, full request bodies, or password fields.
- A global `LoggingInterceptor` records method, path, status, latency for every request.
- `PrismaService` already wires a query-event listener that warns on queries > 250 ms — add the index, don't silence the warning.

## Error handling

- Throw Nest's built-in HTTP exceptions: `NotFoundException`, `ConflictException`, `ForbiddenException`, `BadRequestException`, `UnauthorizedException`.
- Let `PrismaExceptionFilter` map Prisma error codes (P2002/P2025/P2003) — don't catch them in the service.
- Don't catch and re-wrap with the same exception class — that loses the original stack.
- Validation errors come from `class-validator` automatically; don't manually validate.
- Webhook handlers return `200 OK` even on internal error (after logging) so the provider doesn't replay forever — unless the error is "I haven't seen this event yet, retry me later" (`5xx`).

## Testing

- **Unit tests**: colocated as `*.spec.ts`. Mock the repository, not Prisma — the repo is the seam.
- **E2E tests**: `test/*.e2e-spec.ts`, run against an ephemeral Postgres (Testcontainers or `docker-compose up postgres`). `PrismaService.cleanDatabase()` truncates between specs and is **only callable outside production**.
- **Coverage gate** (suggested): 80% lines / 70% branches for `services/` and `repositories/`. No coverage requirement on DTOs or controllers — they're thin shells.
- Test the **business rule**, not the framework. "Stock decrements on checkout" is a test; "controller calls service" is not.

## Code conventions

| Topic                | Rule                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| File names           | `kebab-case.ts`                                                                        |
| Classes              | `PascalCase`                                                                           |
| Variables/functions  | `camelCase`                                                                            |
| Prisma enums         | `SCREAMING_SNAKE_CASE`                                                                 |
| Imports              | sorted: node → external → `@common/*` → `@modules/*` → relative                        |
| Branches             | `main` (protected), `develop`, `feat/*`, `fix/*`, `chore/*`, `refactor/*`              |
| Commits              | [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, …       |
| PRs                  | Lint + types pass; tests added/updated; migration named descriptively; no committed `.env`. |
| Comments             | Default: none. Add a one-liner only when the *why* is non-obvious.                     |

### TypeScript / NestJS

- Strict TS. No `any` without justification.
- One feature per module; export only what other modules need.
- Controllers stay thin (validate → service → response DTO).
- Global `ValidationPipe` with `whitelist`, `forbidNonWhitelisted`, `transform`.
- Response DTOs + `ClassSerializerInterceptor` to avoid leaking internal fields.
- Errors via `HttpException` subclasses or domain errors mapped by a global exception filter.

> The current branch is `master` with no commits yet. Initial commit is pending — when it lands, switch to the branch policy above.
