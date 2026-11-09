# 0008 · Send fields with the example's exact types; run phone pushes where a failure shows

## Decision

1. **Copy field types from the example, not only field names.** Before a request body goes to the course or any API, each field's JSON type (number, string, boolean, array, object) must match the example or schema the contract gives. A field the contract shows as `2` is sent as `2`, never `"2"`; a list is sent as an array, never as a joined string. Data that comes back from storage (KV, a file, a query) is converted to the contract's type where the body is built, not where it is stored. Before the send, check the built body against the example: for every field, `typeof` matches. Where the agent generates the body (a status log, a register answer), that check runs in its tests.
2. **A phone push never rides only on background work that can end silently.** A push (ntfy or any other) that a human must receive is not fired only inside `ctx.waitUntil`, a detached promise, or work that runs after the response is sent. Instead:
   - the push runs where its result is seen: its own request, a queue or cron job, or a durable retry record;
   - each attempt writes a log entry with its status, before any retry waits, so a missing push leaves a trace;
   - a push that does not succeed stays pending, and a retry (a scheduled job, or an admin re-ping) sends it again until a 2xx comes back;
   - "notified" (or any row that says the human was reached) is written only when the push service answers 2xx, at that moment.
   Test the push from inside the host where the agent runs, not only from this laptop, because the network route differs.

The rules live in AGENTS.md under Principles.

## Why

In S02E05 the status log was refused five tries in a row with "Round 2: log_mismatch: received", although every time and every row was right. The agent wrote `"round": "2"` as a string, and the course's validator skips such a row instead of naming the field (`mega-s02e05/log.txt:175`). The answer with `"round": 2` was accepted at once (`mega-s02e05/log.txt:189`).

In the same solve, the agent's ntfy push ran inside `ctx.waitUntil` after the reply. It left no ping entry and no "notified" row, so nothing showed it had failed (`mega-s02e05/log.txt:183`). Re-pings from the Worker got 429 and 522 for about 12 minutes before a 200 (`mega-s02e05/log.txt:186`), and the push arrived 12 minutes after the message.

## Decided by

The human, 2026-11-09, from the S02E05 debrief's "Next time": "Match the example's field types exactly (number, not text), because a validator may skip a row instead of naming the field. Make the phone push retry outside the request's background work, because it can end silently. Can we add these things as behaviours in project?"
