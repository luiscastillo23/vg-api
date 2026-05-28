# Runbook — Deploy

> **Audience**: anyone shipping a release. **Frequency**: weekly during normal operation; ad-hoc for hotfixes. **Risk**: deploys are the #1 source of incidents. Follow the checklist; don't skip steps.

> Related: [`rollback.md`](./rollback.md), [`../architecture/06-infrastructure.md#deployment`](../architecture/06-infrastructure.md#deployment), [`../architecture/15-security.md#release-checklist`](../architecture/15-security.md#release-checklist).

## Pre-flight (run for every deploy)

Block production push on **every** item:

- [ ] `main` branch CI is green (lint + typecheck + unit + e2e).
- [ ] All migrations in the release are **forward-compatible** with the previous app version — see [Schema changes](#schema-changes).
- [ ] No new env var introduced without a value in the secret manager **and** an entry in [`06-infrastructure.md`](../architecture/06-infrastructure.md#configuration) + `.env.example`.
- [ ] CHANGELOG updated; the merge PR has a one-line user-visible summary.
- [ ] `pnpm audit` is clean (or each finding has a ticket).
- [ ] No new endpoint missing `ClerkAuthGuard` or an explicit `@Public()`. Grep CI rule guards this — if it didn't, do it manually.
- [ ] No new external HTTP call without timeout + retry budget.
- [ ] If the deploy touches webhooks/payments/wallet, the on-call engineer has skimmed the diff.
- [ ] If the deploy is on a Friday or before a holiday, **don't** unless it's a hotfix.

## Standard deploy

1. **Tag and announce**

   ```bash
   git tag -a v$(date +%Y.%m.%d)-$(git rev-parse --short HEAD) -m "release: <summary>"
   git push --tags
   ```

   Post in `#deploys`: tag, PR link, expected window (typically 5–10 min).

2. **Run migrations** (release pipeline does this automatically; manual override if needed):

   ```bash
   pnpm prisma migrate deploy
   ```

   - **Never** `prisma migrate dev` against production.
   - If `migrate deploy` fails, **stop**. Don't push the new app version onto an inconsistent schema. Investigate, decide whether to fix-forward or rollback the migration (rare — see [Schema rollback](#schema-rollback)).

3. **Deploy the application**

   - Pipeline runs `pnpm install --frozen-lockfile && pnpm build` → container image → tagged with `${git_sha}`.
   - Rolling deploy: new instances come up, pass `/health` readiness, take traffic; old instances drain (≥ 30 s grace).
   - Watch `Dashboard 1 — Is the API healthy?` in real time ([`16-observability.md`](../architecture/16-observability.md#what-to-dashboard)).

4. **Smoke checks** (in this order, within 5 min of deploy completing):

   - `curl https://<host>/api/v1/health` → `200`.
   - `GET /api/v1/products` (no auth) → returns the standard envelope.
   - Hit Swagger at `/api/docs` (if exposed in prod) — verify the OpenAPI version bumped.
   - Sentry dashboard — confirm no new error class spiking.
   - Latency dashboard — p95 within 20% of baseline.

5. **Webhook spot-check**

   - Fire a test event from the Stripe dashboard → verify `200 OK` in the API logs with the event ID recorded in `WebhookEvent`.
   - Same for Clerk: trigger a `user.updated` from the dashboard for a known test user.

6. **Announce success** in `#deploys` with the dashboard link.

## Hotfix deploy

For a SEV-1/SEV-2 in-flight incident.

1. Branch from `main`: `git checkout -b hotfix/<ticket>`.
2. Minimal diff. **No** unrelated cleanups.
3. CI is mandatory but you may skip the e2e suite if it's the only blocker — note the skip in the PR and add a follow-up ticket.
4. Merge to `main`; deploy follows the standard flow above.
5. Postmortem still required even if the fix is trivial.

## Schema changes

The rolling-deploy assumption: for ~30 s, the new and old app versions both run, talking to the same DB. Migrations **must** leave the DB in a state both versions accept.

| Change                              | Safe in one deploy?    | Pattern                                                  |
| ----------------------------------- | ---------------------- | -------------------------------------------------------- |
| Add a nullable column               | Yes                    | Migrate first; app version that uses it deploys after.    |
| Add a non-nullable column with default | Yes                 | Migration sets the default; old version ignores the column. |
| Add a column **and** require it in code | No                  | Three deploys: (1) add nullable, (2) backfill + start writing, (3) make non-nullable. |
| Rename a column                     | No                     | Add new column → backfill + dual-write → switch reads → drop old. Four deploys, at least two of them migration-only. |
| Drop a column                       | No                     | Stop using in code (deploy) → drop in a later release (migration-only deploy). |
| Add an index                        | Yes, but               | `CREATE INDEX CONCURRENTLY` if the table is large; non-concurrent locks the table. |
| Change column type                  | No                     | New column → backfill → switch reads → drop old.          |
| Add a foreign key                   | Usually no             | Validate data first; FK creation can take a long lock.    |

If you can't tell whether a change is safe, **ask** before merging. The cost of a wrong migration in production is much higher than the cost of one more code review.

## Configuration changes

- Env-var-only changes (new secret, rotated key) are deployed by updating the secret manager + restarting instances. **No code change required.**
- A code path that gates behavior behind an env var should default to safe-off so the new var is non-breaking to add.
- Throttler / cache TTL changes: announce in `#deploys` because they alter behavior without a code review.

## Schema rollback

Rare. Forward-fix is almost always better than schema rollback. If you must:

1. Confirm the migration is reversible — many `DROP` migrations are not.
2. Manually craft the reverse migration; commit it as a new migration **forward** (don't rewrite history).
3. Run `prisma migrate deploy` in production with the new migration; the data may need manual reconciliation.
4. Postmortem mandatory.

## Communication

- **Slack `#deploys`** for every deploy. Even quiet ones.
- **Status page** only for customer-visible incidents (not routine deploys).
- **PagerDuty silence** during a planned deploy window (max 30 min). Don't silence for hotfixes — you want the page if the fix didn't fix.

## Post-deploy follow-up (24 h)

- Check Sentry once mid-day after a deploy. New error classes that didn't spike immediately but appear over a day.
- Check the slow-query log — a new query path can become an N+1 hot spot under real traffic.
- Look at the throttler dashboard — a new public endpoint may need a tighter limit.

## Common failure modes

| Symptom                                           | Likely cause                                                  | Action                                                 |
| ------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------ |
| Health probe fails after deploy                   | Migration didn't run, or app can't reach Postgres/Redis       | Check pipeline logs; `kubectl logs` (or equivalent).   |
| 5xx spike, no error message                       | Missing env var (Joi schema rejected at boot but pipeline didn't catch) | Check boot logs for `Config validation error`.   |
| Webhook events 400 immediately                    | Webhook signing secret rotated but env not updated            | Update the secret in the manager + restart.            |
| Latency p95 doubled                               | Slow query introduced; index missing                          | Slow-query log + EXPLAIN ANALYZE. Hotfix the index or rollback. |
| Some users 401 after deploy                       | Clerk `authorizedParties` mismatch (added a new origin?)      | Check `CLERK_AUTHORIZED_PARTIES`.                      |
| Schema drift between two app versions             | Migration not forward-compatible                              | [`rollback.md`](./rollback.md) — fix-forward is usually better. |
