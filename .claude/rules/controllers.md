# Controller Rules

Applies to: `src/modules/**/*.controller.ts`

## What controllers do
- Declare routes, apply guards/decorators, validate input via DTOs, delegate to a service, return the result.
- Controllers own the HTTP contract — method, path, status code, decorators.

## Hard rules

### Never touch Prisma
Controllers must not import `PrismaService`, `PrismaClient`, or any repository. Delegate all data access to the module's service.

```ts
// ✅
@Get(':id')
findOne(@Param('id') id: string) {
  return this.giftsService.findOne(id);
}

// ❌ — repository import in a controller
constructor(private readonly giftsRepo: GiftsRepository) {}
```

### Always delegate to a service
No business logic, no conditional branching on domain rules, no direct DB calls. If the controller is doing work beyond routing, move it to the service.

### DTOs on every input
- Route params: `@Param()` with a typed DTO or `ParseUUIDPipe` / `ParseIntPipe`.
- Query strings: `@Query()` with a DTO decorated with `class-validator`.
- Request bodies: `@Body()` with a `CreateXDto` / `UpdateXDto`.
- `ValidationPipe` (global) enforces `whitelist + forbidNonWhitelisted + transform` — decorate every property.

### Swagger on every public endpoint
```ts
@ApiOperation({ summary: 'Get a single gift by ID' })
@ApiResponse({ status: 200, type: GiftResponseDto })
@ApiResponse({ status: 404, description: 'Gift not found' })
```
Add `@ApiBearerAuth()` on guarded routes and `@ApiTags('gifts')` on the controller class.

### Never hand-wrap responses
Return the bare value from the service. `TransformInterceptor` wraps it into `{ success, data, meta? }`.

```ts
// ✅
return this.giftsService.findAll(paginationDto);

// ❌
return { success: true, data: await this.giftsService.findAll(paginationDto) };
```

### Errors via Nest exceptions
Throw `NotFoundException`, `BadRequestException`, `ConflictException`, etc. Do not catch Prisma errors — `PrismaExceptionFilter` handles `P2002`, `P2025`, `P2003` globally.

## Auth decorators
- `@Public()` — bypass `ClerkAuthGuard` (use for health, Swagger, public catalog reads, webhooks).
- `@Roles(Role.ADMIN)` — role-gate a route after auth passes.
- Default (no decorator) — all authenticated users pass.

## Global prefix
Never hardcode `/api/v1` in controller paths. The prefix is set globally in `main.ts`.
