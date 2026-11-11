# S03E02 · nothing ships unmarked · what becomes true

## Outcome

sched-prod's tracker (`mega-s03e02/sched-prod/sched-prod/doc/issues/`, Markdown) holds every request from the backlog and the three channels (desk, chat, mail). Every request is in the `sources` of exactly one issue that is open, done or closed. Every open issue is either `agent-ready` (a brief with Intent, Acceptance, Boundaries and the AUT-1 line it is allowed by) or `needs-human` (Question, two or more Options, a Recommendation and a Why that cites an id). The course accepts the tracker and the text of our own `triage` skill in one claim.

**Who it is for / how we'd know it helped:** sched-prod's people and its agents. An agent can take any `agent-ready` issue without asking, and a person can answer any `needs-human` issue from its text alone. Measured by a check script in the lesson folder: 0 open issues without exactly one mark, 0 requests (IN-…) missing from every `sources`, 0 requests in two issues, 0 closed or needs-human issues without a cited id (SCHED-…, IN-…, AUT-/DES-/PRD-/ADR-). The limits are mine; the human can change them.

## Scope

- The kit in `mega-s03e02/sched-prod/sched-prod/` (collectors, specs, `doc/issues/`).
- The Challenge API, with the session from `receipts.json`.
- A new skill `triage` in `.agents/skills/triage/` (shared skills folder), wired as check-lane `skill-wiring` says.

## Out of scope

- GitHub Issues (`gh` is blocked on this PC; the Markdown tracker is the kind we hand in).
- Calling `start-challenge` again (it deals a new round).
- Building or shipping the work in the issues.

**Boundaries:** No repo, issue or push outside this folder without the human's yes. Never change specs/.

**Fails if:** a request is missing or doubled, an open issue lacks a mark or carries both, an agent-ready issue covers something AUT-2 names (client reliance, pricing/invoices/terms, deleting stored data), or the channels got new requests after the last collector run.

## Acceptance

- [x] Collectors run (backlog + desk + chat + mail) and run again right before the claim with 0 new issues.
- [x] Every request id from every channel appears in the `sources` of exactly one issue (check script).
- [x] Every open issue has exactly one of `agent-ready` / `needs-human`; status is open/done/closed; closed ones have a valid `reason`; duplicates have `duplicate-of`.
- [x] Every agent-ready body has Intent, Acceptance (Given/When/Then or checks, with at least one "must not" case), Boundaries, and "Allowed by AUT-1…"; nothing in it falls under AUT-2.
- [x] Every needs-human body has Question, ≥2 Options, Recommendation, Why with a cited id.
- [x] Every closed issue cites the spec id, issue key or request id that decided it.
- [x] Backlog issues checked against the specs too (contradicts-spec, obsolete, done).
- [x] The `triage` skill exists where check-lane `skill-wiring` says, and the tracker was made with it; its text is sent as written.
- [x] Claim body is under 256 KB and holds session, tracker {kind: md, files with full text}, skill {name, path, text}.
- [x] Every outside action (repo, issue, push, message) had the user's yes first.
- [x] After each accepted step, the signed-in Challenge page was re-read and its answers applied.
- [x] Tickets and tokens are masked in `log.txt`; the raw ones are only in `receipts.json`.
- [x] Collectors polled again after every claim reply; a withdrawal (IN-3244) closes the withdrawn issue.
- [x] claim-challenge returns solved (after claim)

## Notes

- Tracker kind: Markdown, because the gh sink and the gh hand-in command need the gh CLI, which is blocked here; a browser sign-in to GitHub does not help (README § Fill the tracker, § On GitHub).
- Requests "keep arriving" (list-challenges description); the channel cursors live in `.sched/`. Re-run collectors before the claim.

- Requests arrived in batches on later collector polls (10, then 8, 2, 1); a fresh API read without a cursor shows only the first batch. Polled until 4 runs in a row gave 0 new (mega-s03e02/log.txt).
- IN-9868 (client relies on midnight-to-midnight all-day events) turned IN-3975 from agent-ready into needs-human; IN-4945 held two problems and was split (TRI-1).
- Who-it-helped check: check-tracker.mjs PASS, 0 problems (21 requests, 39 issues: 21 agent-ready, 4 needs-human, 6 done, 8 closed).

- Claim 1 refused: '1 intent not accounted for · 1 issue open that should not be'. A new mail IN-3244 arrived after it, withdrawing IN-2952; IN-2952 closed obsolete, IN-3244 closed duplicate-of IN-2952.
