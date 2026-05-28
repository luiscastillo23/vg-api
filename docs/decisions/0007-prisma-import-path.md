# ADR 0007: Prisma import path — `generated/prisma` subpaths

**Status:** Accepted  
**Date:** 2026-05-28

## Context

The Prisma schema uses `provider = "prisma-client"` (the new Prisma 6 generator), which outputs the generated client to `generated/prisma/` instead of the legacy `node_modules/.prisma/client/` location.

The legacy `@prisma/client` package (installed via `npm install @prisma/client`) only exports three symbols with this new generator:
- `PrismaClient` — the client class
- `Prisma` — a partial namespace (input/output types only, no enums or model types)
- `default` — same as `PrismaClient`

Enums (`Role`, `UserStatus`, `EntityStatus`, `OrderStatus`, `PaymentMethod`, `LedgerType`, `NotificationType`, `ItemKind`, `PaymentStatus`), model types (`User`, `Product`, …), and `PrismaClientKnownRequestError` are **not** available from `@prisma/client` with this generator.

## Decision

All source files must import from the following canonical locations:

| What | Import from |
|---|---|
| Enum values and types | `generated/prisma/enums` (relative path) |
| Model types (`User`, `Order`, …) | `generated/prisma/models` (barrel re-export) |
| `PrismaClient` class | `generated/prisma/client` (relative path) |
| `PrismaClientKnownRequestError` | `@prisma/client/runtime/library` (stable runtime package) |

Relative path from any file in `modules/<module>/dto/` or `src/common/<layer>/` to the generated output:
```
../../../generated/prisma/enums
../../../generated/prisma/models
../../../generated/prisma/client
```

From `src/common/prisma/` (for `PrismaService` itself):
```
../../../generated/prisma/client
```

## Rationale

- **Correctness**: `@prisma/client` does not export enums or model types with `provider = "prisma-client"`. Importing from it causes `error TS2305` at compile time.
- **Single source of truth**: The generated output is the authoritative source. Splitting between `@prisma/client` and `generated/prisma` would create confusion.
- **Stable runtime class**: `PrismaClientKnownRequestError` is imported from `@prisma/client/runtime/library` because: (a) it is a stable, versioned package path; (b) the generated `internal/prismaNamespace.ts` explicitly states it is an internal file not for direct import; (c) runtime verification confirms it is exported there.
- **Not `@prisma/client` for anything model-related**: While `@prisma/client` is still in `dependencies` for the runtime library and engine, it is not used for type or enum imports.

## Consequences

- Every DTO, service, repository, or decorator that needs a Prisma enum or model type imports from `generated/prisma/enums` or `generated/prisma/models`.
- `PrismaService` (`src/common/prisma/prisma.service.ts`) imports `PrismaClient` from `generated/prisma/client`.
- The `generated/` directory must be committed to the repository (or regenerated in CI before the build step) since source files now depend on it.
- If the Prisma schema changes, run `pnpm prisma generate` to regenerate `generated/prisma/` before building.
- Do not add a path alias for `generated/prisma` until `tsconfig.json` and `nest-cli.json` both support it (see CLAUDE.md path alias note).
