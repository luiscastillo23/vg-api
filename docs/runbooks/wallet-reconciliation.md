# Runbook — Wallet reconciliation

> **Symptom shorthand**: Nightly reconciliation job reports drift between `Balance.amount` and the sum of `LedgerEntry` rows for one or more users. Money math doesn't add up.

> **Severity**: Any drift > $0 is SEV-2 minimum. We do not silently correct drift; every motion is a row.

> Related: [`../architecture/10-wallet.md`](../architecture/10-wallet.md), [`../decisions/0006-wallet-as-ledger.md`](../decisions/0006-wallet-as-ledger.md), [`incident-template.md`](./incident-template.md).

## The invariant

For every user, at all times:

```
Balance.amount  ==  SUM(LedgerEntry.amount WHERE type='CREDIT')
                  - SUM(LedgerEntry.amount WHERE type='DEBIT')
```

If this is ever false, something wrote to `Balance` without writing a ledger entry — or vice versa. Both are bugs.

## The job

A nightly scheduled job (BullMQ once we adopt it; today, `@nestjs/schedule` with `@Cron('0 3 * * *')`) runs:

```sql
SELECT b."userId",
       b.amount AS stored,
       COALESCE(SUM(CASE WHEN l.type = 'CREDIT' THEN l.amount ELSE -l.amount END), 0) AS computed,
       (b.amount - COALESCE(SUM(CASE WHEN l.type = 'CREDIT' THEN l.amount ELSE -l.amount END), 0)) AS drift
FROM "Balance" b
LEFT JOIN "LedgerEntry" l ON l."userId" = b."userId"
GROUP BY b."userId", b.amount
HAVING b.amount <> COALESCE(SUM(CASE WHEN l.type = 'CREDIT' THEN l.amount ELSE -l.amount END), 0);
```

Each returned row is a drift. The job:

1. Logs each drift at `warn`.
2. Counts total drifts.
3. If count > 0: sends an alert to the on-call channel (`#api-alerts`); pages on-call if drift > $50 cumulative.
4. Writes a `ReconciliationReport` row with the timestamp, drift count, and drift list (JSON).

## Diagnose

When the alert fires:

1. **Pull the report**

   ```sql
   SELECT * FROM "ReconciliationReport" ORDER BY "createdAt" DESC LIMIT 1;
   ```

   Read the JSON: which users drifted, by how much, in which direction.

2. **Inspect the worst-drift user**

   ```sql
   SELECT l.* FROM "LedgerEntry" l
   WHERE l."userId" = '<userId>'
   ORDER BY l."createdAt" ASC;
   ```

   Look for:

   - **Gaps**: timestamps where you'd expect a credit/debit (e.g. an `Order` with `status='PAID'` and `method='BALANCE'` but no corresponding `DEBIT` ledger entry).
   - **Orphans**: ledger entries whose `reference` points to an `Order` / `Refund` that no longer exists or never existed.
   - **Doubles**: two entries with the same `reference` and `type` (idempotency leaked).

3. **Cross-check the user's order history**

   ```sql
   SELECT o.id, o.code, o.status, o.total, o."createdAt",
          p.status AS payment_status, p.method, p."paidAt"
   FROM "Order" o
   LEFT JOIN "Payment" p ON p."orderId" = o.id
   WHERE o."userId" = '<userId>'
   ORDER BY o."createdAt" DESC;
   ```

   For every order where `method='BALANCE'` and `status IN ('PAID','PROCESSING','COMPLETED')`: there must be a matching `DEBIT` ledger entry with `reference=o.id` and `referenceType='ORDER'`. Missing one → that's your drift source.

4. **Cross-check refunds**

   ```sql
   SELECT r.id, r."orderId", r.amount, r."isChargeback", r."processedAt"
   FROM "Refund" r
   JOIN "Order" o ON o.id = r."orderId" AND o."userId" = '<userId>'
   ORDER BY r."processedAt" DESC;
   ```

   Each `Refund` should have a matching `CREDIT` ledger entry with `reference=r.id` and `referenceType='REFUND'`.

5. **Check admin actions**

   ```sql
   SELECT a.* FROM "ActivityLog" a
   WHERE a."targetId" = '<userId>' AND a.action IN ('BALANCE_CREDIT', 'BALANCE_DEBIT')
   ORDER BY a."createdAt" DESC;
   ```

   Every admin credit/debit should appear as both an `ActivityLog` row and a `LedgerEntry`. Mismatch → admin tool wrote to one but not the other (bug).

## Common causes

| Pattern                                                    | Likely cause                                                                 | Action                                                  |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------- |
| Drift on exactly one user, recent                          | A new code path wrote to `Balance` without a ledger entry. Likely a recent deploy. | Find the offending write; fix forward; write a corrective ledger entry (see [Correction](#correction)). |
| Drift on many users in one timestamp window                | A migration ran an `UPDATE` on `Balance` without writing ledger entries.     | Revert / fix the migration. Corrective entries per user. |
| Drift = the refund amount, gateway refund never landed     | Immediate-credit refund: credit is correct; gateway side failed. Per [ADR-0006](../decisions/0006-wallet-as-ledger.md). | Not a wallet bug. Retry the gateway refund. |
| Two ledger entries with the same `reference`               | Webhook idempotency failed somewhere.                                       | Investigate `WebhookEvent` table. Reverse the duplicate. |
| Ledger entry exists but `Balance.amount` doesn't reflect it | A transaction wrote the ledger row but the balance update rolled back, OR vice versa. | Should be impossible — both writes are in the same `runInTransaction`. If you see this, the transaction wasn't actually transactional. Audit the code path. |

## Correction

Never `UPDATE` `Balance.amount` directly. Never `DELETE` a `LedgerEntry`. To correct drift:

1. Determine the intended state (what `Balance.amount` *should* be, supported by which orders/refunds/admin actions).
2. Determine the corrective motion: positive (a missing CREDIT) or negative (a missing DEBIT), with the explicit `reason`:

   ```
   "Reconciliation correction: missing DEBIT for order ORD-000123, see INC-2026-05-28-01"
   ```

3. Use the admin credit/debit tool to apply the corrective ledger entry. The tool is the **only** sanctioned write path; it adds the `LedgerEntry` and updates `Balance.amount` in the same transaction.
4. Re-run the reconciliation job for that user; confirm drift = 0.
5. The corrective entry must reference the incident ID so the audit trail is preserved.

If the drift is a **duplicate** (extra ledger entry):

1. Compute the user's correct balance from the deduped history.
2. Write a **reversing** entry that cancels the duplicate. Don't delete the duplicate — append a reversal with `reason = "Reverse duplicate of LedgerEntry <id>"`.

## What NOT to do

- Do not `UPDATE Balance.amount = <number>` directly. Ever.
- Do not `DELETE FROM "LedgerEntry"` — the ledger is append-only.
- Do not "fix" a drift by rounding to a friendly number. Drift is a signal of a code bug; fix the bug first, correct the user's state second.
- Do not run the correction silently. The user should see the corrective entry in their movements list with a `reason` they can understand if they ask.

## Resolve

- Reconciliation job reports zero drift for at least one full nightly run after the corrective entries.
- The code path that caused the drift is fixed (test added or pattern audited).
- Affected users' next `GET /account/balance` shows the corrected amount.

## Postmortem follow-ups (common)

- Add an alert at lower thresholds (e.g. **any** drift, not just $50 cumulative). Wallet drift never gets less serious as it ages.
- Static-analysis or grep rule: forbid `prisma.balance.update` outside `modules/balance/` and `modules/orders/` (the two legitimate writers).
- Property-based test: simulate N concurrent checkouts + refunds, assert the invariant holds.
- Confirm `LedgerEntry` retention is forever (don't archive — the historical ledger is the audit).

## Reference

- [`10-wallet.md#invariants`](../architecture/10-wallet.md#invariants) — invariants in detail
- [`10-wallet.md#concurrency`](../architecture/10-wallet.md#concurrency) — race conditions to design for
- [`0006-wallet-as-ledger.md`](../decisions/0006-wallet-as-ledger.md) — model rationale
