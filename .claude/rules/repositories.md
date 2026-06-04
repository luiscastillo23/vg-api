# Repository Rules

Applies to: `src/modules/**/*.repository.ts`

## What repositories do
- Execute Prisma queries and return Prisma types. Nothing else.

## Hard rules

### Return Prisma types
Return raw Prisma model types (or `Promise<PrismaModel | null>`). Mapping to domain entities or DTOs belongs in the `mappers/` layer, not here.

```ts
// ✅
async findById(id: string): Promise<Gift | null> {
  return this.prisma.gift.findUnique({ where: { id } });
}

// ❌ — mapping inside the repository
async findById(id: string): Promise<GiftDto> {
  const gift = await this.prisma.gift.findUnique({ where: { id } });
  return GiftMapper.toDto(gift);
}
```

### No business logic
Repositories must not contain conditional domain logic, business rule enforcement, or calculations. A `WHERE` filter that reflects a query need is fine; a `WHERE` that enforces a business invariant (e.g. "only return gifts with status ACTIVE if user is not admin") belongs in the service.

### Soft delete — currently not implemented (status: removed Jun 2026)
The previous global `$use` soft-delete middleware was **removed**: the `prisma-client` generator's runtime has no `$use`, so it crashed the app at boot. There is **no soft-delete mechanism right now** — `delete`/`deleteMany` are hard deletes. Reimplementing it requires a Client Extension (`$extends`), not `$use`, and is a design task (a `query` extension can't turn a `delete` into an `update`). Until it lands, do not write repositories that assume automatic `deletedAt` filtering; if a model needs soft delete, raise it as a design task first.

### Pagination via `paginate()`
Use the shared `paginate(delegate, args, page, limit)` utility from `src/common/utils/paginate.ts`. Do not hand-roll `skip`/`take` offset logic.

```ts
async findAll(page: number, limit: number, search?: string) {
  return paginate(this.prisma.gift, { where: { name: { contains: search } } }, page, limit);
}
```

### Use transactional client when inside a transaction
When called from a service that uses `runInTransaction`, accept `tx` as an optional parameter and prefer it over `this.prisma`.

```ts
async create(data: Prisma.GiftCreateInput, tx?: PrismaClient) {
  return (tx ?? this.prisma).gift.create({ data });
}
```

### Slow-query threshold
The `PrismaService` warns on queries > 250 ms. If a query triggers this, add the missing index — do not raise the threshold.
