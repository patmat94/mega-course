# S02E04 · two places · both jobs done by separate workers, joined by the main agent

## Outcome

The course has two jobs, each with its own MCP link (no sign-in, the link is the key, valid until 2026-11-07T15:30Z) and its own skill: job-1 `incident-lookup` v1, job-2 `voice-to-memo` v1 (with an mp3 clip). Each job is handed to a worker of its own: one on this machine, one elsewhere (a cloud harness or a CI run on an account the human owns). The main agent does not do the jobs. It takes both results and receipts, finds job 2's note for the moment job 1's record describes, and claims with both receipts and that `merge` answer.

## Scope

- `mega-s02e04/` lesson folder: log, receipts, worker briefs, results.
- Job-1 and job-2 MCP links and their skills (resource on the link, or the zip folder).
- One local worker (a subagent or a `claude -p` run on this machine).
- One remote worker in a place the human picks and provides.

## Out of scope

- The main agent doing either job itself (calling a job's tools, transcribing the clip).
- S02E05 (`mega-s02e05/`, another Challenge in progress).
- Changing tool-home or other earlier servers.

## Acceptance

- [x] Human chose which job runs elsewhere and provided that place.
- [x] Each worker got only its own job link, and the skill for that job.
- [x] Job running locally: worker ran on this machine; its submit accepted and returned a result and a receipt.
- [x] Job running elsewhere: worker ran off this machine; its submit accepted and returned a result and a receipt.
- [x] Main agent never called a job tool itself (check log.txt).
- [x] `merge` = job 2's note for the moment in job 1's record, checked against both results.
- [x] Every outside action (repo, push, CI run, cloud session, link given away) had the user's yes first.
- [x] Tickets, job links and tokens are masked in `log.txt`; the raw ones are only in `receipts.json`.
- [x] claim-challenge accepts both receipts and the merge (after claim)

## Notes

- Job links are keys: keep each one only with the worker it goes to (start-challenge `jobLinks`).
- Merge: job 1 time is US Eastern (EDT on 31 Oct, US DST ends 1 Nov); clip says desk time is central European (CET since 25 Oct). 22:50 EDT = 03:50 CET -> note @0:57. Source: log.txt merge line.
- Cloud session first failed: repo patmat94/mega-course was private and the cloud had no access; human made it public. Cloud sessions send no result back; human pasted it.
