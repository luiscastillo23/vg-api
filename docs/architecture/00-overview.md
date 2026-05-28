# 00 — Overview

## What is VirtualGifts API

VirtualGifts API is the backend for the **VirtualGifts** platform: a Next.js storefront and admin back-office that sells both digital **products** and bookable **services** through a single shared flow of cart → order → payment.

It is a **NestJS 11 modular monolith** on top of **Prisma 6 / PostgreSQL 16**, exposing a versioned REST API at `/api/v1`. The same backend serves the public storefront, the authenticated customer area, and the admin dashboard — separated by role-based authorization, not by service boundary.

> The `README.md` at the repo root is a *target* specification. The current `src/` tree is early scaffolding (only `ConfigModule` + `PrismaModule` are wired in `app.module.ts`). This document set describes the **intended** architecture; verify or build the supporting infrastructure as you go.

## Bounded contexts

The product is split into the following functional domains. Each becomes a feature module under `src/modules/`:

| Context              | Responsibility                                                              | Module(s)                                  |
| -------------------- | --------------------------------------------------------------------------- | ------------------------------------------ |
| Identity & access    | Authentication (Clerk), session verification, webhook sync, RBAC           | `auth`, `users`                            |
| Catalog              | Categories, subcategories, products, services, search/filter/sort           | `categories`, `subcategories`, `products`, `services` |
| Commerce             | Cart, favorites, checkout, orders, payments, refunds                        | `cart`, `favorites`, `orders`, `payments`, `refunds` |
| Engagement           | Reviews, in-order conversations, notifications                              | `reviews`, `conversations`, `notifications` |
| Wallet               | User balance + ledger (double-entry-lite)                                   | `balance`                                  |
| Infrastructure-ish   | File uploads (S3/Cloudinary), admin reports/analytics                       | `uploads`, `reports`                       |

Cross-cutting concerns (validation pipe, exception filters, response interceptor, guards, decorators, Prisma module) live in `src/common/`.

## Architectural choices in one paragraph

A **modular monolith** with **layered (clean-ish) architecture per module** — Presentation → Application → Domain → Infrastructure. Cross-module communication goes through **services or domain events** (`@nestjs/event-emitter`), never through reaching into another module's repository. Multi-write business rules (checkout, refund, balance adjustment) run inside `PrismaService.runInTransaction()`. Authorization is centralized in two global guards (`ClerkAuthGuard`, `RolesGuard`) toggled per route via `@Public()` and `@Roles()` decorators.

This is **DDD-lite**: feature modules are domain-oriented, but we don't ship a separate domain layer purely for ceremony. Entities and value objects appear when business rules justify them; otherwise services orchestrate Prisma directly through repositories.

## High-level request lifecycle

```
Client (Next.js)
  → Middleware (helmet, CORS, raw-body for webhooks)
  → Guards (ClerkAuthGuard, RolesGuard, ThrottlerGuard)
  → Pipes (ValidationPipe, ParseUUIDPipe)
  → Interceptors (logging, timeout) [before]
  → Controller
  → Service (use case)
  → Repository (Prisma)
  → PostgreSQL
  ← Mapper (Prisma type → DTO)
  ← Interceptor [after] (TransformInterceptor envelope)
  ← Filter (AllExceptionsFilter / PrismaExceptionFilter, on error)
Client
```

See [07-data-flows.md](./07-data-flows.md) for concrete flows (checkout, webhooks, Clerk user lifecycle).

## Document map

| File                                                       | Scope                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------ |
| [00-overview.md](./00-overview.md)                         | This file. What and why.                                            |
| [01-stack.md](./01-stack.md)                               | Runtime, framework, libraries, and why each was picked.             |
| [02-data-model.md](./02-data-model.md)                     | Prisma schema explained: enums, models, relations, conventions.     |
| [03-directory-structure.md](./03-directory-structure.md)   | Repo layout and per-module internal layout.                         |
| [04-api-rest.md](./04-api-rest.md)                         | URL prefix, route map, envelope, errors, pagination, OpenAPI.       |
| [05-patterns.md](./05-patterns.md)                         | Layer rules, DTO/validation, auth/RBAC, transactions, events, conventions. |
| [06-infrastructure.md](./06-infrastructure.md)             | Database, cache, storage, mail, observability, security, deployment. |
| [07-data-flows.md](./07-data-flows.md)                     | End-to-end flows: checkout, webhooks, Clerk user lifecycle. |
| [08-auth-clerk.md](./08-auth-clerk.md)                     | Clerk integration, session verification, webhooks, user sync. |
| [09-payments.md](./09-payments.md)                         | Provider abstraction, idempotency, webhook security. |
| [10-wallet.md](./10-wallet.md)                             | Ledger, transactions, concurrency, reconciliation. |
| [11-realtime-chat.md](./11-realtime-chat.md)               | WS gateway, rooms, presence, scaling. |
| [12-uploads.md](./12-uploads.md)                           | S3 presigned URLs, lifecycle, antivirus. |
| [13-emails-brevo.md](./13-emails-brevo.md)                 | Templates, transactional events, deliverability. |
| [14-reports.md](./14-reports.md)                           | Generation pipeline, async jobs, exports. |
| [15-security.md](./15-security.md)                         | Threat model, secrets, PII, rate-limiting. |
| [16-observability.md](./16-observability.md)               | Logs, metrics, tracing, alerts, SLOs. |
| [17-testing-strategy.md](./17-testing-strategy.md)         | Unit / e2e / contract / load tests. |
