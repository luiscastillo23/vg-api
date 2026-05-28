# 03 — Directory structure

## Repository layout

```
backend/
├── .agents/                     # Agents skills and configs
├── prisma/
│   ├── schema.prisma            # source of truth for the DB
│   ├── migrations/              # one folder per migration; never edited by hand
│   └── seed.ts                  # NOT YET PRESENT — to be added
├── generated/
│   └── prisma/                  # output of the prisma-client generator
├── common/
│   ├── decorators/              # @CurrentUser, @Public, @Roles (existing); add @ApiPaginated, etc.
│   ├── filters/                 # all-exceptions, prisma-exception — TO BE ADDED
│   ├── guards/                  # clerk-auth, roles, optional-auth — TO BE ADDED
│   ├── interceptors/            # transform, logging, timeout — TO BE ADDED
│   ├── pipes/                   # parse-object-id, trim — TO BE ADDED
│   ├── dto/                     # PaginationDto (existing); add SortDto, BaseResponseDto
│   ├── enums/                   # mirrors of Prisma enums for non-Prisma layers
│   ├── utils/                   # slugify, paginate, order-code (existing); add hashing, mappers
│   └── prisma/
│       ├── prisma.module.ts
│       └── prisma.service.ts    # extends PrismaClient, exposes runInTransaction()
├── modules/
│   ├── auth/
│   ├── users/
│   ├── categories/
│   ├── subcategories/
│   ├── products/
│   ├── services/
│   ├── cart/
│   ├── favorites/
│   ├── orders/
│   ├── payments/
│   ├── refunds/
│   ├── reviews/
│   ├── conversations/
│   ├── balance/
│   ├── notifications/
│   ├── uploads/
│   └── reports/
├── src/
│   ├── main.ts                  # bootstrap, global pipes/filters/interceptors, Swagger
│   ├── app.module.ts            # wires ConfigModule + PrismaModule (today); add globals here
│   ├── config/                  # @nestjs/config schemas (env, clerk, db, brevo, storage) — TO BE ADDED
├── test/                        # e2e tests (Supertest); jest-e2e.json sets rootDir
├── docs/
│   ├── architecture/            # ← you are here
│   ├── decisions/               # ADRs (architectural decision records)
│   └── runbooks/                # incident response, recovery procedures
├── .env.example                 # TO BE ADDED
├── .gitignore
├── .prettierrc
├── docker-compose.yml           # Runs PostgreSQL locally
├── eslint.config.mjs
├── nest-cli.json
├── package.json
├── pnpm-lock.yaml               # PNPM lockfile
├── pnpm-workspace.yaml          # PNPM workspace configuration
├── prisma.config.ts
├── skills-lock.json             # Skills lockfile
├── tsconfig.build.json
└── tsconfig.json
```

> **What exists today**: `app.module.ts` wires only `ConfigModule` + `PrismaModule`; `common/` has `prisma/`, three decorators, one DTO, three utils. Most of `modules/*` only contains `dto/` files. The rest of the structure above is the *target*.

## Per-module layout

Every feature module follows the same shape. Example for `products`:

```
modules/products/
├── products.module.ts
├── products.controller.ts        # presentation: HTTP endpoints, OpenAPI decorators
├── products.service.ts           # application: use cases, orchestration, transactions
├── products.repository.ts        # infrastructure: Prisma queries, returns Prisma types
├── dto/
│   ├── create-product.dto.ts
│   ├── update-product.dto.ts
│   ├── product-query.dto.ts      # extends PaginationDto with module-specific filters
│   └── product-response.dto.ts   # public contract; @Exclude() sensitive fields
├── entities/
│   └── product.entity.ts         # optional: domain object when business rules justify it
└── mappers/
    └── product.mapper.ts         # Prisma row → DTO/entity
```

### What goes where

| File                          | Allowed imports                                         | Forbidden                                        |
| ----------------------------- | ------------------------------------------------------- | ------------------------------------------------ |
| `*.controller.ts`             | own service, own DTOs, common decorators/guards/pipes   | Prisma directly, other modules' repositories     |
| `*.service.ts`                | own repository, other modules' **services**, event bus  | other modules' repositories or Prisma models they don't own |
| `*.repository.ts`             | `PrismaService`, own Prisma types                        | HTTP types (`Request`, `Response`, etc.)         |
| `dto/*.dto.ts`                | class-validator/class-transformer, swagger              | services, repositories, Prisma                   |
| `entities/*.entity.ts`        | value objects, domain primitives                         | Prisma client, HTTP, framework decorators        |
| `mappers/*.mapper.ts`         | own DTOs/entities, Prisma types                          | services, repositories                            |

These rules are enforced **by code review and ESLint**, not by package boundaries (we're a monolith). When in doubt, see [05-patterns.md](./05-patterns.md) for the layer rules.

## Why this shape

- **Co-location over global folders**: a feature's controller, DTO, mapper, and entity all live next to each other so a developer can read or move the entire feature in one breath. There is no global `controllers/` or `services/` directory.
- **Predictable filenames**: `<module>.<role>.ts`. Anyone who has seen one module can navigate every other module immediately.
- **Mappers are explicit**: Prisma rows leak `Decimal`, `Date`, lazy relations, and internal nulls. Mappers turn them into stable, public DTO shapes. Never serialize a Prisma row directly to the wire.

## Path aliases

The README mentions `@common/*` and `@modules/*` aliases, but **`tsconfig.json` does not currently define them** and `nest-cli.json` has no path-mapping config. Imports today are relative.

If you add aliases, update **both**:

- `tsconfig.json` `compilerOptions.paths`
- `nest-cli.json` (`compilerOptions` for the Nest builder)

Otherwise the runtime build will resolve them differently from the editor.

## Critical gotcha — Prisma client import path

`prisma/schema.prisma` declares:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"
}
```

This generates the client to `generated/prisma/`, **not** `node_modules/@prisma/client`. However, every existing file (including `src/common/prisma/prisma.service.ts` and the DTOs) currently imports from `@prisma/client`, which still works because that package is installed. The two paths will drift over time.

**When touching Prisma imports**: check what the surrounding code uses and stay consistent. Don't silently mix the two — flag the inconsistency and pick one path for the whole codebase.

## Documentation directories

- `docs/architecture/` — this set: target architecture (what the codebase should look like).
- `docs/decisions/` — ADRs: numbered, dated, immutable records of *why* we chose X over Y.
- `docs/runbooks/` — operational playbooks: "what to do when X is on fire".

ADRs and runbooks are currently empty directories — populate them as decisions and incidents accrue.
