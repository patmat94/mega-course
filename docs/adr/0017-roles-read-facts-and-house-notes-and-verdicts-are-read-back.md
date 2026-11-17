# 0017 · Every role reads live facts and the house notes at start; the harness reads back each course verdict

**Status:** accepted

## Decision

1. Every agent role (a Host Desk role, a worker, a headless agent) reads its facts from their source at every start: settings, prices, limits, accounts. It never runs on values copied into its prompt or its code. A role that judges or changes code also reads the house notes (the `why/` folder, or the project's own decision notes) before it acts. A rule that exists only in code does not count as read: the role has to see the note that explains it.
2. When an agent reports a course verdict (accepted, refused, paid, done), the harness reads that verdict back from the course itself before it tells the human or claims. Sources include a read-back call, the course's reply in a log file the harness wrote, and the state endpoint. The agent's own summary is not proof.

The rules live in AGENTS.md under Principles.

## Why

In S04E02 the given reviewer passed hunk `h-bf3` (commission 10 → 15 %). Its ROLE.md pinned settings 2026-11-10.1 at 15 %, while the live `/settings` said 10 %, so the course refused the review (`mega-s04e02/log.txt:27`). The reviewer also had no way to read `why/`, and caught the rounding change only on the model's own judgment. Once it read `GET /settings` and `why/` (via `scripts/house-notes.mjs`) at every start, the next review was accepted (`mega-s04e02/log.txt:33`). The payout-runner had live settings in its batch script but no house notes, so its rules (rounding down, nights, payout date) existed only in code.

Both reviewer runs reported their own result: "my first POST was refused as malformed … the second one went through". The harness read the verdict back from the course (`{ already: true }`) each time, and those read-backs, not the agent's words, are the evidence in the ticket.

## Decided by

The human, 2026-11-17 (asked for the rule after the S04E02 debrief).
