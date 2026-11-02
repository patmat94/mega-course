# S02E01 · found out late · a plan that holds, and the store it describes

## Outcome

stock-5's nightly reorder loop has one plan that holds: `plan.md`, one row per decision, each row citing the session it was decided in and when. The plan is checked in with claim-challenge (step `plan`), which returns a receipt. The user runs the store that plan describes on their own machine, and every build sent to the course carries that receipt.

## Scope

- `repo/stock-5/` (unzipped starter): `plan.md`, the store config, package.json, `scripts/verify.mjs`.
- `sessions/stock-5-sessions/` (unzipped archive): eight transcripts from two teams, read-only evidence.
- Course tools: start-challenge, claim-challenge (plan check-in, then builds), debrief.

## Out of scope

- shelf-labels sessions (Postgres 15 on 5435 with Prisma, eslint): another project.
- The 2024 ops heartbeat subagent: no decisions in it.
- Pushing the repo anywhere public: the Challenge does not ask for it.

## Acceptance

- [x] Every row of `plan.md` cites a stock-5 session id and a time (proposed or approved), in columns `Area | Choice | Source (session id + time)`.
- [x] No row rests on a compaction summary or on another project's session (checked: WAL and shelf-labels' Postgres 15/5435/Prisma are absent).
- [x] The later decision wins where two sessions disagree (job store: Postgres 16 on 5432, not the SQLite file of the draft).
- [x] The plan check-in reply carries a receipt, kept raw in `receipts.json`. (after claim)
- [x] The store runs on the user's machine (PGlite, Postgres 17.5; not Docker) and `npm run verify -- <nonce>` prints version, md5 and port 5462. The plan check-in comes before the build. (after claim)
- [x] Every build sent carries the plan check-in receipt. (after claim)
- [x] Anything installed on the user's machine had the user's yes first. (after claim)
- [x] Tickets and tokens are masked in `log.txt`; the raw ones are only in `receipts.json`.

## Notes

- The handed-over `plan-draft.md` (dated Fri 30 Oct 15:30, labelled CEST though 30 Oct is CET, so 13:30Z or 14:30Z) predates the 14:50Z switch to Postgres, so it still says SQLite.
- Claim refusals: "Your plan doesn't say which image version." and "Something changed since your check-in." Both were late archive files (c41e7b02 subagent: postgres:17 / 5462; then 5d8a1f37: database reorder_ydps). Re-read the archive list before every send. Source: log.txt. Source: plan-draft.md; codex session 019a35d2… 2026-10-30T14:48:12Z / 14:50:03Z.
- Session 7f3c2a91's compaction summary adds "(WAL)" and drops Drizzle; neither was said before the compaction. Source: 7f3c2a91 L339 vs L180/L184.
