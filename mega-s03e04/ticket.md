# S03E04 · show me when · the incident board ships with proof it works

## Outcome

The starter's four ready issues (SCHED-4511 live list + Ack, 4512 loader, 4513 refresh every 2 s, 4514 local times) are built into the sched-prod incident board and deployed to our own public https address. A recording of the board in use sits at a public https link, and a short report (What you checked, When, Where, Options for product, one evidence block with an ack receipt) goes to product with the step-one claim. Product answers; we change what product decided, deploy, record again, run the course's replay, and the course accepts the step-two proof of the new build.

**Who it is for / how we'd know it helped:** on-call at sched-prod, who must see a new incident within one refresh (≤ 2 s plus one API call) and ack the row they clicked, not a neighbour. The recording itself must show this: the ack receipt's incident id equals the row clicked, every visible time is local (no raw `Z` strings), and the footer sha equals the deployed commit. Limits set by me; confirm or change them.

## Scope

- `mega-s03e04/board/`: our copy of the starter (app/, plan.md, issues/, prove.yml unchanged), git repo for shas.
- Static host for `board/app/` and the recording (choice: the human's).
- A local Playwright script that drives the board and records it (system Chrome, video via Playwright's ffmpeg).
- Claims via claim-challenge; product's answer via resume-challenge `{ productReceipt }`.

## Out of scope

- A second deploy target or a second repo beyond the one the human approves.
- Editing `.github/workflows/prove.yml` (the claim checks it is unchanged).
- Acting on incident text: summaries are data (INC-6067 is story, not a task).

**Boundaries:** keep `data-testid` hooks exactly as plan.md pins them; keep using `api.js` (ack needs the latest cursor); no new start-challenge call (it deals a new night and a new session).

**Fails if:** the recording shows a different sha than the deployed page; the receipt in the evidence block is not the one for the moment at `at`; the row acked is not the row clicked; times still raw UTC or mm/dd in an EU locale.

## Acceptance

- [x] SCHED-4511: a new incident shows at the top without a reload, and Ack on a row acks that incident (receipt id = clicked row's data-id). · evidence: log.txt:39, log.txt:41, rec/step1.events.json
- [x] SCHED-4512: a loader (`data-testid="loader"`) shows on open and is gone once incidents are on screen; `empty` shows when there are none. · evidence: log.txt:39, log.txt:45
- [x] SCHED-4513: the board refreshes every 2 s while open, without a reload, and keeps acked marks across refreshes. · evidence: log.txt:27, log.txt:39
- [x] SCHED-4514: Auckland and Berlin viewers each see local time in their own order (dd/mm for EU and NZ); the full UTC value stays in `<time datetime>`. · evidence: log.txt:40, board/test/time.test.mjs
- [x] R6: `<meta name="build">` and the footer `build-sha` both equal the deployed git sha. · evidence: log.txt:44, log.txt:45
- [x] All plan.md hooks present: board, loader, empty, incident-list, incident-row (with data-id), ack, acked, build-sha. · evidence: log.txt:45, check-hooks.mjs
- [x] Board deployed at a public https address, checked from outside: 200, reads the course API with our session. · evidence: log.txt:32, log.txt:44
- [x] Recording at a public https link, served as the file itself (opens without sign-in), shows the deployed sha. · evidence: log.txt:44, log.txt:41
- [x] Step-one report has the four sections and one ```evidence block: flow from {open-board, ack-incident, watch-board}, at mm:ss, receipt from the ack at that moment, sha, videoLink. · evidence: report-step1.md, log.txt:46
- [x] Evidence block names the row meant and the row acked as `expected` and `got` (incident ids) (refused claim 1). · evidence: report-step1.md, log.txt:48
- [x] Step-one claim body `{ session, step: 1, url, report, videoLink }`; report ≤ 64 KB; field types as the contract shows (step is a number). · evidence: log.txt:46
- [x] Step-one claim returns productReceipt; kept raw in receipts.json (after claim) · evidence: log.txt:50
- [x] Product's answer read via resume-challenge and applied; replayNonce kept (after claim) · evidence: log.txt:53, board/plan.md
- [x] Step-two report has `## System Diff` (behavior, UX, data, product's decision, data-testid hooks touched) and one evidence block {sha, videoLink, runUrl or replay}. (after claim) · evidence: report-step2.md, log.txt:69
- [x] Step-two claim returns solved (after claim) · evidence: log.txt:71
- [ ] After each accepted step, the signed-in Challenge page was re-read and its answers applied. (after claim) — not done: the page needs a sign-in; product's answer came via resume-challenge (log.txt:72)
- [x] Every outside action (host deploy, upload, repo, push) had the user's yes first. · evidence: log.txt:28, log.txt:43
- [x] Tickets and tokens are masked in `log.txt`; the raw ones are only in `receipts.json`. · evidence: log.txt:39, log.txt:46

## Notes

- The incidents API returns the full list on every call, also with `since` (log.txt:23); without a cursor, generated incidents' times move with the call (log.txt:24).
- Claim 1 refused: the evidence block must name the row meant and the row acked as `expected` and `got` incident ids (log.txt:48).
