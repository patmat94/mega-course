# 0017 · Every role reads live facts and the house notes at start; the harness reads back each course verdict

**Status:** accepted

## Decision

1. Every agent role (a Host Desk role, a worker, a headless agent) reads its facts from their source at every start: settings, prices, limits, accounts. It never runs on values copied into its prompt or its code. A role that judges or changes code also reads the house notes (the `why/` folder, or the project's own decision notes) before it acts. A rule that exists only in code does not count as read: the role has to see the note that explains it.
2. When an agent reports a course verdict (accepted, refused, paid, done), the harness reads that verdict back from the course itself before it tells the human or claims. Sources include a read-back call, the course's reply in a log file the harness wrote, and the state endpoint. The agent's own summary is not proof.

The rules live in AGENTS.md under Principles.

## How (2026-11-17, rook-plane fb8ee340ad00)

Rule 1 runs in code through the `rook-plane` skill (`.agents/skills/rook-plane/`): each role keeps a `reads.json`, and its starter runs plane's `startup.mjs`, which reads every entry (the `why/*.md` notes included) into a dated start bundle and adds a line to the role's `runs.jsonl`. The bundle is the role's system prompt. In the Host Desk, `roles/plane-start.mjs` does this for every role, and each `run.mjs` keeps its own Pi tool flags. The per-role `house-notes.mjs` scripts were removed because the bundle now carries the notes.

A read that needs a secret goes through rook-clock's `egress.mjs`, which plane takes only from outside the project. For the Host Desk the project is `mega-s04e01/starter/host-desk`, so the repo's `.agents/skills/rook-clock` qualifies. The reviewer's `settings` read (`Bearer {{ATTEMPT}}`, hosts from its own `hosts.json`, value from `vars.json`) runs in the start bundle, and the role no longer fetches it itself. The payout-runner's commission stays in `batch.mjs`, because its attempt is created inside the run.

## Why

In S04E02 the given reviewer passed hunk `h-bf3` (commission 10 → 15 %). Its ROLE.md pinned settings 2026-11-10.1 at 15 %, while the live `/settings` said 10 %, so the course refused the review (`mega-s04e02/log.txt:27`). The reviewer also had no way to read `why/`, and caught the rounding change only on the model's own judgment. Once it read `GET /settings` and `why/` (via `scripts/house-notes.mjs`) at every start, the next review was accepted (`mega-s04e02/log.txt:33`). The payout-runner had live settings in its batch script but no house notes, so its rules (rounding down, nights, payout date) existed only in code.

Both reviewer runs reported their own result: "my first POST was refused as malformed … the second one went through". The harness read the verdict back from the course (`{ already: true }`) each time, and those read-backs, not the agent's words, are the evidence in the ticket.

## Decided by

The human, 2026-11-17 (asked for the rule after the S04E02 debrief).
