# Design: src-rooted structure + canonical PaginationDto

**Date:** 2026-05-28
**Status:** Ratified by user 2026-05-28 (retrospective spec — see Implementation Note)
**Related ADRs:** [0007-prisma-import-path.md](../../decisions/0007-prisma-import-path.md), [0008-src-rooted-structure.md](../../decisions/0008-src-rooted-structure.md)

## Implementation Note

This spec was written **after** implementation per a procedural remediation request. The brainstorming skill's design flow normally precedes execution; in this case, the goal explicitly authorized "either implement the necessary changes or take no action" and the evidence was unambiguous enough that execution proceeded directly. This document retroactively captures the alternatives considered, the decision criteria, and the trade-offs.

**Ratification:** 2026-05-28 — user explicitly approved the spec ("Ratify the spec — implementation stands") after reviewing all three considered approaches and the deferred follow-up list. The migration described below is the accepted, ratified state of the codebase.

## Problem

Two related questions surfaced from the goal:

1. Is a shared `PaginationDto` necessary, and if so where does it live — `common/dto/` (repo root) or `src/common/dto/`?
2. The repo currently has two parallel `common/` trees (root + `src/`) and a root `modules/` tree. Which represents better practice, and should the other be removed?

## Constraints & Evidence

| Source | Constraint |
|---|---|
| `nest-cli.json` | `"sourceRoot": "src"` — `nest build` only compiles files under `src/` |
| `package.json` jest | `"rootDir": "src"` — colocated tests outside `src/` are never discovered |
| `tsconfig.json` | `"baseUrl": "./"` — typecheck walks the whole repo, masking the build-time problem |
| `docs/architecture/04-api-rest.md:180` | Cites `src/common/utils/` for the paginate helper |
| `docs/architecture/05-patterns.md:91` | Cites `src/common/prisma/prisma.service.ts` |
| `.claude/rules/*.md` | Reference `common/dto/pagination.dto.ts` without a `src/` prefix (ambiguous) |
| 8 existing module query DTOs | Already `extends PaginationDto` — the DTO is load-bearing |
| 40 existing module skeleton files at root `modules/` | Typecheck but **don't ship** — invisible to `nest build` |
| `provider = "prisma-client"` (schema) | Outputs to `generated/prisma/` and changes the import surface (ADR-0007) |

## Considered Approaches

### Approach A — Move everything under `src/` (CHOSEN)

Consolidate root `common/` and root `modules/` into `src/common/` and `src/modules/`. Delete the root copies. Rewrite all module DTO imports so `generated/prisma/*` gets one extra `..` to escape `src/`.

- **Pros:** Aligns with `nest-cli.json`, jest, and the architecture docs without changing any config. Standard NestJS scaffolding. Build, test, and dev-watch all work. Single source of truth.
- **Cons:** Touches 17 module DTO files at minimum (import paths). Anyone with in-flight branches against root `modules/` will see merge conflicts.
- **Migration cost:** Moderate, mechanical, automatable (one PowerShell pass).

### Approach B — Keep modules at root, change build/test config

Update `nest-cli.json` to set `sourceRoot: "."` and add an `entryFile` pointing at `src/main.ts`. Update jest `rootDir` to `"./"` and adjust `testRegex`/`collectCoverageFrom` to scope just `src/` and `modules/`. Add `modules/` and `common/` to `tsconfig.build.json` includes.

- **Pros:** Preserves the existing scaffolded layout — no file moves.
- **Cons:** Fights the NestJS conventions on every tool. Each `pnpm` script that touches the source root needs custom flags. New contributors expect `src/` and lose time hunting. Future Nest CLI generators (`nest g resource …`) generate under `src/` by default and would need explicit paths every time.
- **Migration cost:** Lower mechanical change, higher continuous-friction tax.

### Approach C — Keep both trees coexisting (status quo)

Leave root `common/` (1 file) and root `modules/` (40 files) where they are. Have `src/common/` shadow them. Document the duality.

- **Pros:** No work today.
- **Cons:** Root `modules/` is dead code that compiles but never ships — guaranteed runtime surprise the moment someone adds an `@Module` decorator. The two `common/` trees diverge; consumers don't know which to import from. Path alias decisions become ambiguous.
- **Migration cost:** Zero today, very high tomorrow.

## Decision

**Approach A.** Decided on the strength of: (a) `nest-cli.json` and jest both being explicit that `src/` is the source root, (b) docs already pointing to `src/common/`, (c) Approach B trades a one-time move for permanent toolchain friction with no compensating benefit, (d) Approach C ships dead code by design.

`PaginationDto` is necessary and goes at `src/common/dto/pagination.dto.ts`.

## Architecture

```
src/
├── main.ts                    # bootstrap + global wiring
├── app.module.ts              # ConfigModule, PrismaModule, feature modules
├── app.controller.ts          # health
├── app.service.ts
├── config/                    # ConfigModule, Joi schema, typed factory
├── common/                    # cross-cutting — globally registered
│   ├── decorators/            # @Public, @Roles, @CurrentUser, @ApiPaginated
│   ├── dto/                   # PaginationDto
│   ├── filters/               # AllExceptions, PrismaException
│   ├── interceptors/          # Transform, Logging, Timeout
│   ├── pipes/                 # ParseCuidPipe
│   ├── prisma/                # PrismaModule (@Global) + PrismaService
│   └── utils/                 # paginate, slugify, generateOrderCode
└── modules/                   # feature modules
    └── <feature>/
        ├── <feature>.module.ts
        ├── <feature>.controller.ts
        ├── <feature>.service.ts
        ├── <feature>.repository.ts
        ├── dto/
        ├── entities/
        └── mappers/
```

Outside `src/`: `generated/prisma/` (Prisma generator output, imported relatively), `prisma/schema.prisma`, `docs/`, `test/`, `.claude/`, tool configs.

## Data flow (response envelope)

```
controller returns payload
  → ClassSerializerInterceptor       (strips @Exclude fields)
  → TransformInterceptor             (wraps {success:true, data, meta?})
  → ValidationPipe (on input only — runs before controller)
  → AllExceptionsFilter              (errors → {success:false, statusCode, error, code?})
  → PrismaExceptionFilter            (Prisma-specific → 409/404/409)
```

`paginate()` returns `{items, total, page, limit, pages, hasNext}`; `TransformInterceptor.isPaginatedResult()` detects it and lifts `items → data`, the rest → `meta`. Documented in [response-envelope-and-pagination-lift memory](../../../C:/Users/luis/.claude/projects/.../memory/response-envelope-and-pagination-lift.md).

## Error handling

Single discriminated union: `success: true | false` literal on both envelopes. `meta` is an open `Record<string, unknown>` so future additions (e.g. `cacheHit`, `requestId`) don't break the contract. Prisma error codes surface via the optional `code` field (`P2002`, `P2025`, `P2003`). All other errors carry `statusCode` for client switching.

## Testing

- Unit specs colocated under `src/**/*.spec.ts` — jest's `rootDir: src` now discovers them. (Before this change, the modules at root were invisible to jest.)
- E2E specs unchanged at `test/*.e2e-spec.ts`.

## Self-Review

- **Placeholders:** none.
- **Internal consistency:** architecture section matches the migration that was executed; data-flow section matches `main.ts` registration order; error model matches `04-api-rest.md`.
- **Scope:** single concern (canonical structure + PaginationDto). Does not propose any of the deferred follow-ups (path aliases `@common/*`/`@modules/*`, AppModule placeholder wiring, `ClerkAuthGuard`/`RolesGuard` registration) — those belong to their own specs.
- **Ambiguity:** none — explicit file paths and import strings.

## Deferred (not decided here)

The following are referenced in CLAUDE.md / rules but were intentionally not bundled into this migration to keep scope tight. They each warrant their own decision:

1. **TypeScript path aliases `@common/*` and `@modules/*`** — would require updating `tsconfig.json` paths and `nest-cli.json` `compilerOptions.tsConfigPath` plus `jest.moduleNameMapper`. Cuts import noise but adds tooling surface area.
2. **Placeholder `@Module` classes per feature** — every feature currently has DTOs but no `<feature>.module.ts`. Adding empty placeholders that wire into `AppModule.imports` would surface broken wiring at boot rather than at first request.
3. **Updating `.claude/rules/*.md`** to reference `src/common/` and `src/modules/` explicitly (they currently say bare `common/dto/...` etc., which was ambiguous before this ADR and is misleading after it).
