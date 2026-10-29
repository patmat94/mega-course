# Issue split — plan morning-digest (draft, awaiting user approval)

Source: repo/plan.md, following skill plan-to-issues (steps 1–4). Order = creation order, so "Blocked by" cites real numbers (expected #1–#8 in the new repo).

| # | Title | Plan § | Scope | Done when | Blocked by |
|---|-------|--------|-------|-----------|------------|
| 1 | Digest types: `DigestRow` and `readNight` signature | 1 | `src/digest/types.ts` only, committed first so § 2 work can start | file on main; `pnpm typecheck` passes | — |
| 2 | Run log reader | 1 | `readNight(runsDir, night)` in `src/digest/`; bad lines counted, never thrown; `owner: null` kept, shown as `—` | reader tests pass on `runs/2026-10-28.jsonl` (5 jobs, 1 bad line) | #1 |
| 3 | Digest page: `GET /digest/:night` | 2a | one table, sorted by job, retries ≥ 3 and any `fail` marked; 404 for no file; empty file → "nothing ran" | `/digest/2026-10-28` renders locally | #1 (start), #2 (done) |
| 4 | Digest JSON: `GET /api/digest/:night` | 2b | same rows as the page, same order | JSON for 2026-10-28 has the same jobs in the same order as the page | #1 (start), #2 (done) |
| 5 | Board link to each night's digest | 2c | status board links every night on disk to its digest, with ok / retry / fail counts | both nights on disk link to a digest that renders | #1 (start), #3 (done) |
| 6 | Route tests for digest page and JSON | 2d | 200, 404, empty night, bad line; temp runs dir, `runs/` read-only | `pnpm test` green with the new tests | #1 (start), #3 #4 (done) |
| 7 | Preview for review | 3 | save `/digest/2026-10-28` as one HTML file by command, lane banner + marker; upload to user's public host; send reviewer the link and issue list | preview link sent to the reviewer | #3 |
| 8 | Clean up: take the lane marker off the preview | 4 | re-save with `LANE_MARKER` unset ("no marker set"), upload over the same link; move plan to `docs/plans/done/` with its issue list | preview link no longer shows the lane marker | #7, review in |

## What every issue carries (proposed)

- Body opens with `Source: plan.md § <n>` (course requirement; `<n>` = 1, 2a, 2b, 2c, 2d, 3, 4 as headed in the plan).
- Label `plan:morning-digest` (course requirement).
- Then, per ADR 0002: Scope, Done when, Blocked by (as `#n`).
- Closing comment per AGENTS.md: `done:` / `worker: <harness> · <model> · <effort>` / `commit:`.
