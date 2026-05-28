# Runbook — Rollback

> **Audience**: on-call engineer. **When**: a deploy has caused a SEV-1 / SEV-2 and forward-fix isn't faster than reverting. **Goal**: stop user impact in under 5 minutes.

> Related: [`deploy.md`](./deploy.md), [`incident-template.md`](./incident-template.md), [`../architecture/06-infrastructure.md#deployment`](../architecture/06-infrastructure.md#deployment).

## Decision tree

```
                  Is the impact stoppable WITHOUT code revert?
                           (config flip / feature flag / throttler / scale-out)
                                  │
                ┌─────────────────┴─────────────────┐
                ▼ yes                                ▼ no
        Do that instead — faster.          Was the bad deploy schema-only?
                                                  │
                            ┌─────────────────────┴─────────────────────┐
                            ▼ yes                                        ▼ no
              See "Schema-only rollback".              Was the bad deploy app-only (no migration)?
                                                                ▼ yes
                                                  See "App-only rollback".
                                                                ▼ no (both)
                                                  See "App + schema rollback".
```

**Forward-fix beats rollback** when:

- The fix is a small, obviously-correct patch (a typo, a missing null check, a config value).
- The deploy that broke things contained a non-reversible migration.
- The data written by the bad app version is meaningful and worth keeping.

**Rollback beats forward-fix** when:

- You don't know the root cause yet.
- The bad app version is corrupting data faster than support can catch up.
- The fix would take > 15 min to write and ship.

## App-only rollback

The previous container image is still available (image registry retention is at least 30 days).

```bash
# Option A — pipeline-driven (preferred)
deploy.sh --tag <previous-good-sha>

# Option B — manual
kubectl set image deployment/api api=<registry>/api:<previous-good-sha>
kubectl rollout status deployment/api          # wait for green
```

After traffic shifts (≤ 60 s):

1. Confirm error rate drops on the latency dashboard.
2. Hit `/health`, `/products`, and one authenticated route to smoke-test.
3. Announce in `#incidents` + `#deploys`.
4. The bad deploy's PR is reverted on `main` before any other deploy goes out — leaving `main` in a known-broken state is how you ship the same bug twice.

## Schema-only rollback

The bad deploy was a migration but no app change.

**Most migrations are not safely reversible.** Adding a column is reversible; backfilling and switching reads is not. Before reverting any migration, ask:

- Is the new schema *compatible* with the previous app version? If yes, **leave it**. Roll back nothing; the deploy was harmless from the app's perspective.
- Is the new schema causing the app to error? Then the issue is in the migration's effects (e.g. a CHECK constraint rejecting existing data, a renamed column the app still references).

If reversal is truly necessary:

1. Confirm reversibility: read the migration. If it `DROP`s a column or `DROP`s data, the reversal is data loss — **stop and escalate**.
2. Author a **new forward migration** that undoes the change (don't rewrite Prisma migration history).
3. Apply via `pnpm prisma migrate deploy` in production.
4. Postmortem; the deploy checklist needs a new rule.

## App + schema rollback

Worst case. App version Y depends on migration M. Rolling app to X without reversing M may leave M's schema in place — which X may or may not tolerate.

1. Read M carefully. Determine:
   - Is X compatible with M's resulting schema? → roll app back; leave M; postmortem.
   - Does X crash against M's schema? → see "Schema-only rollback" above.

2. If the answer is "neither is safe", forward-fix is the only path:
   - Buy time: scale out the bad version, throttle the worst-hit endpoints, flip feature flags off.
   - Author the forward fix; ship it via the hotfix path.
   - Postmortem.

## Restore (point-in-time, last resort)

The managed Postgres provider supports point-in-time recovery within the retention window (~7 days for the default config).

Restore conditions are extreme:

- The bad deploy corrupted data with no application-level reversal.
- The corruption is bounded (we can identify all bad rows).
- Restoring loses N minutes of legitimate writes — the trade-off is acceptable.

Steps:

1. Page the on-call engineer **and** the database owner. Two people, no exceptions.
2. Snapshot the current DB first — restoring on top of an unbackup-ed live DB is permanent.
3. Restore to a parallel DB at a known-good timestamp.
4. Identify the delta (rows written between timestamp and now). Decide which to replay.
5. Cut over via DNS / connection-string flip. Schedule the cutover for low-traffic time if possible.
6. Long postmortem. This is a SEV-1 by definition.

## What to do during the rollback

While the rollback rolls:

- **Update the status page** if customer impact is visible. "We're investigating elevated errors; mitigating now."
- **Silence noisy duplicate alerts** but keep the original alert ringing — silencing the page is the on-call's call, not anyone else's.
- **Stop other deploys.** Block the deploy pipeline on the `incident` channel topic.
- **Capture state.** Screenshots of dashboards, logs at the time of the deploy, sentry incidents — they will rot in 24 h. Save them now.

## After the rollback

| Checkpoint               | Window after rollback |
| ------------------------ | --------------------- |
| Error rate at baseline   | 5 min                  |
| Latency at baseline      | 10 min                 |
| Webhook queues drained   | 30 min (Stripe retries) |
| Status page green        | When sustained recovery confirmed |
| Postmortem draft started | Within 24 h of resolution |

If the rollback **doesn't** restore service, you have a deeper problem (the bad state is in the DB, the bad state is in a cache, the issue isn't actually the deploy). Stop, regroup with the team.

## Reverting on `main`

Once production is stable:

1. `git revert <bad-merge-commit>` on `main`.
2. PR through normal review — don't push directly.
3. Deploy the revert (it should be a near-no-op since prod already runs the previous good version).
4. Add a test that would have caught the original bug. Reverts without a test are how the same bug ships twice.

## Common mistakes

- **Rolling back code while leaving the migration in place** without checking compatibility. Half the rollback incidents become a second incident this way.
- **Squashing the bad commit on `main`.** History matters. `git revert`, don't rewrite.
- **Skipping the postmortem because "the fix was obvious".** If it was obvious, the deploy checklist should have caught it. The postmortem owns adding that line.
- **Calling it resolved before traffic patterns confirm.** Wait one full traffic cycle (typically peak-hour) before closing the incident.
