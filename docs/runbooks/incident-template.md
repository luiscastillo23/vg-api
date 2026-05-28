# Incident template

Use this as the shape of every postmortem doc. Drop a copy into `docs/runbooks/incidents/YYYY-MM-DD-<short-title>.md`. The runbooks in this folder (`stripe-webhook-failure.md`, `s3-outage.md`, etc.) follow the same structure — they're the **diagnose + mitigate** half written ahead of time, so an on-call engineer at 3 a.m. doesn't have to invent the playbook.

> Blameless. The goal is "what about the system let this happen" — never "who screwed up". If you can't write a section blamelessly, rewrite it.

## Header

```
- Incident ID: INC-YYYY-MM-DD-NN
- Title: short, factual, no jargon ("checkout 5xx spike for 18 min")
- Severity: SEV-1 (full outage) | SEV-2 (degraded for many users) | SEV-3 (degraded for some / workaround) | SEV-4 (internal only)
- Status: Open | Mitigated | Resolved | Postmortem complete
- Started: YYYY-MM-DD HH:MM TZ
- Detected: YYYY-MM-DD HH:MM TZ            (alert fired, or human noticed)
- Mitigated: YYYY-MM-DD HH:MM TZ           (impact stopped, even if root cause not fixed)
- Resolved: YYYY-MM-DD HH:MM TZ            (root cause fixed, no recurrence)
- Customer impact: 1-sentence description of what users experienced
- On-call: who held the page
- Responders: who else worked on it
- Postmortem due: Resolved + 5 business days
```

## Summary

Two or three sentences. What broke, what was the impact, when did it stop. The reader should be able to skip the rest if they only need the gist.

## Impact

Quantified. Examples:

- **Users affected**: ~X% of authenticated users between HH:MM and HH:MM (estimated from `LoggingInterceptor` counts).
- **Requests affected**: N failed checkouts; M failed cart additions.
- **Money**: $X in delayed/failed orders; $Y in successful orders manually reconciled.
- **External signals**: support tickets opened, social media mentions, status-page subscribers notified.

If the number is unknown, say "unknown — to investigate". Don't paper over.

## Timeline

UTC, monotonic, no editorializing. Include the alert, the human moves, the deploy/rollback, and the all-clear.

```
HH:MM   Alert fires (link to alert)
HH:MM   On-call paged
HH:MM   First responder confirms in #incidents, opens this doc
HH:MM   Hypothesis A formed (link to dashboard panel that suggested it)
HH:MM   Hypothesis A ruled out
HH:MM   Action X taken (config flip / scale up / rollback) — link to PR / runbook step
HH:MM   Customer impact ends (link to dashboard panel showing recovery)
HH:MM   Root cause confirmed
HH:MM   All-clear posted
```

## Root cause

The technical reason. One paragraph. Don't bury it.

If it's a chain of three things, list them — but only the technical chain, not the human one.

## Resolution

What action(s) stopped the bleeding (not necessarily fixed the root cause). Often: rollback, feature-flag flip, scale-out, manual data correction.

## Detection

How did we find out? Did the alert fire, or did a user tell us? If the alert didn't fire — why? Add the "no alert existed" or "alert was misrouted" follow-up below.

## Contributing factors

Things that made the incident worse than it had to be. Each is a candidate follow-up.

- Was the relevant dashboard hard to find?
- Did the alert page the wrong person?
- Did the runbook miss a step?
- Did a recent change make this fail more loudly?
- Was the rollback path slower than ideal?

## What went well

A short list. Resist the urge to skip this section because "everything was on fire". Something always worked.

## Follow-ups

Concrete, owned, dated.

```
- [ ] Add an alert for X. (owner: @name, due: YYYY-MM-DD, ticket: VG-NNN)
- [ ] Add a test that would have caught this. (owner: @name, due: YYYY-MM-DD)
- [ ] Update the X runbook to include the workaround we discovered. (owner: @name, due: YYYY-MM-DD)
- [ ] Rate-limit the X endpoint so it can't melt down again. (owner: @name, due: YYYY-MM-DD)
```

Two or three high-impact follow-ups beat a wall of "we should also...". Be ruthless.

## Lessons / surprises

One or two sentences. What did this incident teach the team that wasn't obvious from the architecture docs? If the answer is "nothing surprising, we just hadn't built X yet", that's still useful — write it.

---

## Severity definitions (reference)

| SEV  | Means                                                                                  | Page on-call?            |
| ---- | -------------------------------------------------------------------------------------- | ------------------------ |
| SEV-1 | Full outage for all users, OR money-handling broken (e.g. checkout, refunds, ledger drift). | Yes, immediately.        |
| SEV-2 | Major functionality degraded for many users, OR clear path to SEV-1 if not addressed.  | Yes.                     |
| SEV-3 | Degraded for some users / workaround exists / non-critical surface affected.            | During business hours.   |
| SEV-4 | Internal-only: dashboards down, dev environment broken, reports stale.                  | No; fix during business hours. |

When in doubt, err one severity higher; downgrade later if the impact turns out to be smaller. Underreporting a SEV is worse than overreporting one.

## Cross-references

- [`deploy.md`](./deploy.md) — deploy & rollback procedure
- [`rollback.md`](./rollback.md) — rollback specifics
- [`../architecture/15-security.md`](../architecture/15-security.md) — security-incident specifics
- [`../architecture/16-observability.md`](../architecture/16-observability.md) — dashboards & alerts
