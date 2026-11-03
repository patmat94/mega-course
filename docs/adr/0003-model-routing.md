# 0003 · Which model and effort a worker runs at

## Decision

A worker (AGENTS.md step 4) or a subagent picks its model and effort from this table. Its closing comment's `worker:` line shows what it actually ran at.

| Task | Model | Effort | Basis |
|---|---|---|---|
| Logic: solve steps, request bodies, hooks, plans, reviewing a split | `claude-opus-5-5` | high | AGENTS.md step 4: "the strongest for logic". The effort has not been tried yet. |
| Views, copy, tests | `claude-sonnet-5-5` | medium | AGENTS.md step 4: "a cheaper one for views, copy and tests". Not tried yet. |
| Sweep across lessons (rook-search and similar) | `claude-opus-5-5` | high | effort-trials.md, 2026-10-29: 11% more tokens than low, a cleaner count, and 3 threads across lessons against 1. |
| Quick "is there anything new?" check before a deeper run | `claude-opus-5-5` | low | effort-trials.md, 2026-10-29: "Low is enough for a quick check". |

A row marked "not tried yet" is a starting point, not a measurement. When a trial runs, it gets its own section in `effort-trials.md`, and the row changes to match. A task that no row covers uses the first row, and the closing comment says it had no row.

## Why

Until now the rule was one sentence in AGENTS.md, and each session chose from memory. The S02E02 lesson (Building an Agent) says to route easy tasks to a smaller, cheaper model or a lower effort, using a rule written in code or config rather than decided each time.

## Decided by

The human, 2026-11-03, from the S02E02 brief's "Try today".
