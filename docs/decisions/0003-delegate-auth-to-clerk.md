# 0003 — Delegate authentication to Clerk

- **Status**: Accepted
- **Date**: 2026-05-25
- **Decision-makers**: VirtualGifts engineering team
- **Tags**: security, auth, identity, vendor

## Context

VirtualGifts is a commerce backend with the usual identity needs: sign-up, sign-in, email verification, password reset, MFA, social providers, session management, and account recovery. Each of these is a small project on its own; together, they're a multi-month effort to get right — and one breach is enough to lose customer trust permanently.

We have three realistic options:

1. **Build it ourselves**: bcrypt/argon2, refresh-token rotation, OTP storage, social OAuth handshakes, MFA enrollment, lockout policies, account-recovery email flows. Estimated 2–3 engineer-months for a first version that won't embarrass us in a SOC 2 audit, plus ongoing maintenance.
2. **Use Auth0/Okta**: mature, enterprise-grade. Pricing scales aggressively past the free tier (priced per MAU and per feature).
3. **Use Clerk**: newer, modern DX (drop-in React components, Next.js-friendly), competitive free tier, framework-agnostic backend SDK (`@clerk/backend`) with token verification.

This is a commerce app where the differentiator is the catalog/checkout/wallet, **not** the auth flow. Spending months reinventing auth is the wrong fight.

## Decision

**Authentication is delegated entirely to Clerk.** The backend:

- Verifies the Clerk session token on every request via `verifyToken()` from `@clerk/backend`, inside a global `ClerkAuthGuard`.
- Mirrors the Clerk user into a thin local `User` row via a Svix-signed webhook (`POST /webhooks/clerk`) on `user.created` / `user.updated` / `user.deleted`.
- **Never** stores passwords, MFA secrets, refresh tokens, or OAuth credentials.
- **Never** mints its own tokens.
- **Never** sends auth-related email (verification, password reset, MFA challenges — Clerk does).

Authorization is local: `User.role` is the source of truth, never the token. Roles can be set/changed only through `PATCH /users/:id/role` (admin-only).

See [`08-auth-clerk.md`](../architecture/08-auth-clerk.md) for the full integration design.

## Consequences

**Good**

- Months of work avoided. We ship the commerce features customers care about.
- SOC 2 / GDPR posture inherits Clerk's audited infrastructure.
- Password leaks become Clerk's problem; rotation is centralized.
- Drop-in UI components on the frontend cut sign-in / sign-up build time to hours.
- MFA, social providers, magic links, passkeys — all available without backend code changes.

**Bad / cost**

- **Vendor lock-in**: a future migration to another provider (or in-house) requires backfilling local password hashes (impossible if we never had them) or forcing every user to reset. Mitigation: keep the User model minimal and well-decoupled so the migration surface is small.
- **Per-MAU pricing**: at scale, Clerk's pricing grows. We accept this as a managed-service tax; the alternative is staffing and maintaining the equivalent in-house, which is more expensive.
- **External dependency in the auth path**: Clerk downtime ⇒ our API is unauthenticated-only. Mitigation: enable networkless verification via `CLERK_JWT_KEY`, which lets us validate signatures without a Clerk API round-trip. Tokens live ~5 min so a short Clerk outage is survivable.
- **Webhook propagation delay**: a new user's first request can land before `user.created` reaches us. Mitigation: short cache TTL + clear `401 User not provisioned` error message; frontend Clerk SDK already waits for `userId` to be present before unlocking authenticated UI.

**Follow-ups**

- The `User.passwordHash` column is a legacy artifact (non-optional in the current Prisma schema). It must never be populated; a follow-up migration drops it. Tracked separately.
- Multi-tenant: when/if we adopt Clerk organizations, write `0007-multi-tenant.md` capturing the data-scoping decisions.

## Alternatives considered

- **Roll our own**: rejected. 2–3 months of work that doesn't differentiate the product, plus a permanent maintenance + security burden. Every founder who's done it once advises against doing it twice.
- **Auth0**: comparable feature set, more enterprise-mature, but pricier and less DX-friendly for our Next.js stack.
- **Supabase Auth**: viable, especially if we used Supabase for the DB. We don't (we use plain Postgres + Prisma), so the bundling argument doesn't apply.
- **Keycloak (self-hosted)**: open source, but self-hosting an identity provider for a startup is exactly the operational burden we're trying to avoid.
- **Hybrid (Clerk for sign-up + our own JWT for sessions)**: superficially attractive (less lock-in), but creates a token-issuance surface we'd have to audit, and Clerk's webhooks + token verification cover the same ground. Net: more code, more risk, no real win.
