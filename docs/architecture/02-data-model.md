# 02 — Data model

The single source of truth is `prisma/schema.prisma`. This document explains the **intent** behind the schema, the relationships, and the conventions you must follow when extending it.

## Conventions

- **IDs**: `String @id @default(cuid())` everywhere. No integer surrogates, no UUIDv4. CUIDs are URL-safe, monotonic-ish, and collision-resistant.
- **Money**: `Decimal @db.Decimal(12, 2)` always. **Never** `Float`. Allows up to ~9.99 billion in any currency at 2-decimal precision.
- **Timestamps**: `createdAt DateTime @default(now())` and `updatedAt DateTime @updatedAt`. Use these names verbatim.
- **Enums**: first-class Prisma enums in `SCREAMING_SNAKE_CASE`. Avoid string columns for finite domains.
- **Cascades**: dependent rows that have no meaning without their parent (`UserPreferences`, `Address`, `Cart`, `CartItem`, `Favorite`, `Notification`, `Balance`, `LedgerEntry`, `OrderItem`, `Payment`, `Message`) use `onDelete: Cascade`. Order/Refund/Review keep the user reference even if other dependents cascade — financial history must survive user deletion.
- **Polymorphism**: `OrderItem`, `CartItem`, and `Favorite` carry `kind: ItemKind` plus nullable `productId` / `serviceId`. Exactly one must be non-null at the application level (the schema can't express that constraint — enforce it in the service).
- **Soft delete**: there is a placeholder middleware in `PrismaService` (`softDeleteModels` set, currently empty). Add a model to that set instead of inventing per-model soft-delete columns.

## Enums

| Enum               | Values                                                              | Notes                                          |
| ------------------ | ------------------------------------------------------------------- | ---------------------------------------------- |
| `Role`             | `ADMIN`, `MANAGER`, `CUSTOMER`                                       | Drives `RolesGuard`. Default: `CUSTOMER`.       |
| `UserStatus`       | `ACTIVE`, `INACTIVE`, `PENDING`, `SUSPENDED`                         | Managed by Clerk webhook sync (e.g. `user.created`). |
| `EntityStatus`     | `ACTIVE`, `INACTIVE`                                                 | Used by Category, Subcategory, Product, Service. |
| `OrderStatus`      | `PENDING`, `PAID`, `PROCESSING`, `COMPLETED`, `CANCELLED`, `REFUNDED`, `CHARGEBACK` | Lifecycle below.                              |
| `PaymentStatus`    | `PENDING`, `AUTHORIZED`, `CAPTURED`, `FAILED`, `REFUNDED`            | Mirrors gateway state.                         |
| `PaymentMethod`    | `CARD`, `PAYPAL`, `CRYPTO`, `BALANCE`                                | `BALANCE` debits internal wallet.              |
| `LedgerType`       | `CREDIT`, `DEBIT`                                                    | Double-entry-lite for `Balance`.               |
| `NotificationType` | `ORDER`, `REFUND`, `SYSTEM`, `CHAT`, `PROMO`                         | Used for filtering/display.                     |
| `ItemKind`         | `PRODUCT`, `SERVICE`                                                 | Polymorphic discriminator.                      |

## Aggregates and module ownership

A Prisma model belongs to exactly one module. Other modules read it only through that module's service.

| Module          | Owns models                                                                  |
| --------------- | ---------------------------------------------------------------------------- |
| `auth`          | *(Delegated to Clerk; no local models)*                                      |
| `users`         | `User`, `UserPreferences`, `Address`, `ActivityLog`                          |
| `categories`    | `Category`                                                                   |
| `subcategories` | `Subcategory`                                                                |
| `products`      | `Product`, `Review`                                                          |
| `services`      | `Service`                                                                    |
| `cart`          | `Cart`, `CartItem`                                                           |
| `favorites`     | `Favorite`                                                                   |
| `orders`        | `Order`, `OrderItem`, `ShippingInfo`                                         |
| `payments`      | `Payment`                                                                    |
| `refunds`       | `Refund`                                                                     |
| `conversations` | `Conversation`, `Message`                                                    |
| `balance`       | `Balance`, `LedgerEntry`                                                     |
| `notifications` | `Notification`                                                               |

`Review` lives with `products` because the domain rule ("only verified purchasers can review a product") requires reading `OrderItem` — but the *write* side belongs to the products domain. Cross-module reads happen via `OrdersService.findItemForUser(...)`, not by importing `OrdersRepository`.

## Relationships at a glance

```
User ──┬── UserPreferences (1:1)
       ├── Address (1:N)
       ├── Cart (1:1) ── CartItem (1:N) ── Product? / Service?
       ├── Favorite (1:N) ── Product? / Service?
       ├── Order (1:N) ── OrderItem (1:N) ── Product? / Service?
       │              ├── ShippingInfo (1:1)
       │              ├── Payment (1:1)
       │              ├── Refund (1:N)
       │              └── Conversation (1:1) ── Message (1:N)
       ├── Review (1:N) ── Product
       ├── Balance (1:1)
       ├── LedgerEntry (1:N)
       ├── Notification (1:N)
       └── ActivityLog (1:N)

Category ── Subcategory (1:N) ── Product / Service (1:N)
Category ── Product / Service (1:N, direct)
```

## Order lifecycle

```
PENDING ──pay──▶ PAID ──process──▶ PROCESSING ──fulfil──▶ COMPLETED
   │                │                                          │
   │                └──refund──▶ REFUNDED                      │
   │                                                            └──refund──▶ REFUNDED
   ├──cancel──▶ CANCELLED
   └──dispute──▶ CHARGEBACK
```

State transitions live in `OrdersService`. **No other module mutates `Order.status`.** Webhooks call `OrdersService` (not the repository directly) so the service can validate the transition and emit `order.statusChanged`.

## Money & ledger

- Every order has `subtotal`, `discount`, `tax`, `total` — all `Decimal(12,2)`. The service must compute and persist all four; never derive at read time.
- `OrderItem.unitPrice` and `OrderItem.lineTotal` are **price snapshots**. Editing a `Product.price` later must not change historical orders.
- `Balance` is always paired with `LedgerEntry`: every credit/debit to `Balance.amount` writes a matching `LedgerEntry` row with the source `reference` (e.g. `orderId`, `refundId`). This is "double-entry-lite" — we don't track contra accounts, but every motion is auditable.

## Polymorphic items — application-level invariants

Schema can't enforce these, but services must:

- `CartItem`, `OrderItem`, `Favorite`: `kind == PRODUCT` ⇒ `productId IS NOT NULL` and `serviceId IS NULL`; vice versa for `SERVICE`.
- `OrderItem.name` is a snapshot of the product/service name at order creation. Don't read the live product name when rendering an order — use the snapshot.
- `CartItem` has a unique `(cartId, productId, serviceId)` so adding the same item twice updates quantity instead of inserting.

## Indexes already declared

| Model     | Index                              | Reason                                      |
| --------- | ---------------------------------- | ------------------------------------------- |
| `Product` | `@@index([categoryId, status])`    | Catalog filtering by category + status.     |
| `Product` | `@@index([slug])`                  | Public detail lookup by slug.               |
| `Order`   | `@@index([userId, status])`        | "My orders" filter by status.               |
| `Order`   | `@@index([createdAt])`             | Reports + recent-orders dashboards.         |

When adding new query patterns, **add the index in the same migration** — don't ship a hot path that triggers seq scans.

## Extending the schema — checklist

1. Edit `prisma/schema.prisma`.
2. Add `@@index` for any new query path the service will use.
3. Decide cascade semantics on FKs (does the dependent row mean anything alone?).
4. `npx prisma migrate dev --name <descriptive_name>` (note: there are no `prisma:*` npm wrappers — use `npx`).
5. Update the owning module's repository + service. Do **not** import the new model from outside its owning module.
6. If the model represents money, write the `Decimal(12, 2)` migration test and confirm rounding behavior.
