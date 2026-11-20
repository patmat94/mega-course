# 0021 · Before the first night, read every board job and seq gap; one result per event, not per delivery

**Status:** accepted

## Decision

For any desk or poller that takes events from a shared stream (an outbox, a board, a webhook feed):

1. Before the first night (the first live window), read every job on the board, with its owner and state, and every gap in the event sequence numbers the desk received. A job that no role of ours owns may be taking events from the same stream: name it to the human and stop it by id, with their yes.
2. Post one result per event, not one per delivery. A redelivery with the same id and the same data is a retry: ack it, and post nothing. Its result was already posted with the first delivery. A redelivery with the same id and different data is not a retry. It goes to the owner (`parked`), and nothing is recorded.

The rule lives in AGENTS.md under Principles. The human asked for it on 2026-11-20, from the S04E04 debrief.

## Why

In S04E04, the course jobs `legacy/export` and `rook/lint` took seq 5 and seq 12 every night. The desk's own log showed the gaps, but they read as a slow desk, so runs 4 and 5 were refused. In run 8, the desk posted `applied` a second time for each identical retry, and that run was refused too. Run 9 stopped both jobs, acked retries only and parked the changed redelivery, and it passed (`mega-s04e04/log.txt`, `mega-s04e04/outcome.md`).
