# S04E03 · Three small changes · the Host Desk works as a team on one board

## Outcome

The Host Desk (mega-s04e01/starter/host-desk) has a team: three given roles run as they are, plus a planner written with the human. In one attempt the planner posts a plan to the shared board before any job starts, each job takes one of the host's three change requests, posts its change and touches only the files its plan gave it, and today's payout batch passes on the merged work.

**Who it is for / how we'd know it helped:** the host (and the human) — one board holds the plan, each job's change and the answers, so the work outlives this chat; measured as: 3 of 3 requests done, 0 files changed outside each job's plan list, batch passes on the first run of the attempt. Limits set by Claude; human to confirm.

## Scope

- The team zip, unzipped into mega-s04e01/starter (where the S04E01 zip went); the planner role under host-desk/roles.
- Host Desk vars: TICKET from start-challenge, ATTEMPT from the manual (fetched once).
- The board API (GET /board, plan, changes, POST /board/questions), settings, run.
- Roles start through the rook-plane skill and read facts from source at each start (ADR 0017).

## Out of scope

- The day-3 zip (contains earlier answers; only if the human asks).
- Changing the three given roles.

**Boundaries:** no download, model spend or outside action without the human's yes; the manual is fetched once per attempt; a job never edits a file outside its plan.

**Fails if:** a job starts before the plan is on the board; a job changes a file not in its plan; the batch fails; the work spans two attempts.

## Acceptance

- [x] Plan posted to the board before any job starts (board timestamps). · evidence: log.txt:39
- [x] Each of the 3 change requests has a job that posted its change. · evidence: log.txt:33, log.txt:39
- [x] Each job changed only the files its plan gave it (diff vs plan). · evidence: log.txt:28, log.txt:39
- [x] Today's payout batch passes on the merged work. · evidence: log.txt:42, log.txt:43, log.txt:46
- [x] All of it in one attempt (one ATTEMPT in vars, manual fetched once). · evidence: manual.jsonl, log.txt:19, log.txt:40
- [x] Every course verdict (accepted, paid, done) read back from the course itself, not from an agent's report. · evidence: log.txt:39, log.txt:42, log.txt:47
- [x] Every outside action (download, model spend, board question) had the user's yes first. · evidence: log.txt:12, log.txt:13, log.txt:23
- [x] Tickets and tokens are masked in `log.txt`; the raw ones are only in `receipts.json`. · evidence: log.txt:10, receipts.json
- [x] The live board was polled right before this claim and brought nothing new. · evidence: log.txt:47
- [x] claim-challenge returns solved (after claim) · evidence: log.txt:51

## Notes

- Questions for the host go to POST /board/questions; the human reads the answers (start-challenge `you`).
