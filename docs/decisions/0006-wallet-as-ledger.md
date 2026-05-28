# 0006 — Model the wallet as a balance + append-only ledger; credit refunds before the gateway call

- **Status**: Accepted
- **Date**: 2026-05-25
- **Decision-makers**: VirtualGifts engineering team
- **Tags**: wallet, money, ledger, refunds

## Context

The product supports an internal user wallet:

- Users top up via any payment provider; the wallet is credited on the captured webhook.
- Users can pay for orders from the wallet (`useBalance: true` at checkout).
- Refunds credit the wallet (rather than always going back to the original payment method).
- Admins can manually credit/debit with a reason.

Two design questions need an explicit answer:

1. **Storage model** — a single mutable `Balance.amount` column, or a balance + append-only ledger?
2. **Refund timing** — credit the user's balance *before* calling the gateway's refund API (immediate-credit) or *after* the gateway confirms (two-phase)?

### Storage model trade-offs

| | Single column | Balance + ledger |
| --- | --- | --- |
| Simplicity | one row, one number | two tables, motion-style writes |
| Audit | none ("how did this balance get to $42?") | every motion is a row with `reason`, `reference`, `referenceType` |
| Concurrency | row-lock on `Balance` | row-lock on `Balance`; ledger is append-only (no contention) |
| Reconciliation | "trust the number" | `SUM(credits) - SUM(debits) == Balance.amount` at all times |
| Reversal | overwrite | append a reversing entry; original is preserved |

A commerce wallet without an audit trail is a support nightmare. "Where did my $20 go?" must be answerable by reading rows, not by reading commit history.

### Refund timing trade-offs

| | Immediate-credit (Option 2 in `07-data-flows.md`) | Two-phase (Option 1) |
| --- | --- | --- |
| User perceived speed | refund visible in wallet immediately | user waits for gateway confirmation |
| Failure mode | gateway refund fails → user has credit, no gateway refund (drift, surfaced in reconciliation) | gateway refund fails → admin retries; user sees PENDING in the meantime |
| Code complexity | one transaction | two transactions + a reconciliation job |
| Audit clarity | one ledger entry per refund | a CREDIT entry + a PENDING/RESOLVED state on Refund |
| Customer ops | rare drift handled by reconciliation report | every failure is a manual ticket |

The product's stated preference is **user-perceived speed** over the elimination of a rare drift case. Drift surfaces in [`wallet-reconciliation.md`](../runbooks/wallet-reconciliation.md) and is resolved by support — typically by retrying the gateway refund, sometimes (in chargeback-on-refund cases) by writing a corrective ledger entry.

## Decision

**1. Storage**: a `Balance` row per user (one number) **plus** an append-only `LedgerEntry` table.

- Every change to `Balance.amount` writes exactly one `LedgerEntry` in the same Prisma transaction.
- `LedgerEntry.amount` is always positive; sign is encoded in `type: CREDIT | DEBIT`.
- `LedgerEntry.reason` is required and free-text; `LedgerEntry.reference` + `referenceType` link back to the originating `Order` / `Refund` / `AdminAction`.
- Ledger entries are never updated or deleted. Corrections are new reversing entries.
- A nightly reconciliation job verifies `SUM(case when type=CREDIT then amount else -amount end) == Balance.amount` per user.

**2. Refund timing**: **immediate-credit**.

- `RefundsService.create` opens a transaction that:
  1. Writes the `Refund` row.
  2. Updates the order status (`REFUNDED` / `CHARGEBACK` / partial-no-change).
  3. Increments the user's `Balance.amount`.
  4. Writes the `LedgerEntry` (CREDIT).
- **After** the transaction commits, calls `gateway.refund(payment.providerId, amount)`. This is outside the DB transaction because it's a network round-trip.
- If the gateway refund fails, the user already has the wallet credit. The drift is logged, surfaces in the nightly reconciliation report, and is resolved by support (typically: admin retries the gateway refund from the dashboard, then writes nothing — the credit is already there).
- The provider eventually sends a `refunded` webhook; we persist the raw event into `Payment.providerRaw` but don't re-credit (the credit already happened at refund creation time).

See [`10-wallet.md`](../architecture/10-wallet.md) for the full invariants and [`07-data-flows.md#refund`](../architecture/07-data-flows.md#refund) for the sequence diagram.

## Consequences

**Good**

- **Auditability**: every dollar's motion is a row. Support can answer "where did $X go?" without reading code.
- **Reconciliation is a SQL query**, not a custom analysis tool.
- **Reversibility without losing history**: a correction is a new entry, not an `UPDATE`. The original entry's `reason` is preserved.
- **Immediate refund UX**: users see the credit instantly. For a commerce app this is the right trade-off; "refund taking 3–5 business days" is a friction users tolerate from card networks but resent from a wallet.

**Bad / cost**

- Two tables instead of one. Slightly more code in `BalanceService`.
- The reconciliation job is non-optional infrastructure — if drift goes undetected, drift compounds.
- Immediate-credit means the wallet can credit a user before the gateway has actually refunded. In the rare gateway-refund-failure case, support must intervene. Mitigation: the daily reconciliation report flags any `Refund.status` where the gateway hasn't confirmed within a reasonable window.
- Concurrent debits need a re-read guard inside the transaction; a naive `decrement` can go negative ([`10-wallet.md#concurrency`](../architecture/10-wallet.md#concurrency)).

**Follow-ups**

- Implement the nightly reconciliation job and route failures to the on-call channel.
- Consider materializing balance-history snapshots quarterly so the ledger doesn't have to be summed across all time for reports.
- When/if we add multi-currency, the wallet becomes `(userId, currency)` not just `userId`. ADR required at that time.

## Alternatives considered

- **Single mutable column**: ruled out — no audit trail. The first support ticket asking "where did my money go" exposes the gap.
- **Two-phase refund (PENDING → RESOLVED)**: more correct in the gateway-failure case, but slower for users and significantly more code. We accept the rare drift in exchange for UX.
- **Full double-entry accounting (contra accounts, journals, etc.)**: overkill for our scale. The "double-entry-lite" approach (one ledger row per motion) gives us the audit benefits without the bookkeeping complexity.
- **Event-sourced wallet** (replay-from-events to compute balance): elegant on paper, expensive to read. Materialized `Balance` + append-only ledger is the practical compromise.
