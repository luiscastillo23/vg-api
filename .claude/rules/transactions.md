# Transaction Rules

Applies to: `src/modules/**/*.service.ts` — any method performing multiple Prisma writes

## Hard rules

### runInTransaction for every multi-write business rule
Any operation that performs more than one Prisma write where the writes are interdependent MUST use `PrismaService.runInTransaction`. Never call `prisma.$transaction` directly — `runInTransaction` standardizes the 15 s timeout / 5 s maxWait configured in `PrismaService`.

```ts
// ✅
async checkout(dto: CheckoutDto, userId: string) {
  return this.prisma.runInTransaction(async (tx) => {
    const stock = await tx.product.findUnique({ where: { id: dto.productId } });
    if (stock.quantity < dto.qty) throw new BadRequestException('Insufficient stock');
    // ...all writes use `tx`, not `this.prisma`
  });
}

// ❌
await this.prisma.$transaction([...]);
```

### Operations that require a transaction

| Operation | Required writes |
|---|---|
| Checkout | stock validation → `Order` + `Payment` + `OrderItem` creates → stock decrement → optional `Balance` debit + `LedgerEntry` → cart clear |
| Refund | `Refund` create + `Payment` status update + `Balance` credit + `LedgerEntry` |
| Balance adjustment (admin / top-up) | `Balance` update + `LedgerEntry` — never one without the other |
| Clerk user mirror sync | `User` upsert (triggered by Clerk webhook) |

### Always use `tx` inside the callback
Pass the transactional client to every repository or Prisma call inside the callback. Using `this.prisma` inside a `runInTransaction` callback bypasses the transaction.

```ts
// ✅
return this.prisma.runInTransaction(async (tx) => {
  await this.ordersRepo.create(orderData, tx);
  await this.paymentsRepo.create(paymentData, tx);
});

// ❌ — mixing this.prisma inside the callback
return this.prisma.runInTransaction(async (tx) => {
  await this.ordersRepo.create(orderData, tx);
  await this.prisma.payment.create({ data: paymentData }); // wrong client
});
```

### WHERE guards for stock and balance
Before decrementing stock or debiting balance, read the current value with a `SELECT ... FOR UPDATE` equivalent (Prisma: `findUnique` inside the transaction) and assert the invariant (`quantity >= requested`, `balance >= amount`). Throw a `BadRequestException` if violated — don't let the DB catch it silently.

### Idempotency keys for external calls
External payment gateway calls (Stripe, PayPal, etc.) inside or adjacent to a transaction must include an idempotency key derived from a stable identifier (e.g., `orderId`, `paymentId`). This prevents duplicate charges if the service retries after a DB commit but before the response is stored.

```ts
const intent = await this.stripe.paymentIntents.create(
  { amount, currency },
  { idempotencyKey: `checkout-${orderId}` },
);
```

### Emit events after commit, never inside the callback
`EventEmitter2` events must be emitted after `runInTransaction` resolves, not inside the async callback. Emitting inside the callback means listeners may run before the transaction commits (or not at all if it rolls back).

```ts
// ✅
const order = await this.prisma.runInTransaction(async (tx) => { /* ... */ });
this.eventEmitter.emit('order.created', new OrderCreatedEvent(order));

// ❌
await this.prisma.runInTransaction(async (tx) => {
  // ...
  this.eventEmitter.emit('order.created', ...); // premature
});
```
