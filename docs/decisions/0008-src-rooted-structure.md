# ADR 0008: All source under `src/` (consolidate `common/` and `modules/`)

**Status:** Accepted
**Date:** 2026-05-28
**Supersedes scaffolding choice:** root-level `common/` + `modules/`

## Context

Initial scaffolding placed `common/` and `modules/` at the repository root, mirroring some Java/Spring-style layouts where the source root is the project root. This left `src/` containing only `main.ts`, `app.module.ts`, `app.controller.ts`, `app.service.ts`, and `config/`.

Three facts make that layout unworkable:

1. **`nest-cli.json` sets `sourceRoot: "src"`.** `nest build` only compiles files under `src/`. Anything in root-level `modules/` or `common/` is silently excluded from `dist/`.
2. **`package.json` jest config sets `rootDir: "src"`.** Tests under root-level `modules/` or `common/` are never discovered, so colocated `*.spec.ts` files there would never run.
3. **The architecture docs already specify `src/common/`.** `docs/architecture/04-api-rest.md` (line 180) and `docs/architecture/05-patterns.md` (line 91) reference `src/common/utils/` and `src/common/prisma/prisma.service.ts` as canonical paths.

The root-level placement only worked at typecheck-time (where `tsc` walks `include` patterns) but would have produced a broken build the moment any module wired itself into `AppModule.imports`.

## Decision

All TypeScript source lives under `src/`. The canonical layout is:

```
src/
├── main.ts
├── app.module.ts
├── app.controller.ts
├── app.service.ts
├── config/                          # ConfigModule, Joi schema, typed factory
├── common/                          # cross-cutting — globally registered
│   ├── decorators/                  # @Public, @Roles, @CurrentUser, @ApiPaginated
│   ├── dto/                         # PaginationDto (shared by every list endpoint)
│   ├── filters/                     # AllExceptionsFilter, PrismaExceptionFilter
│   ├── interceptors/                # Transform, Logging, Timeout
│   ├── pipes/                       # ParseCuidPipe
│   ├── prisma/                      # PrismaModule (@Global) + PrismaService
│   └── utils/                       # paginate, slugify, generateOrderCode, etc.
└── modules/                         # feature modules — each wires itself into AppModule
    ├── <feature>/
    │   ├── <feature>.module.ts
    │   ├── <feature>.controller.ts
    │   ├── <feature>.service.ts
    │   ├── <feature>.repository.ts
    │   ├── dto/
    │   ├── entities/
    │   └── mappers/
    └── …
```

Files outside `src/` that the build needs (generator output, prisma schema, runbooks):

- `generated/prisma/` — Prisma client output (imported from source via relative paths; not part of compilation input).
- `prisma/schema.prisma` and `prisma/migrations/` — schema and migrations.
- `docs/`, `test/`, `.claude/`, config files — tooling.

## Consequences

- Root-level `common/` and `modules/` directories have been deleted. They MUST NOT be recreated.
- Module DTO imports use `'../../../common/dto/pagination.dto'` (from `src/modules/<feature>/dto/*.ts`) and `'../../../../generated/prisma/enums'` (one extra `..` to escape `src/`).
- `src/common/*` files import the Prisma generator output as `'../../../generated/prisma/...'`.
- `nest build` and `jest` work out-of-the-box without any `nest-cli.json` or `package.json` change.
- New feature modules go under `src/modules/<feature>/` per the template above and must be added to `AppModule.imports`.
