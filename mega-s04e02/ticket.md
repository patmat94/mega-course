# S04E02 · Looks good to me · what becomes true

## Outcome

The Host Desk (from S04E01, `mega-s04e01/starter/host-desk`) has a second role: a reviewer that checks a co-host's patch hunk by hunk. The given reviewer is run as it is first and its findings sent; then it is improved until its verdict is right for every hunk of one patch. Separately, today's payout batch passes. The two need not share an attempt.

**Who it is for / how we'd know it helped:** the host (and the human as owner): every hunk of the co-host's patch gets a verdict that matches the course's (all hunks right), and the payout batch runs with no secret leaving its own host and inside the time limit, as in S04E01. Limits set by the harness; the human may change them.

## Scope

- Reviewer zip (`roles/reviewer/`, `why/`) placed in the S04E01 Host Desk, after the human's yes to the download.
- Host Desk vars: `TICKET` (from start-challenge), `ATTEMPT` (from the manual).
- The course API at https://hq.mega.dev/challenges/looks-good-to-me/api: manual, settings, patch, review.
- The roles run on the human's Anthropic key from S04E01 (Pi).

## Out of scope

- The day-2 zip (only if the human picks it instead).
- Applying the co-host's patch to the real Host Desk without the owner's decision.

**Boundaries:** no download, install or spend without the human's yes; secrets bound to their hosts on every redirect hop (S04E01 wire.mjs); keys never in a commit or in log.txt.

**Fails if:** a hunk's verdict is wrong; the first findings sent came from an already-changed reviewer; the batch leaks a key or runs out of time.

## Acceptance

- [x] The given reviewer was run unchanged first, and its findings were sent. · evidence: log.txt:20, log.txt:27, reviewer-ROLE.given.md
- [x] The reviewer's verdict is right for every hunk of one patch (course reply says so). · evidence: log.txt:33
- [x] One payout batch passes (course reply says so): 18 paid, #5 and #9 declined by the owner and finished. · evidence: log.txt:40, log.txt:47
- [x] The manual was read before any send, and each body matches its shape and field types (answer and amount as JSON numbers). · evidence: log.txt:17, log.txt:19, log.txt:38
- [x] Each receipt was written to a file on arrival. · evidence: course.jsonl, manual.jsonl
- [x] Every outside action (download, install, spend) had the user's yes first. · evidence: log.txt:14
- [x] Tickets and tokens are masked in `log.txt`; the raw ones are only in `receipts.json`. · evidence: receipts.json
- [ ] claim-challenge returns solved (after claim)

## Notes

- Expected next lesson per CLAUDE.md table: S04E02, matches (2026-11-17).
- The given reviewer failed because ROLE.md pinned settings (15 %) that change per attempt (live 10 %); it also could not read why/. Fixed by live GET /settings + scripts/house-notes.mjs (log.txt:27-30).
- Each review counts once per attempt; a second POST reads back {already:true} (log.txt:17).
- Who-it-is-for check: every hunk right on review 2; batch paid 18/20, no key left pay-s04.mega.dev (verify-s04 and a cdn-s04 redirect refused), the two odd tasks went to the owner. Holds.
- After the solve, the recheck-sources hook reported a new hash for the Challenge page (ee2938de3b7bada1). Fetched unsigned, it is the MEGA sign-in page, as in S04E01 (KEEP.md); the built-in browser is not signed in either. The solve is accepted, so nothing to update.
- Open: batch.mjs logs the manual reply before it knows the attempt, so state/*.jsonl holds the raw attempt (git-ignored folder; attempts expire the same day).
