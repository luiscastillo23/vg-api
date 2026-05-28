# Runbook — Stripe webhook failure

> **Symptom shorthand**: Orders sit in `PENDING` after payment, OR `Payment.status` doesn't reach `CAPTURED`, OR Stripe dashboard shows webhook delivery failures. Customers paid but the system doesn't know.

> Money is involved. This is at minimum SEV-2. If cash-impact > a few hundred dollars / minute, treat as SEV-1.

> Related: [`../architecture/09-payments.md`](../architecture/09-payments.md), [`../architecture/07-data-flows.md#payment-webhook`](../architecture/07-data-flows.md#payment-webhook), [`incident-template.md`](./incident-template.md).

## Symptoms

| Signal                                                      | Meaning                                              |
| ----------------------------------------------------------- | ---------------------------------------------------- |
| Customer ticket: "I paid but my order says pending"         | Webhook didn't land (or failed processing).          |
| Stripe dashboard → Webhooks → recent deliveries showing 4xx/5xx | Direct confirmation.                              |
| `WebhookEvent` count for `provider='stripe'` flat-lines      | No deliveries reaching us — endpoint reachability, signature, or raw-body issue. |
| Sentry: spike of `Invalid signature` from the webhook handler | Secret mismatch (most common after rotation).      |
| `Order.status='PENDING'` count older than 10 min growing     | Captures aren't being processed.                     |
| Dashboard 2 ("Are the cash flows healthy?") webhook-latency panel red | Backlog or failures.                       |

## Diagnose

1. **Is our API up?**

   ```
   curl https://<host>/api/v1/health
   ```

   5xx → not a webhook issue; jump to general incident triage.

2. **Stripe dashboard → Developers → Webhooks → the endpoint**

   - Recent deliveries column shows the last ~30 attempts and their status.
   - Click into a failed delivery; the response body usually identifies the problem precisely.

   | Response                              | Likely cause                                              |
   | ------------------------------------- | --------------------------------------------------------- |
   | `400 Webhook signature verification failed` | `STRIPE_WEBHOOK_SECRET` mismatch (rotation, env drift). |
   | `404`                                  | Endpoint URL wrong in Stripe.                             |
   | `5xx` with our error envelope          | Handler bug; check Sentry.                                 |
   | Timeout                                | Slow handler or unhealthy instance.                       |

3. **App-side logs**

   Filter `route=POST /api/v1/webhooks/:provider` and `provider=stripe`. Common patterns:

   - `Invalid signature` → secret mismatch.
   - `P2002` on `WebhookEvent` → idempotent replay; not a problem.
   - `Cannot find payment for providerId=pi_...` → the event refers to a `pi_*` we never wrote. Usually means a test webhook hit prod, or someone manually triggered a Stripe event for a stale payment.
   - Unhandled exception → bug, escalate.

4. **Raw-body wiring**

   ```
   grep -rn "fastify-raw-body\|rawBody" src/
   ```

   If a deploy removed the raw-body registration, every Stripe webhook will fail with `Invalid signature`. Check the last deploy diff.

5. **Stripe-side outage**

   Check https://status.stripe.com. If Stripe is degraded, webhook deliveries will queue on their side; they'll catch up automatically after recovery.

## Mitigate

### A. Signing-secret mismatch

1. Stripe dashboard → endpoint → reveal the signing secret.
2. Compare to `STRIPE_WEBHOOK_SECRET` in the secret manager.
3. If different, update the secret manager and restart instances.
4. From the Stripe dashboard, **redeliver** the failed events (per-event button). They land idempotently because of `WebhookEvent.eventId` uniqueness.

### B. Endpoint URL wrong

1. Edit the endpoint URL in the Stripe dashboard.
2. Redeliver failed events.

### C. Raw-body wiring missing

1. Rollback the offending deploy ([`rollback.md`](./rollback.md)).
2. Regression test added before the next deploy.

### D. Stripe-side outage

- Do not manually replay during the outage.
- Stripe retries failed deliveries with exponential backoff for ~3 days.
- Communicate to customer support: "Stripe is degraded; pending orders will reconcile automatically when Stripe recovers."

### E. Our handler is too slow (Stripe's timeout is ~30 s; ours should ack within 5 s)

1. Check latency dashboard for the webhook route.
2. If a `runInTransaction` is holding the DB lock, look for a recently-added consumer doing something expensive inside the transaction. The handler's transaction should only persist the event + update the payment + call `OrdersService.markPaid` — no network calls, no large queries.
3. Hotfix or rollback the offending change.

## Recovery & reconciliation

Once mitigation is in place:

1. **Replay missed events** from the Stripe dashboard:
   - Go to **Events** view → filter by date range covering the incident.
   - Bulk select → **Resend** events with status `failed` or `pending`.
   - Confirm `WebhookEvent` table count rises and `Order.status='PENDING'` count for affected orders drops.

2. **Reconcile orders stuck in `PENDING`** that the event-replay didn't catch (orders where the Stripe-side payment status is `succeeded` but our `Payment.status` is still `PENDING`):

   ```sql
   SELECT o.id, o.code, p."providerId", p.status, o."createdAt"
   FROM "Order" o
   JOIN "Payment" p ON p."orderId" = o.id
   WHERE o.status = 'PENDING' AND p.status = 'PENDING'
     AND o."createdAt" < NOW() - INTERVAL '15 minutes'
   ORDER BY o."createdAt";
   ```

   For each: check the corresponding `pi_*` in the Stripe dashboard.
   - If Stripe shows `succeeded` → admin tool `PaymentsService.markPaid(orderId)` (or wait for the eventual webhook retry).
   - If Stripe shows `failed` → admin tool `PaymentsService.markCancelled(orderId, 'payment_failed')`.
   - If Stripe has nothing → checkout never started a Stripe session. Customer never paid — cancel.

3. **Update affected customers** if the delay was customer-visible:
   - Refund any double-charges (rare — Stripe's idempotency on the front-end usually prevents these).
   - Send a one-off apology / status email if appropriate.

## Resolve

- Stripe dashboard delivery success rate ≥ 99% for 1 hour.
- No `Order.status='PENDING'` rows older than 15 min (excluding intentional new orders mid-flight).
- `WebhookEvent` table writes resume at the expected rate.

## Postmortem follow-ups (common)

- Add an alert: "Webhook backlog age > 5 min" (oldest unack-ed event).
- Add an alert: "Stripe `Invalid signature` errors > 5/min" (catches rotation mishaps quickly).
- Audit secret-rotation procedure: must update secret manager **before** rotating in Stripe, with a brief overlap window where both secrets are accepted.
- Verify the contract test for `payment_intent.succeeded` would have caught the regression.
- Document the same procedure for the other 5 providers (each has its own dashboard + retry semantics; same overall shape).

## Reference

- [`09-payments.md`](../architecture/09-payments.md) — full payments architecture
- [`07-data-flows.md#payment-webhook`](../architecture/07-data-flows.md#payment-webhook) — webhook sequence
- [`0005-payment-provider-abstraction.md`](../decisions/0005-payment-provider-abstraction.md) — gateway design rationale
