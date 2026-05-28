```
<div align="center">

# 🚀 VirtualGifts API

Is the backend for the **VirtualGifts** platform: a Next.js e-commerce + services storefront with an admin back-office. It is a **NestJS 11 modular monolith** built on **Prisma 6 (PostgreSQL)**, **class-validator / class-transformer**, authentication delegated to [Clerk](https://clerk.com/), transactional email via Brevo, and AWS S3 file storage and **Swagger (OpenAPI)**.

This README is the single entry point for engineers: it tells you **what the project is**, **how it is organised**, **how to run it**, and **where to look** for deeper documentation.

[![NestJS](https://img.shields.io/badge/NestJS-10-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![pnpm](https://img.shields.io/badge/pnpm-9.x-F69220?logo=pnpm&logoColor=white)](https://pnpm.io)
[![Clerk](https://img.shields.io/badge/Auth-Clerk-6C47FF?logo=clerk&logoColor=white)](https://clerk.com)
[![Swagger](https://img.shields.io/badge/Swagger-OpenAPI%203.1-85EA2D?logo=swagger&logoColor=black)](https://swagger.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

## 📚 Table of contents

- [1. Overview](#overview)
- [2. Tech stack](#tech-stack)
- [3. Features](#features)
- [4. Architecture](#architecture)
- [5. Project structure](#project-structure)
- [6. Prerequisites](#prerequisites)
- [7. Installation](#installation)
- [8. Environment variables](#environment-variables)
- [9. Running the API](#running)
- [10. Available scripts](#available-scripts)
- [11. API documentation (Swagger)](#api-documentation-swagger)
- [12. Authentication (Clerk)](#authentication-clerk)
- [13. Validation & serialization](#validation-serialization)
- [14. API surface (module map)](#api-surface)
- [15. Pagination, filtering & sorting](#pagination)
- [16. Events & background work](#events)
- [17. Payment integrations](#payment-integrations)
- [18. Webhooks](#webhooks)
- [19. Wallet system](#wallet-system)
- [20. Real-time chat](#real-time-chat)
- [21. File uploads (AWS S3)](#file-uploads-aws-s3)
- [22. Email (Brevo)](#email-brevo)
- [23. Reports](#reports)
- [24. Testing](#testing)
- [25. Linting & formatting](#linting-formatting)
- [26. Observability, security & rate limiting](#observability)
- [27. Database & migrations](#database-migrations)
- [28. Docker](#docker)
- [29. Coding conventions](#conventions)
- [30. Deployment](#deployment)
- [31. Agents folder (`.agents/`)](#agents-folder-agents)
- [32. Documentation (`docs/`)](#documentation-docs)
- [33. Contributing](#contributing)
- [34. Troubleshooting](#troubleshooting)
- [35. License](#license)

---

## 1. 🧭 Overview <a id="overview"></a>

**VirtualGifts API** powers the VirtualGifts storefront and admin dashboard for a marketplace that markets both digital **products** and bookable **services**, through a shared flow of cart, orders and payments. It exposes a versioned REST API under `/api/v1` consumed by a Next.js client. It implements all bounded contexts of the product: **auth, users, catalog (categories, subcategories, products, services), cart, favorites, orders, payments, refunds, reviews, conversations, balance, notifications, uploads and reports**.

The architecture is a **Modular Monolith** following **Layered (Clean) Architecture** with **Domain-oriented Feature Modules** — a pragmatic, DDD-lite approach. Each feature module is internally split into four layers (Presentation, Application, Domain, Infrastructure) and shares cross-cutting concerns via a single `common/` module.

Built on **NestJS 10**, written in **TypeScript**, and managed with **pnpm**.

## 2. 🛠 Tech stack <a id="tech-stack"></a>

| Concern              | Choice                                                                 |
| -------------------- | ---------------------------------------------------------------------- |
| Runtime              | Node.js ≥ 24 LTS                                                       |
| Framework            | NestJS 11                                                              |
| Language             | TypeScript ≥ 5.6.0                                                          |
| Package manager      | **pnpm** 11                                                             |
| HTTP adapter         | Fastify                                                                |
| Validation           | `class-validator` + `class-transformer`                                |
| API docs             | `@nestjs/swagger` (OpenAPI 3.1)                                        |
| Auth                 | [Clerk](https://clerk.com) (`@clerk/backend` + `@clerk/express`)       |
| Email                | [Brevo](https://www.brevo.com) (`@getbrevo/brevo` SDK)                 |
| Storage              | AWS S3 via `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`      |
| Real-time            | `@nestjs/websockets`, `socket.io`                                      |
| Payments             | Stripe · PayPal · Binance Pay · Lemon Squeezy · NOWPayments · BitPay   |
| Reports              | `exceljs`, `pdfkit` / `puppeteer`, `csv-stringify`                     |
| ORM                  | Prisma                                                                 |
| Database             | PostgreSQL 16                                                          |
| Cache / queues       | Redis + BullMQ                                                         |
| Container            | Docker / Docker Compose                                                |
| Testing              | Jest + Supertest                                                       |
| Observability        | Pino logger · OpenTelemetry                                            |

## 3. ✨ Features <a id="features"></a>

- 🔐 **Clerk-powered auth** (authentication is delegated entirely to [Clerk](https://clerk.com)).
- 👛 **Internal wallet** (top-ups, balances, ledger, purchases).
- 💳 **Payments**: Stripe, PayPal, Binance Pay, Lemon Squeezy, NOWPayments, BitPay.
- 📧 **Transactional email** via [Brevo](https://www.brevo.com).
- ☁️ **File uploads** to AWS S3 with presigned URLs.
- 💬 **Real-time chat** between support and clients (Socket.IO).
- 📊 **Reports** in CSV / Excel / PDF.
- 🧪 **Validation** with `class-validator` + `class-transformer`.
- 📚 **Swagger** auto-generated documentation.
- 🧪 Unit + e2e tests with coverage gates.
- 🐳 Production-ready Dockerfile + docker-compose for local dev.

## 4. 🧱 Architecture <a id="architecture"></a>

The service follows a **layered + modular** architecture inspired by Domain-Driven Design:

HTTP ─▶ Controllers ─▶ Services ─▶ Repositories ─▶ Database / External APIs
│
└─▶ Providers (Email, Storage, Payments)

See Detailed architectural docs live in [`docs/architecture/`](./docs/architecture) and [`docs/architecture/07-data-flows.md`](docs/architecture/07-data-flows.md) for sequence diagrams of the most relevant flows (checkout, webhook reconciliation, Clerk user lifecycle).

## 5. 🗂 Project structure <a id="project-structure"></a>

```bash
vg-api/
├── .agents/                     # Agents skills and configs
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts                  # [Target] Not yet present
├── generated/                   # Prisma generated code
├── common/                      # Common code shared across modules (at root level)
│   ├── decorators/              # @CurrentUser, @Roles, @Public
│   ├── dto/                     # PaginationDto
│   ├── prisma/                  # PrismaService, PrismaModule
│   └── utils/                   # order-code, paginate, slugify
│   # ─── Target directories to be added ───
│   # ├── filters/               # all-exceptions, prisma-exception
│   # ├── guards/                # clerk-auth, roles, optional-auth
│   # ├── interceptors/          # transform, logging, timeout
│   # ├── pipes/                 # parse-object-id, trim
│   # └── enums/                 # Role, OrderStatus, PaymentStatus
├── modules/                     # Feature modules (at root level; currently contain DTO skeletons)
│   ├── auth/                    # DTOs only
│   ├── balance/                 # DTOs only
│   ├── cart/                    # DTOs only
│   ├── categories/              # DTOs only
│   ├── conversations/           # DTOs only
│   ├── favorites/               # DTOs only
│   ├── notifications/           # DTOs only
│   ├── orders/                  # DTOs only
│   ├── payments/                # DTOs and gateways
│   ├── products/                # DTOs only
│   ├── refunds/                 # DTOs only
│   ├── reports/                 # DTOs only
│   ├── reviews/                 # DTOs only
│   ├── services/                # DTOs only
│   ├── subcategories/           # DTOs only
│   ├── uploads/                 # DTOs only
│   └── users/                   # DTOs only
├── src/                         # Application entry point / bootstrap
│   ├── main.ts
│   ├── app.module.ts
│   ├── app.controller.ts
│   ├── app.service.ts
│   └── app.controller.spec.ts
│   # ─── Target directories to be added ───
│   # └── config/                # @nestjs/config schemas (env, clerk, db, brevo, storage)
├── docs/                        # Project documentation (mostly empty skeleton files)
│   ├── architecture/            # 00-overview.md to 17-testing-strategy.md
│   ├── decisions/               # Architecture Decision Records (ADRs)
│   └── runbooks/                # Operational runbooks
├── test/                        # E2E tests
├── .env                         # Local environment variables (.env.example is missing)
├── .gitignore                   # Git ignore file
├── .prettierrc                  # Prettier configuration
├── docker-compose.yml           # Runs PostgreSQL locally (missing Redis/MinIO)
├── eslint.config.mjs            # ESLint configuration
├── nest-cli.json                # Nest CLI configuration
├── package.json                 # Node.js dependencies and scripts
├── pnpm-lock.yaml               # PNPM lockfile
├── pnpm-workspace.yaml          # PNPM workspace configuration
├── prisma.config.ts             # Prisma configuration
├── skills-lock.json             # Skills lockfile
├── tsconfig.build.json          # TypeScript build configuration
└── tsconfig.json                # TypeScript configuration
```

Each feature module is intended to follow the **same internal layout** (currently populated only with DTOs):

```bash
modules/products/
├── products.module.ts           # [Target] Not yet present
├── products.controller.ts       # [Target] Not yet present
├── products.service.ts          # [Target] Not yet present
├── products.repository.ts       # [Target] Not yet present
├── dto/
│   ├── create-product.dto.ts
│   ├── update-product.dto.ts
│   ├── product-query.dto.ts
│   └── product-response.dto.ts
├── entities/                    # [Target] Not yet present
│   └── product.entity.ts
└── mappers/                     # [Target] Not yet present
	└── product.mapper.ts
```

## 6. ✅ Prerequisites <a id="prerequisites"></a>

- Node.js **≥ 24 LTS**
- pnpm **≥ 9** (`corepack enable && corepack prepare pnpm@latest --activate`)
- Docker + Docker Compose (for local Postgres & Redis)
- A [Clerk](https://clerk.com/) application (Publishable + Secret keys, plus a Webhook signing secret)
- A Brevo account with a verified sender
- An AWS account with an S3 bucket
- API keys for each enabled payment provider

## 7. 📦 Installation <a id="installation"></a>

```

# 1. Clone

git clone https://github.com/your-org/payments-api.git

cd payments-api

# 2. Install dependencies

pnpm install

# 3. Bootstrap environment

cp .env.example .env

# 4. Start infra (Postgres + Redis + MinIO)

docker compose up -d

# 5. Run migrations & seed

pnpm prisma migrate dev

pnpm db:seed

```

The API will be available at http://localhost:3000.

## 8. 🔐 Environment variables <a id="environment-variables"></a>

A full reference lives in `.env.example`. Key groups:

```

# ── App ───────────────────────────────────────────────

NODE_ENV=development

PORT=3000

APP_URL=http://localhost:3000

API_PREFIX=api/v1

# ── Database ──────────────────────────────────────────

DATABASE_URL=postgresql://postgres:[db@localhost:5432](mailto:postgres@localhost:5432)/payments

REDIS_URL=redis://[localhost:6379](http://localhost:6379)

# ── Clerk ─────────────────────────────────────────────

CLERK_PUBLISHABLE_KEY=pk_test_xxx

CLERK_SECRET_KEY=sk_test_xxx

CLERK_JWT_KEY=                # PEM (optional, for networkless Clerk token verification)

CLERK_WEBHOOK_SIGNING_SECRET=whsec_xxx

CLERK_AUTHORIZED_PARTIES=http://localhost:3000,https://app.yourdomain.com

# ── Brevo (email) ─────────────────────────────────────

BREVO_API_KEY=

BREVO_SENDER_NAME=Payments

[BREVO_SENDER_EMAIL=no-reply@yourdomain.com](mailto:BREVO_SENDER_EMAIL=no-reply@yourdomain.com)

# ── AWS S3 ────────────────────────────────────────────

AWS_REGION=us-east-1

AWS_ACCESS_KEY_ID=

AWS_SECRET_ACCESS_KEY=

AWS_S3_BUCKET=payments-uploads

AWS_S3_PUBLIC_URL=https://payments-uploads.s3.amazonaws.com

# ── Stripe ────────────────────────────────────────────

STRIPE_SECRET_KEY=

STRIPE_WEBHOOK_SECRET=

# ── PayPal ────────────────────────────────────────────

PAYPAL_CLIENT_ID=

PAYPAL_CLIENT_SECRET=

PAYPAL_ENV=sandbox

PAYPAL_WEBHOOK_ID=

# ── Binance Pay ───────────────────────────────────────

BINANCE_PAY_API_KEY=

BINANCE_PAY_API_SECRET=

# ── Lemon Squeezy ─────────────────────────────────────

LEMONSQUEEZY_API_KEY=

LEMONSQUEEZY_STORE_ID=

LEMONSQUEEZY_WEBHOOK_SECRET=

# ── NOWPayments ───────────────────────────────────────

NOWPAYMENTS_API_KEY=

NOWPAYMENTS_IPN_SECRET=

# ── BitPay ────────────────────────────────────────────

BITPAY_TOKEN=

BITPAY_ENV=test

```

## 9. Running the API <a id="running"></a>

| **Mode**    | **Command**        | **Notes**                    |
| ----------- | ------------------ | ---------------------------- |
| Dev (watch) | `pnpm start:dev`   | Hot reload via `ts-node-dev` |
| Debug       | `pnpm start:debug` | Inspector on `9229`          |
| Build       | `pnpm build`       | Emits `dist/`                |
| Production  | `pnpm start:prod`  | Runs `node dist/main.js`     |

The global API prefix is `/api/v1`. Validation, serialization, exception filtering, response envelope, JWT + Roles guards and Throttler are all wired in `app.module.ts` via global providers.

## 10. 📜 Available scripts <a id="available-scripts"></a>

| Script                 | Description              |
| ---------------------- | ------------------------ |
| `pnpm run start:dev`   | Watch mode               |
| `pnpm run start:prod`  | Production               |
| `pnpm run build`       | Compile TypeScript       |
| `pnpm run lint`        | Lint                     |
| `pnpm run format`      | Format with Prettier     |
| `pnpm run test`        | Unit tests               |
| `pnpm run test:e2e`    | E2E tests                |
| `pnpm run test:cov`    | Coverage                 |

## 11. 📖 API documentation (Swagger) <a id="api-documentation-swagger"></a>

Interactive docs:

- **Swagger UI**: `http://localhost:3000/docs`
- **OpenAPI JSON**: `http://localhost:3000/docs-json`

Bootstrapped in `src/main.ts`:

```

const config = new DocumentBuilder()

.setTitle('Payments API (Clerk + Brevo)')

.setDescription('Unified multi-provider payments service, secured by Clerk')

.setVersion('1.0.0')

.addBearerAuth({

type: 'http',

scheme: 'bearer',

bearerFormat: 'Clerk Token',

description: 'Clerk session token. Obtain via `Clerk.session.getToken()` in your frontend.',

})

.build();

const document = SwaggerModule.createDocument(app, config);

SwaggerModule.setup('docs', app, document, {

swaggerOptions: { persistAuthorization: true },

});

```

## 12. 🪪 Authentication (Clerk) <a id="authentication-clerk"></a>

This API **does not store passwords** and **does not implement OAuth2 itself**. Sign-up, sign-in, social providers, MFA, password resets, and organizations are all delegated to [Clerk](https://clerk.com). The backend simply verifies the Clerk-issued session token on every request.

### Verifying requests

```typescript
// common/guards/clerk-auth.guard.ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { verifyToken } from '@clerk/backend';

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) throw new UnauthorizedException('Missing token');

    try {
      const payload = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY!,
        authorizedParties: process.env.CLERK_AUTHORIZED_PARTIES?.split(','),
      });
      req.auth = { userId: payload.sub, sessionId: payload.sid, orgId: payload.org_id };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid Clerk session');
    }
  }
}
```

Use it globally and opt out with a `@Public()` decorator on truly public routes (e.g. webhooks).

### Local user mirror

A `users.webhook` endpoint listens to Clerk's `user.created`, `user.updated`, `user.deleted`, and `organization.*` events to keep a thin local mirror in Postgres for joins (payments, audit logs).

```http
POST /webhooks/clerk
```

Signatures are verified with `svix` using `CLERK_WEBHOOK_SIGNING_SECRET`.

### Frontend hint

```javascript
// In your Clerk-powered SPA
const token = await window.Clerk.session?.getToken();
fetch('/api/v1/payments/checkout', {
  headers: { Authorization: `Bearer ${token}` },
  // ...
});

```

## 13. 🧪 Validation & serialization <a id="validation-serialization"></a>

Global pipes are enabled in `main.ts`:

```

app.useGlobalPipes(

new ValidationPipe({

whitelist: true,

forbidNonWhitelisted: true,

transform: true,

transformOptions: { enableImplicitConversion: true },

}),

);

app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

```

All DTOs use `class-validator` decorators and `class-transformer` for input/output shaping.

## 14. API surface (module map) <a id="api-surface"></a>

All routes are prefixed with `/api/v1`. **Public** routes are open; **Authenticated (Clerk)** routes require `Authorization: Bearer <clerkToken>` (a Clerk-issued session token); **Admin** routes additionally require role `ADMIN` (some allow `MANAGER`).

| **Module**       | **Base path**                         | **Audience**                      |
| ---------------- | ------------------------------------- | --------------------------------- |
| Auth Webhooks    | `/webhooks/clerk`                     | Public (Svix Signature)           |
| Users (admin)    | `/users/*`                            | Admin                             |
| Account (self)   | `/account/*`                          | Authenticated (Clerk)             |
| Categories       | `/categories/*`                       | Public + Admin                    |
| Subcategories    | `/subcategories/*`                    | Public + Admin                    |
| Products         | `/products/*`                         | Public + Admin                    |
| Services         | `/services/*`                         | Public + Admin                    |
| Cart             | `/cart/*`                             | Authenticated (Clerk)             |
| Favorites        | `/favorites/*`                        | Authenticated (Clerk)             |
| Orders           | `/orders/*`                           | Authenticated (Clerk) + Admin     |
| Payments         | `/payments/*`                         | Authenticated (Clerk) + Webhook   |
| Refunds          | `/refunds/*`                          | Admin                             |
| Reviews          | `/reviews/*`, `/products/:id/reviews` | Public + Authenticated (Clerk)    |
| Conversations    | `/conversations/*`                    | Authenticated (Clerk)             |
| Balance / Ledger | `/account/balance/*`                  | Authenticated (Clerk) + Admin     |
| Notifications    | `/notifications/*`                    | Authenticated (Clerk)             |
| Uploads          | `/uploads/*`                          | Authenticated (Clerk) + Admin     |
| Reports          | `/reports/*`                          | Admin                             |
| Health           | `/health`                             | Public                            |
| OpenAPI          | `/api/docs`                           | Public (dev)                      |

### 14.1 Selected endpoints

- **Auth Webhooks — `/webhooks/clerk`**
  | Method | Path | Auth | Description |
  | ------ | ------------------ | ----------------------- | ------------------------------------------------------------- |
  | POST   | `/webhooks/clerk`  | Public (Svix Signature) | Receives Clerk events to sync users/organizations to Postgres |
- **Users (admin) & Account (self) — `/users/*`, `/account/*`**
  Admin CRUD for users (`/users`), status + role changes, stats, activity log. Self-service profile, password, preferences, addresses under `/account/*`. See the architecture doc for the full list.
- **Catalog — `/categories/*`, `/subcategories/*`, `/products/*`, `/services/*`**
  - Public listing/detail with rich filters (search, status, price range, featured, best-sellers, on-sale, related).
  - Admin/manager mutations (create, update, delete, adjust-stock).
  - Slugs are derived from name via `slugify()`; uniqueness enforced at the DB level.
- **Commerce — `/cart/*`, `/favorites/*`, `/orders/*`, `/payments/*`, `/refunds/*`**
  - `Cart` is lazy-created per user; items are polymorphic (`PRODUCT` or `SERVICE`).
  - `POST /orders/checkout` is wrapped in `prisma.$transaction`:
    1. Validate stock for products.
    2. Snapshot prices into `OrderItem`.
    3. Create `Order` (`PENDING`), `ShippingInfo`, `Payment` (`PENDING`).
    4. Decrement product stock & bump popularity.
    5. If `useBalance=true`, debit the user balance + write a `LedgerEntry`.
    6. Clear the cart.
    7. Emit `order.created` for `NotificationsService`.
  - `PaymentsModule` abstracts a `PaymentGateway` strategy (`StripeGateway`, `PayPalGateway`).
  - `RefundsModule` issues full/partial refunds, supports chargebacks, credits user balance via the ledger.
- **Engagement — `/reviews/*`, `/conversations/*`, `/notifications/*`**
  - Only verified purchasers (resolved via `OrderItem`) can write a review; one review per `(productId, userId)`.
  - Conversations are scoped to an order; participants are the customer and admin/manager.
  - Notifications are persisted in DB and may be fanned out to email; consumed events: `order.created`, `order.statusChanged`, `refund.created`, `chat.message`.
- **Wallet — `/account/balance/*`**
  User balance read, paginated ledger (`LedgerEntry`), top-up (creates a payment), admin manual credit/debit with reason. All credit/debit operations are paired with a `LedgerEntry` (double-entry-lite).
- **Uploads — `/uploads/*`**
  Multipart upload + signed-URL endpoint. Provider strategy selected by `STORAGE_PROVIDER`.
- **Reports — `/reports/*`** (admin)
  Read-only, cacheable aggregates. Common query: `ReportQueryDto { from, to, granularity, kind? }`. Endpoints power every chart in the admin dashboard: KPIs, revenue, sales, category distribution, top products/services, recent orders, user registrations, user activity, alerts, refunds, best-sellers, CLV, balance, catalog/performance, services performance.

## 15. Pagination, filtering & sorting <a id="pagination"></a>

All list endpoints accept the shared `PaginationDto`:

```tsx
class PaginationDto {
  page?: number = 1; // 1-based
  limit?: number = 20; // 1..100
  sortBy?: string;
  sortOrder: 'asc' | 'desc' = 'desc';
  search?: string;
}
```

The `paginate()` helper returns `{ items, total, page, limit, pages, hasNext }`. The `TransformInterceptor` automatically reshapes this into:

```json
{
  "success": true,
  "data": [
    /* items */
  ],
  "meta": { "total": 137, "page": 1, "limit": 20, "pages": 7, "hasNext": true }
}
```

## 16. Events & background work <a id="events"></a>

Domain events flow through `@nestjs/event-emitter`:

| **Event**             | **Producer**               | **Consumers**                        |
| --------------------- | -------------------------- | ------------------------------------ |
| `order.created`       | OrdersService.checkout     | NotificationsService, MailerService  |
| `order.statusChanged` | OrdersService.updateStatus | NotificationsService                 |
| `payment.captured`    | PaymentsService (webhook)  | OrdersService, NotificationsService  |
| `refund.created`      | RefundsService.create      | NotificationsService, BalanceService |
| `chat.message`        | ConversationsService.send  | NotificationsService                 |

Long-running or external tasks (mail delivery, analytics rollups, low-stock alerts) should be moved behind a queue (BullMQ + Redis) when scaling beyond a single instance.

## 17. 💳 Payment integrations <a id="payment-integrations"></a>

All providers implement a common `PaymentProvider` interface:

```

export interface PaymentProvider {

readonly name: PaymentProviderName;

createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;

retrieve(id: string): Promise<Payment>;

refund(input: RefundInput): Promise<Refund>;

verifyWebhook(req: RawRequest): Promise<WebhookEvent>;

}

```

| Provider       | Adapter location                                | Mode          |
| -------------- | ----------------------------------------------- | ------------- |
| Stripe         | `src/modules/payments/providers/stripe`         | Cards, wallets, SEPA, ACH |
| PayPal         | `src/modules/payments/providers/paypal`         | Orders v2     |
| Binance Pay    | `src/modules/payments/providers/binance-pay`    | Crypto        |
| Lemon Squeezy  | `src/modules/payments/providers/lemonsqueezy`   | Subscriptions, MoR |
| NOWPayments    | `src/modules/payments/providers/nowpayments`    | Crypto        |
| BitPay         | `src/modules/payments/providers/bitpay`         | Crypto        |

Select a provider per request:

```

POST /payments/checkout

Content-Type: application/json

Authorization: Bearer <clerk-token>

{

"provider": "lemonsqueezy",

"amount": 2999,

"currency": "USD",

"successUrl": "https://app.example.com/success",

"cancelUrl": "https://app.example.com/cancel"

}

```

## 18. 🪝 Webhooks <a id="webhooks"></a>

Each provider has a dedicated, signature-verified endpoint. Clerk events also flow through `/webhooks/clerk`:

```

POST /webhooks/clerk

POST /webhooks/stripe

POST /webhooks/paypal

POST /webhooks/binance-pay

POST /webhooks/lemonsqueezy

POST /webhooks/nowpayments

POST /webhooks/bitpay

```

Handlers are **idempotent** (deduped by event id) and enqueue async work to BullMQ.

## 19. 👛 Wallet system <a id="wallet-system"></a>

- Ledger-based wallet, one per user.
- Top-ups via any payment gateway; credited on confirmed webhooks.
- Purchases debit atomically inside a DB transaction.
- Movement history exposed at `/wallet/movements`.

## 20. 💬 Real-time chat <a id="real-time-chat"></a>

- Socket.IO gateway at `/ws/chat`.
- Connection handshake authenticated with the Clerk session token.
- Persistent conversations with read receipts and typing indicators.

## 21. 📤 File uploads (AWS S3) <a id="file-uploads-aws-s3"></a>

Two upload modes:

1. **Direct multipart** through `POST /files`.
2. **Presigned PUT** via `POST /files/presign` for large client-side uploads.

```

const url = await s3Presigner.getPresignedUrl({

bucket: [env.AWS](http://env.AWS)_S3_BUCKET,

key: `users/${auth.userId}/${nanoid()}.pdf`,

contentType: 'application/pdf',

expiresIn: 60 * 5,

});

```

Uploaded objects are tagged with the Clerk `userId` for downstream access control.

## 22. ✉️ Email (Brevo) <a id="email-brevo"></a>

The `MailModule` wraps the official `@getbrevo/brevo` SDK. Templates are managed in Brevo's UI and referenced by `templateId`, while ad-hoc transactional sends use inline HTML.

```

import * as Brevo from '@getbrevo/brevo';

const api = new Brevo.TransactionalEmailsApi();

api.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, env.BREVO_API_KEY);

await api.sendTransacEmail({

sender: { name: env.BREVO_SENDER_NAME, email: env.BREVO_SENDER_EMAIL },

to: [{ email: [user.email](http://user.email), name: [user.name](http://user.name) }],

templateId: 7, // "welcome" template

params: { name: [user.name](http://user.name) },

});

```

## 23. 📊 Reports <a id="reports"></a>

On-demand CSV / Excel / PDF exports for sales, wallet movements, payments by
gateway, user activity, and more.

## 24. 🧪 Testing <a id="testing"></a>

```

pnpm test                # unit

pnpm test:watch

pnpm test:cov            # ≥ 85% gate

pnpm test:e2e            # supertest e2e (uses Clerk test tokens)

```

## 25. 🧹 Linting & formatting <a id="linting-formatting"></a>

```

pnpm lint

pnpm format

pnpm typecheck

```

## 26. Observability, security & rate limiting <a id="observability"></a>

- **Logging:** `LoggingInterceptor` records method, path, status, latency. `pino` is the underlying logger (`LOG_LEVEL` controls verbosity).
- **Health:** `GET /health` (powered by `@nestjs/terminus`) checks Postgres and Redis.
- **Security headers:** `helmet()` is enabled globally.
- **CORS:** restricted to `WEB_URL_ORIGIN`; credentials enabled.
- **CSRF:** disabled — the API is stateless and uses bearer tokens.
- **Rate limiting:** `@nestjs/throttler` global guard, `120 req / 60s` per IP by default.
- **Authentication Security:** Authentication is delegated entirely to [Clerk](https://clerk.com). Session tokens are short-lived, and token revocation, MFA, and session verification are handled securely by Clerk's infrastructure.

Husky + lint-staged run on every commit.

## 27. 🗄 Database & migrations <a id="database-migrations"></a>

```

pnpm prisma migrate dev --name <change>

pnpm prisma migrate deploy

pnpm prisma studio

```

Schema diagram: [`docs/architecture/02-data-model.md`](docs/architecture/02-data-model.md).

## 28. 🐳 Docker <a id="docker"></a>

```

docker build -t payments-api .

docker run --env-file .env -p 3000:3000 payments-api

```

## 29. Coding conventions <a id="conventions"></a>

- **File naming:** `kebab-case.ts`; classes `PascalCase`; variables/functions `camelCase`; Prisma enums `SCREAMING_SNAKE_CASE`.
- **Path aliases:** `@common/*` and `@modules/*` configured in `tsconfig.json` and `nest-cli.json`.
- **Imports:** absolute via aliases; sort with `eslint-plugin-import` (groups: node → external → `@common` → `@modules` → relative).
- **Layer rules:**
  - Controllers **never** call Prisma directly; they call services.
  - Services **never** import other modules' repositories; cross-module communication goes through services or events.
  - Repositories return Prisma types; services map them to DTOs/entities.
- **Side effects in transactions:** any multi-write business rule (checkout, refund, password reset, balance adjust) must run inside `PrismaService.runInTransaction()`.
- **Logging:** use `Logger` from `@nestjs/common` with the class name as context.
- **Error throwing:** prefer Nest's built-in HTTP exceptions; let `PrismaExceptionFilter` map Prisma codes.

## 30. 🚀 Deployment <a id="deployment"></a>

Target: AWS ECS Fargate behind an ALB, with RDS Postgres and ElastiCache Redis. CI/CD via GitHub Actions. Infrastructure-as-code documented in [`docs/architecture/06-infrastructure.md`](docs/architecture/06-infrastructure.md).

## 31. 🤖 Agents folder (`.agents/`) <a id="agents-folder-agents"></a>

This repository is **agent-aware**. The `.agents/` directory contains everything an AI coding assistant needs to operate safely and consistently:

| Path                  | Purpose                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| `.agents/skills/`     | Reusable, scoped capabilities (e.g. *add a payment provider*, *sync Clerk roles*). |
| `.agents/hooks/`      | Pre/post-tool hooks (lint, typecheck, test on edit, secret scanning).   |
| `.agents/rules/`      | Repo-wide rules (naming, layering, security, commit style).             |
| `.agents/subagents/`  | Specialized sub-agents (e.g. `migrations-bot`, `webhook-reviewer`).     |

## 32. 📚 Documentation (`docs/`) <a id="documentation-docs"></a>

```

docs/
├── architecture/
│   ├── 00-overview.md                  # System context + C4 L1/L2 diagrams
│   ├── 01-stack.md                     # Tech stack rationale
│   ├── 02-data-model.md                # ERD, entities, invariants
│   ├── 03-directory-structure.md       # Source tree conventions
│   ├── 04-api-rest.md                  # REST conventions, error model, pagination
│   ├── 05-patterns.md                  # DI, hexagonal, CQRS-lite, idempotency
│   ├── 06-infrastructure.md            # AWS topology, CI/CD, secrets
│   ├── 07-data-flows.md                # Sequence diagrams (checkout, webhooks, Clerk events)
│   ├── 08-auth-clerk.md                # Clerk integration, JWT validation, webhooks, user sync
│   ├── 09-payments.md                  # Provider abstraction, idempotency, webhook security
│   ├── 10-wallet.md                    # Ledger, transactions, concurrency, reconciliation
│   ├── 11-realtime-chat.md             # WS gateway, rooms, presence, scaling
│   ├── 12-uploads.md                   # S3 presigned URLs, lifecycle, antivirus
│   ├── 13-emails-brevo.md              # Templates, transactional events, deliverability
│   ├── 14-reports.md                   # Generation pipeline, async jobs, exports
│   ├── 15-security.md                  # Threat model, secrets, PII, rate-limiting
│   ├── 16-observability.md             # Logs, metrics, tracing, alerts, SLOs
│   └── 17-testing-strategy.md          # Unit / e2e / contract / load tests
│
├── decisions/                        # ADRs (one per significant decision)
│   │
│   ├── 0001-record-architecture-decisions.md
│   ├── 0002-choose-pnpm.md
│   ├── 0003-delegate-auth-to-clerk.md
│   ├── 0004-use-brevo-for-email.md
│   ├── 0005-payment-provider-abstraction.md
│   └── 0006-wallet-as-ledger.md
│
└── runbooks/                         # On-call playbooks (outage, rotate keys, replay webhooks)
    ├── deploy.md
    ├── rollback.md
    ├── clerk-webhook-failure.md
    ├── stripe-webhook-failure.md
    ├── wallet-reconciliation.md
    ├── s3-outage.md
    └── incident-template.md

```

## 33. 🤝 Contributing <a id="contributing"></a>

1. Create a branch: `git checkout -b feat/<scope>`
2. Commit using **Conventional Commits**.
3. Run `pnpm verify` (lint + typecheck + test) before pushing.
4. Open a PR and link the relevant ADR or runbook.

## 34. Troubleshooting <a id="troubleshooting"></a>

| **Symptom**                          | **Likely cause**                                                                                       | **Fix**                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `PrismaClientInitializationError`    | Bad `DATABASE_URL` / DB down                                                                           | Check Postgres is reachable; verify credentials and schema.                                            |
| `401 Unauthorized` on every route    | Missing/expired Clerk session token, or invalid `CLERK_SECRET_KEY` / `CLERK_JWT_KEY`                   | Ensure frontend passes a valid Clerk session token in the Authorization header. Verify Clerk variables in `.env`. |
| `403 Requires role: ADMIN`           | Clerk token/user does not have the admin role in the database                                          | Promote the user (`PATCH /users/:id/role`) or sign in as admin.                                        |
| `409 Duplicate value for sku`        | Prisma `P2002`                                                                                         | Pick a unique SKU/slug or update the existing record.                                                  |
| `P2025 Record not found`             | Updating/deleting a missing row                                                                        | Verify the entity ID; check if it was already deleted.                                                 |
| Stock goes negative                  | Concurrent checkout outside a transaction                                                              | Confirm `runInTransaction()` is used; add a `WHERE stock >= quantity` guard if needed.                 |
| Webhook events ignored               | Bad provider signature                                                                                 | Verify `*_WEBHOOK_SECRET` and that the raw body is preserved (no JSON parsing before signature check). |
| Swagger UI empty                     | Running in production with docs disabled                                                               | Re-enable in `main.ts` or expose only behind a VPN.

## 35. 📄 License <a id="license"></a>

[MIT](LICENSE) © TecNet
```