# 16 — Observability

You can only operate what you can see. This file covers logs, metrics, traces, health, error tracking, and SLOs. The goal is to keep the cost-to-debug low without drowning ourselves in dashboards.

> Section index: [Three pillars](#three-pillars) · [Logs](#logs) · [Metrics](#metrics) · [Traces](#traces) · [Health](#health) · [Error tracking](#error-tracking) · [Slow-query log](#slow-query-log) · [SLOs & alerts](#slos--alerts) · [What to dashboard](#what-to-dashboard) · [Cross-references](#cross-references)

## Three pillars

- **Logs**: every request, every error, every domain-significant event. Structured JSON.
- **Metrics**: counts, latencies, gauges. Pulled from logs initially, then a metrics endpoint.
- **Traces**: per-request span tree across HTTP → service → Prisma. OpenTelemetry-compatible.

Don't try to land all three on day one. Logs first (free, ship now); add metrics when an alert needs one; add traces when "where did the time go?" becomes a frequent question.

## Logs

### Stack

- **Logger**: `pino`. Fast, structured, low overhead.
- **Nest integration**: `nestjs-pino` (or wire `pino` into `Logger` from `@nestjs/common` with `winston`-style transport — `nestjs-pino` is the path of least surprise).
- **Dev**: `pino-pretty` for human-readable output.
- **Prod**: raw JSON to stdout, scraped by the container runtime and forwarded (Datadog Agent / Vector / Fluent Bit).

### Levels

| Level | When                                                                      |
| ----- | ------------------------------------------------------------------------- |
| `fatal` | The process is unrecoverable (database unreachable for > N seconds). Triggers restart. |
| `error` | A request failed in a way that requires investigation (5xx, webhook signature failed, unexpected exception). |
| `warn`  | A request succeeded but a side rail triggered (slow query > 250 ms, rate limit hit, missing optional config). |
| `info`  | Request line, lifecycle events (`module init`, `consumer started`).        |
| `debug` | Verbose. Off in production unless investigating.                          |
| `trace` | Per-step decisions. Off everywhere unless explicitly enabled for a tenant. |

`LOG_LEVEL` env var controls the floor. Default: `info` in prod, `debug` in dev.

### Structured fields

Every log line carries:

```json
{
  "level": "info",
  "time": "2026-05-27T19:05:12.407Z",
  "msg": "POST /api/v1/orders/checkout 200 142ms",
  "req": { "id": "01HX...", "method": "POST", "path": "/api/v1/orders/checkout", "ip": "203.0.113.5" },
  "res": { "statusCode": 200 },
  "userId": "cuid_user_abc",
  "orderId": "cuid_order_xyz"
}
```

- `req.id` — generated per request by Fastify's `requestId` (`x-request-id` if the client provides one, else uuid). Propagate it to outgoing HTTP calls (`X-Request-Id` header).
- `userId` — added by `LoggingInterceptor` after `ClerkAuthGuard` runs; absent on public routes.
- Domain-significant IDs (`orderId`, `paymentId`, `refundId`) added by the service when relevant. Add via `logger.assign({ orderId })` so they appear on every log line for the remainder of the request.

### Redaction

`pino`'s `redact` config strips sensitive paths. See [15-security.md#pii--logging](./15-security.md#pii--logging). The redact list is part of the boot wiring, not a per-call concern.

### LoggingInterceptor

```ts
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const req = ctx.switchToHttp().getRequest();
    const start = Date.now();
    return next.handle().pipe(
      tap({
        next: () => req.log.info({ res: { statusCode: req.res.statusCode } }, `${req.method} ${req.url} ${Date.now() - start}ms`),
        error: (err) => req.log.error({ err, res: { statusCode: err.status ?? 500 } }, `${req.method} ${req.url} FAILED`),
      }),
    );
  }
}
```

`req.log` is Fastify's per-request child logger — it already has `req.id` bound.

## Metrics

Start by reading metrics out of structured logs (count `level=error`, percentile `latencyMs`). As soon as a dashboard becomes load-bearing, expose a Prometheus scrape endpoint:

```ts
// modules/common/metrics.module.ts (when added)
@Module({ ... })
export class MetricsModule { ... }
// GET /metrics — text/plain Prometheus exposition format
```

Library: `prom-client`. Wire counters/histograms in `LoggingInterceptor` for request duration + status code, plus per-domain counters (`orders_checkout_total{status="paid"}`).

Don't expose `/metrics` publicly. Either bind it to an internal port or gate with the throttler + an internal token.

### Default metrics

| Metric                                  | Type      | Notes                                    |
| --------------------------------------- | --------- | ---------------------------------------- |
| `http_requests_total{method,path,status}` | counter | `path` is the route template, not the URL (else cardinality explodes). |
| `http_request_duration_seconds`         | histogram | Buckets: 5ms, 10ms, 25ms, 50ms, 100ms, 250ms, 500ms, 1s, 2.5s, 5s. |
| `prisma_query_duration_seconds`         | histogram | Same buckets. Tag with `model` + `action`. |
| `event_emitter_handler_duration_seconds` | histogram | Per `eventName + handler`.              |
| `webhook_events_total{provider,result}` | counter   | `result ∈ { processed, duplicate, invalid_signature, error }`. |
| `payments_amount_total{provider,status}` | counter  | `amount` in major units (no PII).        |
| `cache_hits_total{key_prefix}` / `cache_misses_total` | counter | For the reports cache. |

## Traces

Plan, not implemented: OpenTelemetry SDK wiring with the OTLP exporter sending to the platform agent (Datadog / Honeycomb / Tempo).

Instrument when you have:

1. A second service (or worker) the request crosses into.
2. A repeated "where did the time go?" investigation that logs can't answer.

Until then, a `req.id` in every log line + a `/metrics` histogram covers most needs.

## Health

`GET /health` via `@nestjs/terminus`. Checks:

- Postgres: `prismaService.$queryRaw\`SELECT 1\``.
- Redis: `ioredis.ping()`.
- (Future) Brevo API: `GET /v3/account` ping; mark degraded but not down on failure.

Return shape:

```json
{
  "status": "ok",
  "info":  { "postgres": { "status": "up" }, "redis": { "status": "up" } },
  "details": { "postgres": { "status": "up" }, "redis": { "status": "up" } }
}
```

`200 OK` when all required dependencies are up; `503 Service Unavailable` otherwise. Wire this to your load balancer's liveness/readiness probe with a 3-failure threshold.

Don't add deep business checks (e.g. "can I run a sample checkout?") to `/health` — those go in synthetic monitoring instead. Health probes need to be cheap and fast.

## Error tracking

Recommendation: **Sentry** (or equivalent — Bugsnag, Rollbar).

- Forward unhandled exceptions from `AllExceptionsFilter` to Sentry with the `req.id`, `userId`, and route template.
- Tag releases with `git sha` so the dashboard correlates errors to deploys.
- Suppress expected business errors (`ConflictException`, `NotFoundException`, `ValidationException`) — they're not bugs; only 5xx and unexpected exceptions go to Sentry.

```ts
// src/main.ts — when Sentry is wired
Sentry.init({
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
  release: env.GIT_SHA,
  tracesSampleRate: 0.1,
});

// global exception filter
if (status >= 500) Sentry.captureException(err, { tags: { route: routeTemplate }, user: { id: req.user?.id } });
```

## Slow-query log

`PrismaService` already emits `warn` on queries > 250 ms ([06-infrastructure.md#slow-query-log](./06-infrastructure.md#slow-query-log)). Operational rule: every recurring slow-query warning becomes either an index, a query rewrite, or a paginated/limited variant. **Do not raise the threshold.**

The slow-query log is the cheapest performance tool we have. Treat it as a backlog of "queries that will eventually take the site down."

## SLOs & alerts

Start simple. Three SLOs:

| SLO                                | Target              | Window  | Alert when                              |
| ---------------------------------- | ------------------- | ------- | --------------------------------------- |
| **Availability** (non-5xx ratio)   | 99.9% over rolling 28d | per minute | error rate > 1% for 5 min               |
| **Latency** (p95 of authenticated GETs) | < 250 ms        | per minute | p95 > 500 ms for 5 min                  |
| **Webhook freshness** (event-id → processed) | < 5 s p95       | per minute | p95 > 30 s for 5 min                    |

Plus point alerts:

- Health probe failing for > 2 min.
- Reconciliation drift > 0 in the nightly wallet job.
- Prisma error rate spike (any P10xx).
- Throttler hit-rate > 5% sustained (someone's hammering us).
- Brevo API non-2xx response rate > 10% over 5 min.

Alerts go to:

- **Critical (paging)**: PagerDuty → on-call rotation. Only the SLO-breach alerts and reconciliation drift page.
- **Warning (Slack)**: #api-alerts. Everything else.

Alert routing rules + on-call calendar live in the deploy runbook.

## What to dashboard

Two dashboards is plenty. Resist the urge to ship more.

**Dashboard 1 — "Is the API healthy?"**

- p50/p95/p99 latency per route family (`/products/*`, `/orders/*`, `/webhooks/*`).
- Error rate per family (5xx + 4xx separately — 4xx tells you about clients).
- Throttler hits.
- Health probe status.
- Active WS connections (when chat is live).

**Dashboard 2 — "Are the cash flows healthy?"**

- Orders created / paid / refunded per hour.
- Payments by provider × status.
- Wallet balance distribution (histogram) + drift from reconciliation.
- Webhook processing latency per provider.
- Brevo send success rate.

Both dashboards live in the same tool the alerting lives in (Datadog/Grafana). Cross-link from alert messages to the dashboard pane that explains the alert.

## Cross-references

- [06-infrastructure.md#observability](./06-infrastructure.md#observability) — infra wiring summary
- [05-patterns.md#logging](./05-patterns.md#logging) — code-level logging conventions
- [15-security.md#pii--logging](./15-security.md#pii--logging) — redaction
- [`incident-template.md`](../runbooks/incident-template.md) — postmortem with dashboards/queries
