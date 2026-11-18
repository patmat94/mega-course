# 0020 · Before a team runs: one real post through each role's script runner, and run logs out of git

**Status:** accepted

## Decision

Before a team of agent roles starts its jobs (planner, workers, integrator, any role that runs scripts and posts results):

1. Send one real post through each role's own script runner (the tool the role uses to run its scripts, e.g. the Host Desk's `code` tool), and check that it reaches the course. A runner may pass its scripts only part of the environment, so a post that works from the harness's shell can still fail inside the role. Put whatever the runner drops but the post needs (a CA setting, a proxy) into the place the runner does pass on (in the Host Desk, the git-ignored `vars.json`), never into a file a job's plan owns.
2. Git-ignore everything a run writes before the first job starts and before the first merge: batch logs, state files, role start bundles, run lines (in the Host Desk: `state/*-*.jsonl`, `state/last-*.json`, `state/manual.json`, `roles/*/.start/`, `roles/*/runs.jsonl`), and untrack the ones git already tracks. A job's change is the git diff of its worktree, so any untracked or changed file there counts as that job's change, and a file outside its plan breaks the plan's file ownership.

The rule lives in AGENTS.md under Principles.

## Why

In S04E03 all three workers wrote their planned files, but every result post failed with `SELF_SIGNED_CERT_IN_CHAIN`. Pi's `code` tool passes scripts only a BASICS list of variables plus `vars.json`, and it drops `NODE_USE_SYSTEM_CA=1`, which this PC needs to trust its corporate CA. The harness's own fetches to the same host worked (`mega-s04e03/log.txt:29-30`). The fix was `NODE_USE_SYSTEM_CA` in each `vars.json`, after which the posts were accepted (`mega-s04e03/log.txt:33`). One test post through the runner before the team started would have found it at no cost.

In the same solve, the practice batch wrote `state/practice-*.jsonl`, and the reviewer's start wrote `roles/reviewer/.start/*.md` and a `runs.jsonl` line, all inside the Host Desk. The integrator's `post-result.mjs` sends the Host Desk's uncommitted and untracked files too, so these would have reached m-1's result as files its plan never gave it. They were git-ignored just before the plan and again just before the first merge (`mega-s04e03/log.txt:19`, `mega-s04e03/log.txt:34`), and the board read back only planned paths (`mega-s04e03/log.txt:39`). The course's debrief named both as the takeaway.

## Decided by

The human, 2026-11-18 (asked for the rule after the S04E03 debrief).
