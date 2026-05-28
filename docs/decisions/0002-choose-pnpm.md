# 0002 — Choose pnpm as the package manager

- **Status**: Accepted
- **Date**: 2026-05-25
- **Decision-makers**: VirtualGifts engineering team
- **Tags**: tooling, build

## Context

Three viable package managers exist for Node.js projects today:

- **npm** — bundled with Node, ubiquitous, but slow on cold installs and historically loose with peer-dependency resolution.
- **yarn** — two incompatible flavors (Classic v1, Berry v2+). Berry's PnP is fast but its zero-install model conflicts with Prisma's runtime client generation and creates IDE friction. Classic is unmaintained.
- **pnpm** — content-addressable store + symlinked `node_modules`. Fast, disk-efficient, strict.

The project's specific requirements:

- Reproducible installs across developers and CI (committed lockfile, deterministic resolution).
- Fast CI installs (we run install on every PR).
- Strict peer-dependency behavior so we catch missing peers before runtime instead of after.
- A `nodelinker` mode that works with Prisma's generated client at `generated/prisma/`.
- Workspaces support, anticipating future split into multiple packages (workers, shared types).

## Decision

Use **pnpm** as the sole package manager. The repo commits:

- `package.json` — dependencies + scripts.
- `pnpm-lock.yaml` — lockfile.
- `pnpm-workspace.yaml` — workspace declaration (even though there's one package today, this leaves the door open).

`npm` and `yarn` are not supported. `CI` enforces this via:

- `packageManager` field in `package.json` (`pnpm@11.x`).
- `corepack enable` in CI so the right pnpm binary is used.
- A pre-install hook (`only-allow pnpm`) that fails any `npm install` / `yarn install` invocation.

## Consequences

**Good**

- Faster CI (~3× over npm on a cold install for our dep set).
- Disk-efficient: one global store shared across all repos on a developer's machine.
- Strict peer-deps catch missing peers at install time — bugs we'd otherwise see at runtime.
- Symlinked `node_modules` is the right default for our setup (Prisma client generation works, IDEs index correctly).

**Bad / cost**

- pnpm-specific quirks occasionally bite: some packages (rare) assume hoisted layouts. Workarounds are documented in pnpm's FAQ.
- Onboarding requires `corepack enable && corepack prepare pnpm@latest --activate` — one extra step over npm.
- Tooling outside the JS ecosystem (some Docker base images, some CI templates) defaults to npm. We override in Dockerfiles and CI configs.

**Follow-ups**

- The Dockerfile uses `pnpm install --frozen-lockfile` for reproducible builds.
- CI step `pnpm install --frozen-lockfile` ensures the lockfile is the source of truth — any drift fails the build.

## Alternatives considered

- **npm**: simplest, but slower and historically permissive on peer-deps. Lockfile drift between machines is a real pain we've felt in past projects.
- **yarn classic (v1)**: unmaintained.
- **yarn berry (v3+)**: PnP mode breaks Prisma's client generation flow without manual workarounds. `nodeLinker: node-modules` mode is essentially "npm but slower". Net: not worth the migration cost.
- **bun**: too new for a multi-year commerce backend. Revisit once Bun is GA and has a stable, widely-tested package-management story.
