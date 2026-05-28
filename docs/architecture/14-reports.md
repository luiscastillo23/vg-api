# 14 — Reports & exports

The reports module powers the admin dashboard. It serves two kinds of payload: **read-only aggregates** (cached JSON for charts/KPIs) and **on-demand exports** (CSV/Excel/PDF for download). Everything here is admin-only and cached aggressively because the underlying queries are expensive.

> Section index: [Shape](#shape) · [Query DTO](#query-dto) · [Aggregates](#aggregates) · [Cache](#cache) · [Exports](#exports) · [Async generation](#async-generation) · [Download URLs](#download-urls) · [Performance](#performance) · [Cross-references](#cross-references)

## Shape

```
modules/reports/
├── reports.module.ts
├── reports.controller.ts        # /reports/* endpoints (read aggregates + start export)
├── reports.service.ts           # orchestration: cache get-or-compute, dispatch to query+export
├── queries/                     # one file per chart/KPI — pure query functions
│   ├── kpis.query.ts
│   ├── revenue.query.ts
│   ├── top-products.query.ts
│   └── ...
├── exports/                     # one file per export format
│   ├── csv.exporter.ts          # csv-stringify
│   ├── excel.exporter.ts        # exceljs
│   └── pdf.exporter.ts          # pdfkit (server-side) or puppeteer (HTML→PDF)
└── dto/
    ├── report-query.dto.ts
    └── export-request.dto.ts
```

Why query files instead of repository methods? Each query is read-only, aggregate-heavy, and stable — they don't fit the repository pattern (no row CRUD). They're closer to "named views" of the database.

## Query DTO

Every report endpoint accepts the same shape:

```ts
// dto/report-query.dto.ts
export class ReportQueryDto {
  @IsDateString() from: string;                          // ISO date, inclusive
  @IsDateString() to: string;                            // ISO date, exclusive
  @IsEnum(Granularity) granularity: Granularity;         // 'day' | 'week' | 'month'
  @IsOptional() @IsString() kind?: string;               // chart-specific subfilter (e.g. 'PRODUCT' vs 'SERVICE')
  @IsOptional() @IsString() segment?: string;            // e.g. 'top-10' for ranked lists
}

export enum Granularity { Day = 'day', Week = 'week', Month = 'month' }
```

Validation rules in the service:

- `to > from`.
- `to - from <= 365 days` (else 400 — anyone wanting more uses an export, not a chart).
- `granularity` must match the range (day-level over a 6-month range melts the dashboard).

## Aggregates

| Endpoint                              | Source                                        | Notes                                  |
| ------------------------------------- | --------------------------------------------- | -------------------------------------- |
| `GET /reports/kpis`                   | Orders, Payments, Users                       | Totals + period-over-period delta.     |
| `GET /reports/revenue`                | `Order` (status IN PAID..COMPLETED)            | Bucketed by granularity.               |
| `GET /reports/sales`                  | `OrderItem` summed by quantity                | Volume, not value.                     |
| `GET /reports/categories`             | `OrderItem` joined to `Product.categoryId`     | Distribution pie.                      |
| `GET /reports/top-products`           | `OrderItem` ranked by lineTotal sum            | `segment` selects top-N.               |
| `GET /reports/top-services`           | Same, but for services                         |                                        |
| `GET /reports/recent-orders`          | `Order` order by createdAt desc, limit         | Not bucketed.                          |
| `GET /reports/registrations`          | `User` by createdAt                            | Bucketed.                              |
| `GET /reports/activity`               | `ActivityLog` grouped by `action`              | Bucketed.                              |
| `GET /reports/alerts`                 | `Product` where stock < threshold              | Live (no cache, threshold low).        |
| `GET /reports/refunds`                | `Refund` summed by amount, count               | Bucketed.                              |
| `GET /reports/best-sellers`           | Same as top-products with stricter filter      | All-time.                              |
| `GET /reports/clv`                    | Computed per user: lifetime spend             | Heavy query — recompute nightly only.   |
| `GET /reports/balance`                | `Balance` + `LedgerEntry`                      | Distribution + drift.                  |
| `GET /reports/performance`            | Catalog read latency, conversion              | Read from `pino` summaries.            |

Each query function takes the same `ReportQueryDto` and returns a typed result. Controllers don't know which query backs which endpoint — that mapping is in `ReportsService`:

```ts
const QueryRegistry = {
  'kpis':           runKpisQuery,
  'revenue':        runRevenueQuery,
  'top-products':   runTopProductsQuery,
  // ...
} satisfies Record<string, ReportQuery>;
```

## Cache

Backed by Redis (`cache-manager` + `ioredis`). Key shape:

```
reports:<endpoint>:<sha256(JSON.stringify(query))>
```

Default TTL: **5 minutes** for dashboard reads, **15 minutes** for ranked lists. Tunable per endpoint in `QueryRegistry`. The cache is a write-through pattern keyed by the canonical query — a 1-minute difference in `from` produces a different key (intentional; admins generally pick "last 7 days" presets).

**Invalidation**: time-based only. We don't bust the cache on writes — a 5-minute lag on revenue charts is acceptable. If we ever need real-time, we'd add a pub/sub channel from `OrdersService` events to flush keyed-by-orderId scopes; not worth the complexity today.

User-scoped caching is forbidden — reports are admin-only and identical for every admin, so the user is not part of the key. Adding a user-scoped report later **must** include `userId` in the cache key.

## Exports

```
POST /reports/exports { kind, format, query }
  → @Roles(Role.ADMIN)
  → ReportsService.startExport(adminId, dto)
       Sync if small (estimate count ≤ 5k rows) → return file URL
       Async if large            (estimate > 5k) → enqueue + return job id
  ↓
Sync:
  data = await runQuery(dto.kind, dto.query)
  buffer = await exporter(dto.format).render(data, dto.query)
  key = `exports/admin/<adminId>/<cuid>.<ext>`
  await storage.upload({ buffer, filename: `${dto.kind}-${dto.format}.${ext}`, mime: mimeFor(format), ownerId: adminId, scope: 'admin-document' })
  Return { status: 'ready', url: signed5MinUrl(key) }
  ↓
Async:
  jobId = await exportQueue.add('render-export', { adminId, dto })
  Return { status: 'pending', jobId }
```

Export job listener (BullMQ when added; until then, a 30-min interval via `@nestjs/schedule`):

```ts
@Processor('exports')
export class ExportProcessor {
  @Process('render-export')
  async handle(job: Job<{ adminId: string; dto: ExportRequestDto }>) { ... }
}
```

| Format | Library          | Use case                               |
| ------ | ---------------- | -------------------------------------- |
| CSV    | `csv-stringify`  | Default. Spreadsheets, BI tools.       |
| XLSX   | `exceljs`        | Multi-sheet, formatted, totals.        |
| PDF    | `pdfkit` (or `puppeteer` for HTML→PDF) | Print-friendly, e.g. monthly revenue report. |

## Async generation

Big exports (CLV across 100k users, full-year orders) take minutes. The flow:

1. `POST /reports/exports` returns `{ status: 'pending', jobId }`.
2. Client polls `GET /reports/exports/:jobId` until `status === 'ready'`.
3. The completed job writes the file to S3 and stores `{ key, expiresAt }` in a `ReportExport` row keyed by `jobId`.
4. The completed-poll response contains a freshly signed download URL.

Optional: instead of polling, push a `Notification` to the admin when the job completes. That keeps the UI clean; the polling endpoint is still there for the BI scripts.

## Download URLs

Always **signed**, **short-lived** (5–15 min). Never publish a permanent URL to an export:

- A leaked URL with no expiry exposes the entire report.
- A timed URL forces re-authentication via the admin re-clicking "Download".

The signed URL is generated by `StorageService.getSignedReadUrl(key, 600)` — see [12-uploads.md](./12-uploads.md).

## Performance

Reports are read-heavy on potentially massive joins. Defenses:

- **Indexes**: every query in `queries/` lists the indexes it relies on in a comment header. New report → new index in the same migration. Slow queries logged via `PrismaService` (> 250 ms warning) — chase every one.
- **Aggregation in SQL**, not in JS: a 100k-row sum in JS is ~50× slower than `SELECT SUM(...) GROUP BY date_trunc('day', "createdAt")`.
- **Limit cardinality**: top-N queries cap at N ≤ 100. Ranked lists default to 10.
- **Date filters required**: every query DTO requires `from` and `to`. No "all time" charts — they grow forever.
- **No `SELECT *`**: every query projects exactly the columns the chart needs.
- **Pre-aggregation**: when a query routinely takes > 1 s, materialize it. Use a Postgres materialized view refreshed every N minutes, or a `ReportSnapshot` table written by a scheduled job.

## Cross-references

- [04-api-rest.md#reports-admin-only--reports](./04-api-rest.md#reports-admin-only--reports) — endpoint surface
- [06-infrastructure.md#cache](./06-infrastructure.md#cache) — cache topology
- [12-uploads.md](./12-uploads.md) — `admin-document` scope used by exports
- [16-observability.md](./16-observability.md) — slow-query log + dashboards
