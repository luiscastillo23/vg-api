# 0001 — Record architecture decisions

- **Status**: Accepted
- **Date**: 2026-05-25
- **Decision-makers**: VirtualGifts engineering team
- **Tags**: meta, process

## Context

Architectural choices accumulate silently. Six months in, no one remembers why we picked Brevo over Postmark, why payments are abstracted over a gateway interface, why the wallet is a ledger rather than a single mutable column. Without a written record, new engineers either re-litigate the decision badly or copy a pattern they don't understand.

We want a lightweight format that:

- Captures **why** more than **what** — the code already shows what.
- Lives in version control next to the code so changes ship in PRs, not in a wiki nobody reads.
- Is short enough that writing one isn't a chore.
- Is immutable: a decision isn't edited after the fact. It's superseded by a new ADR.

## Decision

We adopt **MADR-lite** Architecture Decision Records, stored at `docs/decisions/NNNN-kebab-title.md`. Each ADR has:

```
- Status: Proposed | Accepted | Superseded by NNNN | Deprecated
- Date: YYYY-MM-DD (decision date, not file-edit date)
- Decision-makers: who signed off
- Tags: 1–3 keywords for searchability

## Context           (the forces and constraints)
## Decision          (one paragraph; the chosen path)
## Consequences      (good, bad, and forced follow-ups)
## Alternatives considered  (each with one-line rationale for rejection)
```

Numbering is monotonic. New decisions get the next number, even if a draft is abandoned (use `Status: Withdrawn` rather than reusing the slot).

**Edits to an accepted ADR** are limited to:

- Fixing typos.
- Adding a `Superseded by NNNN` line at the top once a successor lands.
- Adding a `Status: Deprecated` line with a reason.

Content changes that meaningfully alter the decision require a **new** ADR that supersedes the old.

### When to write one

- A choice that has at least one defensible alternative.
- A trade-off that's not obvious from the code.
- A pattern that we expect future PRs to follow.

Don't write an ADR for: a library version bump, a one-off bugfix, a naming choice within a single file. The bar is "would a new engineer six months from now ask 'why did we do it this way?'"

## Consequences

**Good**

- Newcomers can skim `docs/decisions/` and absorb the project's intent in 30 minutes.
- Disagreement during code review now has a clear citation ("see ADR-0005").
- We can deprecate a decision honestly (with a successor) rather than silently drift.

**Bad / cost**

- Writing the first ADR for a new area is the most expensive (~30 min of writing). Subsequent ones are cheap.
- Some decisions feel obvious in the moment and only become "decisions" in retrospect. We'll occasionally back-fill an ADR after the fact — that's fine, date it the actual decision date, not the back-fill date.

**Follow-ups**

- Each ADR is cross-linked from the relevant `docs/architecture/*` file so reading one direction leads to the other.

## Alternatives considered

- **Confluence / Notion**: easier to write, easier to forget. Pages go stale because they're not next to the code.
- **GitHub wiki**: same problem as Confluence; not part of the PR.
- **Full MADR template**: more sections (positive/negative consequences, links, validators). Overkill for a small team — adopt only if we grow.
- **No ADRs**: tried that in past projects. Six months later we couldn't reconstruct why we picked half of our stack.
