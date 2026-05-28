# 17 — Testing strategy

The test pyramid here has four levels: unit, integration, end-to-end, and contract. Each level answers a different question and pays a different latency cost. This file says **what to test at which level**, **what to mock**, and **what NOT to test** — because every redundant test is technical debt.

> Section index: [Pyramid](#pyramid) · [Test runner](#test-runner) · [Unit](#unit) · [Integration](#integration) · [E2E](#e2e) · [Contract](#contract) · [Test data](#test-data) · [What not to test](#what-not-to-test) · [Coverage](#coverage) · [CI](#ci) · [Load tests](#load-tests) · [Cross-references](#cross-references)

## Pyramid

```
        ╱  e2e   ╲          slow, real Postgres, full Nest app             few
       ╱─────────╲
      ╱ contract  ╲         provider fixtures, gateway adapters           few
     ╱─────────────╲
    ╱ integration   ╲       Prisma against ephemeral Postgres             dozens
   ╱─────────────────╲
  ╱       unit        ╲     pure logic, mocks at the seam                 hundreds
```

Two heuristics:

1. **Push tests down**. If a behavior can be proven at unit level with the right mock, don't drag it up to e2e. e2e seconds add up.
2. **Push assertions out**. The closer the assertion is to the user-visible contract (HTTP status + body), the more bugs it catches. Unit tests that assert "service called repo with exact arg" rot fast.

## Test runner

- **Jest** for everything (unit, integration, e2e).
- **Supertest** for e2e HTTP calls against a real Nest app instance.
- **ts-jest** transformer; `rootDir` = `src/` for unit, separate `test/jest-e2e.json` for e2e.
- Single test: `pnpm test -- path/to/file.spec.ts` or `pnpm test -- -t "partial name"`.

## Unit

What unit tests cover here: services, mappers, utils, and reducers. They mock at the seam — the repository for services, Prisma for repositories (sparingly).

### Services — mock the repository

```ts
describe('OrdersService.checkout', () => {
  it('rejects when cart is empty', async () => {
    const repo = {
      getCartWithItems: jest.fn().mockResolvedValue({ items: [] }),
    };
    const service = new OrdersService(repo as any, prismaMock(), eventBusMock());
    await expect(service.checkout('user_1', validDto)).rejects.toThrow(BadRequestException);
  });

  it('decrements product stock and creates ledger entry when useBalance is true', async () => {
    const repo  = buildRepoStub({ cart: cartWithOneProduct(), balance: { amount: 100 } });
    const tx    = buildPrismaTxMock();
    const events = eventBusMock();
    const service = new OrdersService(repo, prismaMock({ tx }), events);

    await service.checkout('user_1', { ...validDto, useBalance: true });

    expect(tx.product.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { stock: { decrement: 1 }, popularity: { increment: 1 } } }),
    );
    expect(tx.ledgerEntry.create).toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith('order.created', expect.any(Object));
  });
});
```

Rules:

- **Mock at the seam**, not deeper. For services, mock the repository (one mock, clean interface). Don't mock Prisma 7 levels deep — when the schema changes, the mock rots silently.
- **Test the business rule, not the framework**. "Decrements stock on checkout" is a rule. "Calls `tx.product.update`" is an implementation detail — though useful to assert when verifying the rule.
- **One behavior per test**. The test name reads as a sentence: "rejects when cart is empty", "snapshots prices into OrderItem", "emits order.created after commit".

### Repositories — keep them mostly untested

Repositories are thin Prisma wrappers. Most logic lives in services. Unit-test a repository only when it does something interesting (computed `where`, grouped query). Otherwise, the integration tests at the next level prove the Prisma calls work.

### Mappers / utils — pure functions, fast

`slugify('Hola Mundo!') === 'hola-mundo'`. No setup, no mocks. Highest ROI per test second.

## Integration

Integration tests exercise repositories against a **real Postgres** (ephemeral, per-test-file). The point: catch Prisma schema mismatches, FK violations, unique-constraint behavior, and `Decimal(12,2)` rounding before e2e or production does.

```ts
describe('OrdersRepository (integration)', () => {
  let prisma: PrismaService;
  let repo:   OrdersRepository;

  beforeAll(async () => {
    prisma = await createTestPrisma();   // boots TestContainer or shared docker postgres
    repo   = new OrdersRepository(prisma);
  });

  beforeEach(async () => prisma.cleanDatabase()); // truncates in dependency order

  afterAll(async () => prisma.$disconnect());

  it('persists OrderItem.unitPrice as Decimal(12,2)', async () => {
    const order = await repo.createOrderWithItems(buildOrderFixture({ unitPrice: '9.999' }));
    const fresh = await repo.findById(order.id);
    expect(fresh!.items[0].unitPrice.toString()).toBe('10.00'); // rounds half-up
  });

  it('enforces unique (cartId, productId, serviceId)', async () => {
    const cart = await fixture.cartWithItem();
    await expect(repo.addCartItem(cart.id, sameItem)).rejects.toMatchObject({ code: 'P2002' });
  });
});
```

Test database options (pick one consistently per repo):

| Option           | Pros                                                  | Cons                                |
| ---------------- | ----------------------------------------------------- | ----------------------------------- |
| **Testcontainers** (`@testcontainers/postgresql`) | Hermetic, version-pinned, parallel-safe.       | Slower cold start; needs Docker.     |
| Shared `docker compose` Postgres + truncate-between | Fastest; matches dev DB.                  | Tests can't run in parallel; risk of cross-test contamination if cleanup misses a table. |

Truncate ordering matters. Implement `PrismaService.cleanDatabase()` that disables FKs, truncates all tables, re-enables FKs. Don't expose it outside tests — guard with `if (NODE_ENV === 'production') throw`.

## E2E

E2E tests boot a full Nest application (all modules), hit it with `supertest`, and assert the HTTP response. They cover the controller layer, validation, guards, interceptors, and the envelope.

```ts
describe('POST /api/v1/orders/checkout (e2e)', () => {
  let app: INestApplication;
  let token: string;        // Clerk test token via @clerk/testing
  let userId: string;

  beforeAll(async () => {
    app   = await bootTestApp();          // imports AppModule, applies main.ts pipes
    token = await mintClerkTestToken({ role: 'CUSTOMER' });
    userId = await seedUser(token);
  });

  it('returns 200 and the wrapped envelope on success', async () => {
    await seedCartItems(userId, [productFixture()]);

    const res = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({ shipping: shippingFixture(), useBalance: false })
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ order: expect.objectContaining({ code: expect.stringMatching(/^ORD-\d{6}$/) }) }),
      }),
    );
  });

  it('returns 409 with the standard error envelope when stock is insufficient', async () => {
    const product = await seedProduct({ stock: 0 });
    await seedCartItems(userId, [{ productId: product.id, qty: 1 }]);
    const res = await request(app.getHttpServer())
      .post('/api/v1/orders/checkout')
      .set('Authorization', `Bearer ${token}`)
      .send({ shipping: shippingFixture() })
      .expect(409);

    expect(res.body).toMatchObject({ success: false, statusCode: 409 });
  });
});
```

Rules:

- E2E tests use the same `main.ts` configuration the production app uses (global pipes, interceptors, filters). Bootstrap via a `bootTestApp()` helper that mirrors `bootstrap()` from `main.ts`.
- **Auth uses real Clerk test tokens** from `@clerk/testing`. Never mock `ClerkAuthGuard` in e2e — the auth path is part of the contract.
- The webhook tests use **real signature payloads** (captured fixtures per provider) so signature verification is exercised. See [Contract](#contract).
- One e2e file per **HTTP entrypoint family** (`orders.e2e-spec.ts`, `payments-webhook.e2e-spec.ts`), not per service method.

## Contract

Contract tests pin the boundary between **us and an external provider**. They run against a captured fixture, not the live provider. The point: detect when a provider changes their event shape and our parser silently misclassifies.

```
test/contract/
├── stripe-webhook.contract.spec.ts
├── paypal-webhook.contract.spec.ts
├── clerk-webhook.contract.spec.ts
└── fixtures/
    ├── stripe/payment_intent.succeeded.json
    ├── stripe/payment_intent.payment_failed.json
    ├── paypal/CHECKOUT.ORDER.APPROVED.json
    └── clerk/user.created.json
```

```ts
describe('Stripe webhook contract', () => {
  it('parses payment_intent.succeeded into a CAPTURED event', async () => {
    const raw = readFileSync(path.join(__dirname, 'fixtures/stripe/payment_intent.succeeded.json'));
    const sig = stripe.webhooks.generateTestHeaderString({ payload: raw.toString(), secret: TEST_SECRET });
    const result = await stripeGateway.parseWebhook(raw, { 'stripe-signature': sig });
    expect(result).toMatchObject({ type: 'captured', providerId: expect.any(String) });
  });
});
```

Refresh the fixtures whenever a provider publishes a breaking change announcement. CI fails on parse mismatch — that's the signal to update the adapter, not the fixture.

## Test data

- **Factories**, not seed scripts. A `buildOrder()`, `buildProduct()`, `buildUser()` helper per module produces a complete, valid object with sensible defaults that callers override.

  ```ts
  export const buildProduct = (over: Partial<Product> = {}): Product => ({
    id: cuid(), name: 'Widget', slug: 'widget',
    price: new Decimal('19.99'), stock: 10, status: 'ACTIVE',
    categoryId: 'cat_default', createdAt: new Date(), updatedAt: new Date(),
    ...over,
  });
  ```

- **Snapshots**: avoid except for stable string outputs (formatted reports, email HTML rendered from a template). Snapshots of object graphs rot.
- **Time**: freeze with `jest.useFakeTimers()` when a test depends on `now()`. Don't sprinkle `new Date('2026-...')` literals — they read as flake-bait.

## What not to test

- **Controller-calls-service**. Pure delegation. The e2e test covers it end-to-end.
- **Framework behavior**. Don't test that `ValidationPipe` rejects an unknown field — Nest tests that. Test *your DTO's* validators (`@IsEmail`, `@Min`, etc.) with one happy + one sad case at unit level if the DTO has non-trivial rules.
- **Generated code**. Prisma generates types — don't snapshot them.
- **Trivial getters / pass-throughs**.
- **Implementation details**. "Service called `findById` then `update`" couples the test to refactor pain. Test the outcome (DB state or returned shape), not the call sequence.

## Coverage

| Layer / target           | Lines | Branches |
| ------------------------ | ----- | -------- |
| `services/`              | 80%   | 70%      |
| `repositories/`          | 70%   | 60%      |
| `mappers/`, `utils/`     | 90%   | 80%      |
| `dto/`                   | 0%    | 0%       | *(class-validator covers it)* |
| `controllers/`           | 0%    | 0%       | *(e2e covers it)* |

These are guidance, not a CI gate. The CI gate is **branch coverage across services + utils ≥ 75% globally**. A drop below that fails the build.

Coverage is a smoke detector, not a fire alarm. 100% line coverage with 0 assertions is the worst of both worlds.

## CI

```yaml
# .github/workflows/ci.yml (target)
jobs:
  test:
    services:
      postgres: { image: postgres:16-alpine, env: { POSTGRES_PASSWORD: vg } }
    steps:
      - uses: pnpm/action-setup@v3
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec tsc --noEmit
      - run: pnpm lint
      - run: pnpm prisma migrate deploy
      - run: pnpm test --coverage
      - run: pnpm test:e2e
      - uses: codecov/codecov-action@v4
```

Hooks:

- **Pre-commit** (husky + lint-staged): `eslint --fix` + `prettier --write` + run unit tests for changed files.
- **Pre-push**: full `pnpm test`. Optional — disabled if it takes > 60 s.

## Load tests

Out of scope for day-to-day work; run before:

- A traffic-spike event (Black Friday, marketing campaign, press launch).
- A major architectural change (Fastify → something else, Postgres version bump, switch to BullMQ).

Tooling: `k6` or `autocannon`. Capture a baseline; rerun after the change; diff. Drop the script + baseline in `test/load/`. Don't bake load tests into CI — they're flaky and expensive.

## Cross-references

- [05-patterns.md#testing](./05-patterns.md#testing) — short-form testing rules
- [06-infrastructure.md#database](./06-infrastructure.md#database) — `cleanDatabase()` policy
- [09-payments.md#testing](./09-payments.md#testing) — gateway contract tests
- [16-observability.md](./16-observability.md) — load-test outcomes feed SLO dashboards
