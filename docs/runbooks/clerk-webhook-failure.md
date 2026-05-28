# Runbook — Clerk webhook failure

> **Symptom shorthand**: Clerk events aren't reaching the `User` mirror. Authenticated requests start failing with `401 User not provisioned or inactive`, OR user profiles are stale, OR new sign-ups can't use the API.

> Related: [`../architecture/08-auth-clerk.md`](../architecture/08-auth-clerk.md), [`../architecture/07-data-flows.md#clerk-user-sync`](../architecture/07-data-flows.md#clerk-user-sync), [`incident-template.md`](./incident-template.md).

## Symptoms

| Signal                                                      | What it usually means                                |
| ----------------------------------------------------------- | ---------------------------------------------------- |
| Sentry / log spike of `401 User not provisioned or inactive` | `user.created` webhook never landed (or failed processing). |
| `WebhookEvent` table count for `provider='clerk'` has flat-lined | All Clerk deliveries are failing — likely signature mismatch. |
| User reports "I signed up but the app says I'm unauthorized" | Same — webhook didn't land for them.                |
| Clerk dashboard "Webhooks" page shows 4xx/5xx on recent deliveries | Direct confirmation.                                |
| Webhook handler logs show `Invalid signature` repeatedly    | Signing secret mismatch (most common after a rotation). |

## Diagnose

Work top-to-bottom — stop at the first match.

1. **Is the API up?**

   ```
   curl https://<host>/api/v1/health
   ```

   If 5xx → this isn't a webhook issue, see other runbooks.

2. **Is the webhook endpoint reachable from outside?**

   ```
   curl -X POST https://<host>/api/v1/webhooks/clerk -H 'Content-Type: application/json' --data '{}'
   ```

   Expect 400 (bad signature). If you get a connection error, the route isn't published or the load balancer is misrouting.

3. **What does the Clerk dashboard say?**

   - Sign in to Clerk → **Webhooks** → the endpoint for this environment.
   - Recent deliveries column shows the last attempts and their status.
   - Click into a failed delivery; the response body usually says exactly what's wrong.

   Common responses:

   | Response                                  | Likely cause                                                      |
   | ----------------------------------------- | ----------------------------------------------------------------- |
   | `400 Invalid signature`                   | `CLERK_WEBHOOK_SIGNING_SECRET` mismatch (most common after rotation). |
   | `404 Not Found`                           | Wrong endpoint URL configured in Clerk (typo / stale env URL).     |
   | `5xx` with stack trace                    | Bug in the webhook handler — see app logs.                         |
   | Timeout                                   | Handler is slow, or the API instance is unhealthy.                |

4. **App-side logs for the webhook path**

   Filter by route template `POST /api/v1/webhooks/clerk` in the log aggregator. Look for:

   - `Invalid signature` errors → secret mismatch.
   - `P2002` errors → idempotent replay; not a problem.
   - Unhandled exceptions → bug, escalate.

5. **Is `fastify-raw-body` still wired for the webhook route?**

   ```
   grep -rn "rawBody\|fastify-raw-body" src/
   ```

   If a recent deploy removed the raw-body registration, signatures will all fail. Check the latest deploy diff.

## Mitigate

In order of "least invasive first":

### A. If signatures are failing — rotate / re-sync the signing secret

1. Clerk dashboard → Webhooks → endpoint → reveal current signing secret.
2. Compare to `CLERK_WEBHOOK_SIGNING_SECRET` in the secret manager.
3. If mismatched, update the secret manager and restart instances.
4. From the Clerk dashboard, **redeliver** the failed events (button next to each row). They land idempotently because of the `WebhookEvent` dedupe.

### B. If the endpoint URL is wrong

1. Clerk dashboard → Webhooks → endpoint → edit URL.
2. Set to the current public URL (e.g. `https://api.example.com/api/v1/webhooks/clerk`).
3. Redeliver failed events.

### C. If the raw body wiring is missing (deploy regression)

1. Roll back the offending deploy via [`rollback.md`](./rollback.md).
2. Author a regression test: hit `/webhooks/clerk` with a valid Svix-signed payload and assert it passes.

### D. If a Clerk-side outage is responsible

- Check the Clerk status page.
- Clerk's webhook delivery retries automatically with exponential backoff for ~24 h. **Don't** manually replay during a Clerk outage — let their queue drain.

## Resolve

1. The `WebhookEvent` table starts gaining rows again at the expected rate (correlate with Clerk dashboard delivery rate).
2. The `401 User not provisioned` log spike returns to zero.
3. The mirrored `User` rows have current `email` / `firstName` / `lastName` for users who edited their Clerk profile during the incident.

## After the incident

Triage which users were affected during the outage window:

- Find all `WebhookEvent` rows for `provider='clerk'` written **after** Clerk's reported recovery time → these were redelivered. The corresponding `User` rows are now consistent.
- For users who attempted to sign in during the window and got `401` — they likely retried successfully once the webhook caught up. If not, support can manually trigger a `user.updated` from the Clerk dashboard for that specific user.

If any user is **still** in a bad state (Clerk says they exist, but `User` row is missing or `status='INACTIVE'`):

1. Pull the user's `clerkId` from the Clerk dashboard.
2. From the admin tooling, manually trigger `UsersService.createFromClerk(clerkEventPayload)` against that specific user.
3. Confirm via `GET /api/v1/users/:id`.

## Postmortem follow-ups (common)

- Add an alert: "Clerk webhook success rate < 95% over 5 min".
- Add a synthetic monitor: post a known-good signed payload every 5 min from an external uptime checker; alert if it fails.
- Confirm `WebhookEvent` retention is at least 30 days for forensics.
- If the cause was a rotated secret, add to the deploy checklist: "rotating any webhook secret requires deploying the new value before flipping the rotation in the provider dashboard, not after".

## Reference

- [`08-auth-clerk.md#webhook-handler`](../architecture/08-auth-clerk.md#webhook-handler) — handler design and idempotency
- [`07-data-flows.md#clerk-user-sync`](../architecture/07-data-flows.md#clerk-user-sync) — sequence diagram
- Clerk webhook docs: https://clerk.com/docs/integrations/webhooks (user provides the link if needed; do not fetch)
