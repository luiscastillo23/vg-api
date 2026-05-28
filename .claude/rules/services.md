# Service Rules

Applies to: `src/modules/**/*.service.ts`

## What services do
- Orchestrate business rules, own transactions, emit domain events, call repositories (own module only), call other modules' public services.

## Hard rules

### No cross-module repository imports
A service may only inject its own module's repository. Cross-module data needs go through:
1. The other module's public service (via `imports` in the module definition), or
2. A domain event consumed by a listener in the target module.

```ts
// ✅ — own repository
constructor(private readonly giftsRepo: GiftsRepository) {}

// ❌ — foreign repository
constructor(private readonly ordersRepo: OrdersRepository) {}
```

### Transactions for every multi-write rule
Wrap any business operation that performs more than one Prisma write in `PrismaService.runInTransaction`. Never call `prisma.$transaction` directly.

```ts
async checkout(dto: CheckoutDto, userId: string) {
  return this.prisma.runInTransaction(async (tx) => {
    // stock validation → order + payment create → stock decrement → ledger entry
  });
}
```
Operations that require a transaction: checkout, refunds, balance adjustments, top-up captures, user mirror sync.

### Events for fan-out, never reverse imports
When module B needs to react to something in module A, emit an event from A and subscribe in B. Do NOT import B's service into A to push the side effect.

```ts
// ✅ — emit after commit, outside runInTransaction callback
const order = await this.prisma.runInTransaction(async (tx) => { /* ... */ });
this.eventEmitter.emit('order.created', new OrderCreatedEvent(order));

// ❌ — emitting inside the transaction
await this.prisma.runInTransaction(async (tx) => {
  // ...
  this.eventEmitter.emit('order.created', ...); // DO NOT do this
});
```

### Logging
Inject `Logger` from `@nestjs/common` with the class name as context. Never `console.log`.

```ts
private readonly logger = new Logger(GiftsService.name);
```

### Errors
Throw Nest HTTP exceptions (`NotFoundException`, `BadRequestException`, `ConflictException`, etc.). Do not catch-and-rethrow Prisma errors — `PrismaExceptionFilter` maps `P2002 → 409`, `P2025 → 404`, `P2003 → 409` globally.
