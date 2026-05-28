# 04 — REST API

## Conventions

- **Prefix**: every route is mounted under `/api/v1`. Set in `main.ts` via `app.setGlobalPrefix('api/v1')`. Never hardcode the prefix in controllers.
- **Verbs**: `GET` (read), `POST` (create or non-idempotent action), `PATCH` (partial update), `PUT` (full replace — rare here), `DELETE` (remove).
- **Plural resources**: `/products`, `/orders`, `/users`. Sub-resources are nested when ownership is strict: `/products/:id/reviews`.
- **IDs**: CUIDs in path params. Use `ParseUUIDPipe` only for UUIDs (we don't currently issue any). Plain strings are fine for CUIDs; validate with class-validator if needed.
- **Slugs**: public detail endpoints accept a slug for SEO: `GET /products/:slug` (resolution happens in the service; controller does not care which form).
- **Versioning**: only `/api/v1`. A breaking change ships as `/api/v2`. In-place breaking changes are forbidden.

## Module map

| Module             | Base path                              | Audience                |
| ------------------ | -------------------------------------- | ----------------------- |
| Auth Webhooks      | `/webhooks/clerk`                      | Public (Svix Signature) |
| Users (admin)      | `/users/*`                             | Admin                   |
| Account (self)     | `/account/*`                           | Authenticated (Clerk)   |
| Categories         | `/categories/*`                        | Public + Admin          |
| Subcategories      | `/subcategories/*`                     | Public + Admin          |
| Products           | `/products/*`                          | Public + Admin          |
| Services           | `/services/*`                          | Public + Admin          |
| Cart               | `/cart/*`                              | Authenticated (Clerk)   |
| Favorites          | `/favorites/*`                         | Authenticated (Clerk)   |
| Orders             | `/orders/*`                            | Authenticated (Clerk) + Admin |
| Payments           | `/payments/*`                          | Authenticated (Clerk) + Webhook |
| Refunds            | `/refunds/*`                           | Admin                   |
| Reviews            | `/reviews/*`, `/products/:id/reviews`  | Public + Authenticated (Clerk) |
| Conversations      | `/conversations/*`                     | Authenticated (Clerk)   |
| Balance / Ledger   | `/account/balance/*`                   | Authenticated (Clerk) + Admin |
| Notifications      | `/notifications/*`                     | Authenticated (Clerk)   |
| Uploads            | `/uploads/*`                           | Authenticated (Clerk) + Admin |
| Reports            | `/reports/*`                           | Admin                   |
| Health             | `/health`                              | Public                  |
| OpenAPI            | `/api/docs`                            | Public (dev only)       |

"Public" = `@Public()` decorator on the route. "Authenticated (Clerk)" = default (`ClerkAuthGuard` is global; validates the Clerk session token from `Authorization: Bearer <token>`). "Admin" = `@Roles(Role.ADMIN)` (sometimes plus `Role.MANAGER`).

## Selected endpoint contracts

### Auth Webhooks — `/webhooks/clerk`

Sign-up, sign-in, MFA, password resets, and social providers are fully delegated to [Clerk](https://clerk.com). The backend does **not** expose `/auth/sign-up`, `/auth/sign-in`, or any token-rotation endpoints. Instead, a single webhook endpoint keeps the local user mirror in sync:

| Method | Path               | Auth                    | Description                                                       |
| ------ | ------------------ | ----------------------- | ----------------------------------------------------------------- |
| POST   | `/webhooks/clerk`  | Public (Svix Signature) | Receives Clerk events (`user.created`, `user.updated`, `user.deleted`, `organization.*`) to sync users to Postgres |
| GET    | `/account/me`      | Authenticated (Clerk)   | Returns the current authenticated user's local profile            |

### Catalog

- Public: `GET /categories`, `GET /categories/:slug`, `GET /products` (with filters), `GET /products/:slug`, plus the same for `/services` and `/subcategories`.
- Admin/Manager: `POST/PATCH/DELETE` on the same paths; plus `PATCH /products/:id/stock` for stock adjustments.
- Filters on `GET /products`: `search`, `categoryId`, `subcategoryId`, `minPrice`, `maxPrice`, `featured`, `bestSeller`, `onSale`, `status`. All optional.

### Commerce

- Cart (Clerk): `GET /cart`, `POST /cart/items`, `PATCH /cart/items/:id`, `DELETE /cart/items/:id`, `DELETE /cart` (clear).
- Orders (Clerk + Admin): `POST /orders/checkout`, `GET /orders` (self for customer, all for admin), `GET /orders/:id`, `PATCH /orders/:id/status` (admin), `POST /orders/:id/cancel`.
- Payments: `POST /payments/checkout` (Clerk — kicks off provider flow), `POST /webhooks/:provider` (Public, signature-verified, idempotent).
- Refunds (Admin): `POST /refunds`, `GET /refunds/:id`, `GET /refunds`.

### Wallet / Balance — `/account/balance/*`

| Method | Path                          | Auth                        | Description                                                |
| ------ | ----------------------------- | --------------------------- | ---------------------------------------------------------- |
| GET    | `/account/balance`            | Authenticated (Clerk)       | Current user balance                                       |
| GET    | `/account/balance/movements`  | Authenticated (Clerk)       | Paginated ledger entries (`LedgerEntry`)                   |
| POST   | `/account/balance/top-up`           | Authenticated (Clerk)       | Creates a payment intent to credit the wallet              |
| GET    | `/users/:userId/balance`            | Admin                       | Read any user's balance + ledger (admin namespace)         |
| POST   | `/users/:userId/balance/credit`     | Admin                       | Admin manual credit with reason                            |
| POST   | `/users/:userId/balance/debit`      | Admin                       | Admin manual debit with reason                             |

All credit/debit operations are atomic: they update `Balance.amount` and write a matching `LedgerEntry` inside a single `prisma.$transaction`.

### Real-time chat — `/ws/chat`

| Transport | Path       | Auth                  | Description                                          |
| --------- | ---------- | --------------------- | ---------------------------------------------------- |
| WebSocket | `/ws/chat` | Clerk session token   | Socket.IO gateway for in-order conversations         |

- Connection handshake is authenticated with the Clerk session token.
- Conversations are scoped to an order; participants are the customer and admin/manager.
- Features: persistent messages, read receipts, typing indicators.
- Messages are persisted in Postgres (`Conversation` + `Message` models) and emit `chat.message` domain events for `NotificationsService`.

### Reports (Admin only) — `/reports/*`

All reports accept `ReportQueryDto { from, to, granularity, kind? }` and return cached aggregates (Redis, 5–15 min TTL). Endpoints power every chart in the admin dashboard:

| Method | Path                              | Description                          |
| ------ | --------------------------------- | ------------------------------------ |
| GET    | `/reports/kpis`                   | Key performance indicators           |
| GET    | `/reports/revenue`                | Revenue over time                    |
| GET    | `/reports/sales`                  | Sales volume                         |
| GET    | `/reports/categories`             | Category distribution                |
| GET    | `/reports/top-products`           | Top-selling products                 |
| GET    | `/reports/top-services`           | Top-selling services                 |
| GET    | `/reports/recent-orders`          | Recent orders feed                   |
| GET    | `/reports/registrations`          | User registrations over time         |
| GET    | `/reports/activity`               | User activity metrics                |
| GET    | `/reports/alerts`                 | Low stock, anomaly alerts            |
| GET    | `/reports/refunds`                | Refund analytics                     |
| GET    | `/reports/best-sellers`           | Best-sellers ranking                 |
| GET    | `/reports/clv`                    | Customer lifetime value              |
| GET    | `/reports/balance`                | Wallet/balance metrics               |
| GET    | `/reports/performance`            | Catalog / services performance       |

On-demand CSV / Excel / PDF exports are available for sales, wallet movements, payments by gateway, user activity, and more.

## Response envelope

Every successful response is wrapped by a global `TransformInterceptor`:

```json
{
  "success": true,
  "data": { /* payload */ },
  "meta": { /* optional, e.g. pagination */ }
}
```

Paginated responses lift the `items` array into `data` and place `{ total, page, limit, pages, hasNext }` into `meta`:

```json
{
  "success": true,
  "data": [ /* items */ ],
  "meta": { "total": 137, "page": 1, "limit": 20, "pages": 7, "hasNext": true }
}
```

Controllers **return raw values or `paginate()` results** — they never construct the envelope themselves. The interceptor handles it.

## Error model

All errors flow through `AllExceptionsFilter` (and `PrismaExceptionFilter` chained for Prisma errors):

```json
{
  "success": false,
  "statusCode": 409,
  "timestamp": "2026-05-11T17:22:12.407Z",
  "path": "/api/v1/products",
  "error": { "message": "Duplicate value for sku" },
  "code": "P2002"
}
```

Prisma error mapping:

| Prisma code | HTTP status   | Meaning                       |
| ----------- | ------------- | ----------------------------- |
| `P2002`     | 409 Conflict  | Unique constraint violation   |
| `P2025`     | 404 Not Found | Record not found              |
| `P2003`     | 409 Conflict  | Foreign key violation         |
| others      | 409 Conflict  | Generic DB error              |

Validation errors raised by `class-validator` → `400 Bad Request` with a `details` array listing field-level violations.

Auth errors:
- Missing/invalid access token → `401 Unauthorized`
- Authenticated but wrong role → `403 Forbidden` (with `Requires role: <role>` message)
- Throttler hit → `429 Too Many Requests`

## Pagination, filtering & sorting

All list endpoints accept the shared `PaginationDto`:

```ts
class PaginationDto {
  page?: number = 1;          // 1-based
  limit?: number = 20;         // 1..100
  sortBy?: string;             // module-specific allowlist
  sortOrder: 'asc' | 'desc' = 'desc';
  search?: string;             // optional free-text
}
```

The `paginate(repo, query, options)` helper (`src/common/utils/`) returns `{ items, total, page, limit, pages, hasNext }`. Module-specific query DTOs **extend** `PaginationDto` and add typed filters — never accept arbitrary `where` clauses from the client.

`sortBy` is **always allowlisted** in the service (e.g. `['createdAt', 'price', 'popularity']` for products). An unknown value falls back to `createdAt`.

## OpenAPI / Swagger

- UI: `http://localhost:3000/api/docs`
- JSON: `http://localhost:3000/api/docs-json`
- Bearer auth registered via `addBearerAuth()` in `main.ts` (token format: `Clerk Token`).
- Every DTO field carries `@ApiProperty()` (or `@ApiPropertyOptional()`) — required for accurate schema rendering.
- Paginated endpoints use a shared `@ApiPaginated(ItemDto)` decorator that declares the envelope's `meta` shape.
- In production, the docs are either disabled or gated behind a VPN/auth (decision: per-environment toggle in `main.ts`).

## Webhook endpoints

| Method | Path                                | Verification                                         |
| ------ | ----------------------------------- | ---------------------------------------------------- |
| POST   | `/api/v1/webhooks/clerk`            | Svix HMAC (`CLERK_WEBHOOK_SIGNING_SECRET`)            |
| POST   | `/api/v1/webhooks/:provider`        | Per-gateway signature (`:provider` ∈ stripe, paypal, binance-pay, lemonsqueezy, nowpayments, bitpay) |
| POST   | `/api/v1/webhooks/brevo`            | Bearer token (`BREVO_WEBHOOK_TOKEN`) — delivery / bounce / complaint |

Payment webhooks are `POST /api/v1/webhooks/:provider`. Clerk webhooks are `POST /api/v1/webhooks/clerk`. Brevo delivery webhooks land at `/api/v1/webhooks/brevo`:

- `@Public()` (no Clerk session token — external providers can't carry our tokens).
- **Payment webhooks**: Signature verified via the gateway's `verifyWebhook(headers, rawBody)`. The raw body is preserved by registering `fastify-raw-body` for the `/webhooks/*` routes — JSON parsing destroys the signature.
- **Clerk webhooks**: Signature verified via `svix` using `CLERK_WEBHOOK_SIGNING_SECRET`.
- **Idempotent**: each event ID is recorded; a replay returns `200 OK` without re-processing.
- On `payment.captured`, the handler calls `OrdersService.markPaid(orderId)` which transitions to `PAID` and emits `order.statusChanged`.
- On Clerk `user.created` / `user.updated` / `user.deleted`, the handler syncs the local user mirror in Postgres.

See [07-data-flows.md](./07-data-flows.md) for the full webhook flow.

## Health endpoint

`GET /health` (powered by `@nestjs/terminus`) checks Postgres + Redis and returns:

```json
{
  "status": "ok",
  "info": {
    "postgres": { "status": "up" },
    "redis": { "status": "up" }
  },
  "details": { /* same */ }
}
```

`200 OK` if everything is up; `503 Service Unavailable` otherwise. Wire this to your load balancer's liveness/readiness probe.
