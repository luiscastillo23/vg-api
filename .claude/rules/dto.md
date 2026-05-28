# DTO Rules

Applies to: `src/modules/**/dto/*.ts`

## What DTOs do
- Shape and validate input at the API boundary; shape output without leaking internal model fields.

## Hard rules

### class-validator on every input property

Every property on a request/input DTO must have at least one `class-validator` decorator. Relying on TypeScript types alone does nothing at runtime.

```ts
// ✅
export class CreateGiftDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsNumber()
  @Min(0)
  price: number;
}

// ❌ — no validation
export class CreateGiftDto {
  name: string;
  price: number;
}
```

### @Expose / @Exclude on output DTOs
Output DTOs (response shapes) use `class-transformer`. Decorate with `@Expose()` on included fields and `@Exclude()` at the class level (or per-property) to prevent accidentally exposing internal fields.

```ts
@Exclude()
export class GiftResponseDto {
  @Expose()
  id: string;

  @Expose()
  name: string;

  // internalCost is excluded implicitly
  internalCost: number;
}
```

### Never expose entities directly from controllers
Controllers return DTOs, not raw Prisma model instances. Use `mappers/` to convert:
- Prisma model → domain entity (optional, for richer domain logic)
- Prisma model / entity → response DTO (always)

### Separate input and output DTOs
- Input: `CreateXDto`, `UpdateXDto`, `QueryXDto`
- Output: `XResponseDto`, `XSummaryDto`
- Never reuse an input DTO as a response shape.

### Enum validation
For string unions, use `@IsEnum(MyEnum)` (from `class-validator`) so invalid values are caught at the boundary.

### Optional vs required
Mark optional fields with `@IsOptional()` and `?` on the property type. Do not mark everything optional for convenience — be explicit about what the API requires.

### PartialType for updates
Use `PartialType(CreateXDto)` from `@nestjs/mapped-types` to derive update DTOs rather than duplicating decorators.

```ts
export class UpdateGiftDto extends PartialType(CreateGiftDto) {}
```

### Pagination input
List endpoints use `PaginationDto` from `src/common/dto/pagination.dto.ts` — do not re-declare `page`, `limit`, `search`, `sortBy`, `sortOrder` in module DTOs. Extend or compose it.
