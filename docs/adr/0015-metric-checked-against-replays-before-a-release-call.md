# 0015 · A release metric counts only after a replay or a call has been checked against the event log

**Status:** accepted

## Decision

1. Before a success metric decides a release call (expand, revise, simplify, revert, investigate, stop), take at least one replay or call where the measured action happens and check it against the event log. Confirm that every way to do that action, in every tool the operator opens, has a row in the log. When one way leaves no row, the metric is not evidence, and the call is investigate or hold until it is logged.
2. Scan replays frame by frame: a canvas diff every 0.1 s at 160x90 or finer, one video per call, then read each change word for word (ids, numbers, the second, the region). Frames taken seconds apart miss a tab that is on screen for 1.4 s.
3. A generated summary is not evidence. Recount the metric and the guardrails from the raw rows, as the release record defines them, and check the record's own claims (release gate, guardrail) against their raw signal (CI run, page, feed).
4. Who decides comes from the release record: a broken guardrail is a bug the agent settles (fix or roll back), and product direction goes to the owner as numbered options with effort and a recommendation.

The rule lives in AGENTS.md under Principles.

## Why

In S03E05 both summaries called every release a win. In batch 1, suggestions v2 showed 2.35 vs 2.68 restarts per bad night, but in replays 02 and 03 the operator restarted the worker in a sched-admin tab and the event log had no row for either restart (`mega-s03e05/log.txt:122`). In batch 2, auto-close cut open incidents by 24%, but in replays 06 and 08 the operator reopened the work as a sched-desk ticket right after the auto-close (`mega-s03e05/log.txt:149`). This rule was kept in claim 1 and caught auto-close in claim 2 the first time.

Claim 1 was refused twice. The first try had no release gate group: the record said "Passed on ci-2159", and ci-2159 shows "diff: none". The second try quoted the admin tab from frames taken seconds apart. The 0.1 s scan fixed it.

## Decided by

The human, 2026-11-15 (asked for the ADR after the S03E05 debrief).
