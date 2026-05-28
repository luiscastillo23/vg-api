# 08 — Authentication with Clerk

The backend **never** handles passwords, OAuth flows, MFA, magic links, or session storage. All of that is delegated to [Clerk](https://clerk.com). Our job is two-fold:

1. **Verify** the Clerk session token on every authenticated request (`ClerkAuthGuard`).
2. **Mirror** the Clerk user into a thin local `User` row via a signed webhook so we can join against orders, reviews, balances, etc.

> Section index: [Why delegate](#why-delegate) · [Components](#components) · [Token verification](#token-verification) · [`ClerkAuthGuard`](#clerkauthguard) · [`@Public` / `@Roles`](#public--roles) · [User mirror](#user-mirror) · [Webhook handler](#webhook-handler) · [Org & multi-tenant](#organizations--multi-tenant) · [Environments & keys](#environments--keys) · [Threat model](#threat-model) · [Local dev](#local-dev)

## Why delegate

| Concern                          | Clerk does it | We'd have to build it          |
| -------------------------------- | ------------- | ------------------------------ |
| Password hashing + rotation      | Yes           | bcrypt/argon2, breach detection |
| Email/phone verification         | Yes           | mailer, OTP storage, expiry     |
| Social providers (Google/GitHub) | Yes           | per-provider OAuth dance        |
| MFA (TOTP, SMS, passkey)         | Yes           | per-factor enrollment + verify  |
| Session revocation / refresh     | Yes           | refresh-token store, blacklist  |
| Hosted sign-in / sign-up UI      | Yes           | full React form set             |
| Account recovery flows           | Yes           | reset email, security questions |

Building any one of those correctly costs more engineering time than this entire commerce backend. ADR [`0003-delegate-auth-to-clerk`](../decisions/0003-delegate-auth-to-clerk.md) captures the rationale and the trade-offs.

## Components

```
modules/auth/
├── auth.module.ts
├── auth.controller.ts        # webhook receiver only — no sign-in/sign-up endpoints
└── dto/
    └── clerk-event.dto.ts

common/
├── guards/
│   ├── clerk-auth.guard.ts   # global; verifies Bearer token
│   └── roles.guard.ts        # reads @Roles() metadata
└── decorators/
    ├── current-user.decorator.ts   # exposes req.user to handlers
    ├── public.decorator.ts         # SetMetadata('isPublic', true)
    └── roles.decorator.ts          # SetMetadata(ROLES_KEY, [...roles])
```

`UsersService.findByClerkId(clerkId)` is the seam between Clerk identity and the local `User` mirror. The guard calls it on every request to populate `req.user`. Cache the lookup in-memory (or Redis) keyed by `clerkId` with a short TTL (≤ 60 s) to absorb hot-loop reads without going to Postgres on every request.

## Token verification

The frontend obtains a session token via Clerk's SDK:

```ts
// Next.js client
const token = await window.Clerk.session?.getToken();
await fetch('/api/v1/account/me', { headers: { Authorization: `Bearer ${token}` }});
```

The backend verifies it with the framework-agnostic `verifyToken()` from `@clerk/backend`. Two verification modes:

| Mode               | When to use                              | Trade-off                                          |
| ------------------ | ---------------------------------------- | -------------------------------------------------- |
| **Networked**      | Default. Uses `CLERK_SECRET_KEY` and Clerk's API to validate. | One outbound call per cold token; cached in Clerk SDK. |
| **Networkless**    | High-throughput paths. Set `CLERK_JWT_KEY` to a PEM exported from the Clerk dashboard. | Validates signature locally; can't detect revocation in real time (token TTL bounds the window). |

Both check the `azp` claim against `CLERK_AUTHORIZED_PARTIES` — a comma-separated list of origins allowed to mint tokens for our API. Misconfigured `azp` is the #1 reason "auth works in dev but fails in prod" — keep this list locked to the production storefront origin(s) only.

## `ClerkAuthGuard`

Registered globally in `AppModule` so every route is authenticated by default:

```ts
// common/guards/clerk-auth.guard.ts
@Injectable()
export class ClerkAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    if (!token) throw new UnauthorizedException('Missing token');

    let payload: JwtPayload;
    try {
      payload = await verifyToken(token, {
        secretKey: this.config.getOrThrow('CLERK_SECRET_KEY'),
        authorizedParties: this.config.getOrThrow('CLERK_AUTHORIZED_PARTIES').split(','),
        jwtKey: this.config.get('CLERK_JWT_KEY'), // optional networkless mode
      });
    } catch {
      throw new UnauthorizedException('Invalid Clerk session');
    }

    const user = await this.users.findByClerkId(payload.sub!);
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User not provisioned or inactive');
    }

    req.auth = { userId: payload.sub, sessionId: payload.sid, orgId: payload.org_id };
    req.user = user; // AuthenticatedUser — read via @CurrentUser()
    return true;
  }
}
```

### What the guard does NOT do

- It does **not** create the local user — that's the webhook's job. If `findByClerkId` misses, the request is rejected. A valid Clerk token whose `user.created` webhook hasn't landed yet is a real edge case — see [Webhook handler](#webhook-handler) for the dedupe/retry strategy.
- It does **not** authorize. Role checks are in `RolesGuard`. The auth guard answers "who"; the roles guard answers "is who allowed."

## `@Public` / `@Roles`

```ts
// common/decorators/public.decorator.ts
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// common/decorators/roles.decorator.ts
export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
```

Usage:

```ts
@Controller('webhooks/clerk')
export class ClerkWebhookController {
  @Public()                                 // opts out of ClerkAuthGuard
  @Post()
  handle(@Headers() h, @RawBody() body) { /* ... */ }
}

@Controller('users')
@Roles(Role.ADMIN)                          // class-level role gate
export class UsersAdminController { /* ... */ }

@Controller('refunds')
export class RefundsController {
  @Roles(Role.ADMIN, Role.MANAGER)          // method-level: either role passes
  @Post()
  create(@Body() dto) { /* ... */ }
}
```

`RolesGuard`:

```ts
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>('roles', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true;
    const user = ctx.switchToHttp().getRequest().user as AuthenticatedUser;
    if (!user) return false; // shouldn't happen — ClerkAuthGuard runs first
    if (!required.includes(user.role)) {
      throw new ForbiddenException(`Requires role: ${required.join(' or ')}`);
    }
    return true;
  }
}
```

**Guard order matters.** In `AppModule`, register `ClerkAuthGuard` before `RolesGuard` — `RolesGuard` reads `req.user` which only exists after `ClerkAuthGuard` populates it.

## User mirror

The local `User` row holds only fields we need for joins:

| Column                            | Source                       | Notes                                    |
| --------------------------------- | ---------------------------- | ---------------------------------------- |
| `id`                              | local CUID                   | Stable; survives Clerk-side rename.       |
| `clerkId`                         | Clerk `user.id`              | `@unique` — drives webhook idempotency.  |
| `email`                           | Clerk primary email          | Synced on `user.updated`.                |
| `firstName` / `lastName` / `avatar` | Clerk profile              | Snapshot for joins; can drift briefly.   |
| `role`                            | local                        | **Never** synced from Clerk. Promotions are admin actions through `PATCH /users/:id/role`. |
| `status`                          | local + webhook              | `PENDING` on create until first verified email; `INACTIVE` on Clerk `user.deleted`. |
| `passwordHash`                    | **legacy** — to be dropped   | Schema artifact; never written. See ADR-0003. |
| `lastLogin`                       | optional, set by Clerk webhook `session.created` | For activity reports. |

The `User.passwordHash` column is non-optional in the current Prisma schema but **must never be populated**. Treat it as a migration to remove once a follow-up ADR lands.

## Webhook handler

`POST /webhooks/clerk` — public, Svix-signed. See [07-data-flows.md#clerk-user-sync](./07-data-flows.md#clerk-user-sync) for the full sequence.

Signature verification uses `svix`:

```ts
const wh = new Webhook(this.config.getOrThrow('CLERK_WEBHOOK_SIGNING_SECRET'));
const event = wh.verify(rawBody, headers) as ClerkEvent; // throws on bad sig
```

The raw body comes from `fastify-raw-body` registered for `/webhooks/*`. Without raw bytes, the signature check fails.

### Idempotency

Two layers of protection:

1. **DB-level unique constraint** on `User.clerkId` — replay of `user.created` raises `P2002` which the handler treats as success.
2. **Event ID dedupe table** (`WebhookEvent { provider, eventId, processedAt }`, unique on `(provider, eventId)`) — prevents re-running side effects (creating `Balance`, `Cart`, sending welcome mail) when Clerk retries on a transient `5xx`.

### Cold-start race

If `ClerkAuthGuard` runs for a brand-new user before the `user.created` webhook lands, the guard rejects with `401 User not provisioned or inactive`. The Clerk SDK on the frontend already waits for webhook ack before unlocking the dashboard; if you see this in the wild, check the dedupe table and Clerk's webhook delivery dashboard.

## Organizations & multi-tenant

We persist `Clerk.organization.id` on the request (`req.auth.orgId`) but don't currently scope data by org — the platform is single-tenant. The Clerk org webhooks (`organization.created`, `organization.membership.created`, …) are stubs that just log; flesh them out when multi-tenant ships.

If/when multi-tenant lands:

- Every aggregate root (`Order`, `Product`, `Conversation`, …) grows an `orgId` FK.
- `ClerkAuthGuard` sets `req.auth.orgId` from the token; a new `OrgScopeInterceptor` injects it into every Prisma query via `prisma.$extends`.
- ADR required — record it as `0007-multi-tenant.md`.

## Environments & keys

| Variable                       | Dev               | Staging          | Prod          |
| ------------------------------ | ----------------- | ---------------- | ------------- |
| `CLERK_PUBLISHABLE_KEY`        | `pk_test_…`       | `pk_test_…`      | `pk_live_…`   |
| `CLERK_SECRET_KEY`             | `sk_test_…`       | `sk_test_…`      | `sk_live_…`   |
| `CLERK_JWT_KEY`                | optional          | recommended      | recommended   |
| `CLERK_WEBHOOK_SIGNING_SECRET` | `whsec_…` (dev)   | `whsec_…` (stg)  | `whsec_…`     |
| `CLERK_AUTHORIZED_PARTIES`     | `http://localhost:3001` | staging URL | prod URL(s) only |

Production keys live in the secret manager, never in `.env` files on running containers.

## Threat model

| Threat                                          | Mitigation                                              |
| ----------------------------------------------- | ------------------------------------------------------- |
| Stolen session token replayed from another origin | `authorizedParties` (`azp` claim) check                |
| Forged token signed with attacker key            | Signature verified against Clerk's JWKS / PEM           |
| Webhook spoofing                                  | Svix HMAC verification + `WebhookEvent` event-id dedupe |
| Role escalation through Clerk metadata           | `Role` is **local-only**; we never trust Clerk for roles |
| Replay of `user.deleted` re-deactivating a re-created account | `WebhookEvent` dedupe + check current `User.status` before transitioning |
| Stuck-cache after `user.deleted`                  | Cache TTL ≤ 60 s; explicit invalidate on the relevant webhook |

## Local dev

1. Create a Clerk **development** application (free tier).
2. Copy publishable + secret keys into `.env`.
3. For webhooks, run `ngrok http 3000` and set the Clerk dashboard webhook endpoint to `https://<ngrok>.io/api/v1/webhooks/clerk`. Copy the signing secret to `CLERK_WEBHOOK_SIGNING_SECRET`.
4. In the dev app, **disable** features you don't need (organizations, MFA enforcement) to keep the surface small while building.
5. Use Clerk's "Impersonate user" feature in the dashboard to test role-gated routes without juggling multiple accounts.

For e2e tests, mint short-lived test tokens via `@clerk/testing`'s `setupClerkTestingToken` — these tokens bypass the dashboard and live inside the test process.

## Cross-references

- [05-patterns.md#auth--rbac](./05-patterns.md#auth--rbac) — patterns / hard rules
- [07-data-flows.md#clerk-user-sync](./07-data-flows.md#clerk-user-sync) — webhook sequence diagram
- [15-security.md](./15-security.md) — threat model in full
- [`0003-delegate-auth-to-clerk.md`](../decisions/0003-delegate-auth-to-clerk.md) — the decision record
- [`clerk-webhook-failure.md`](../runbooks/clerk-webhook-failure.md) — incident runbook
