# 0022 · Suites run after every commit that touches them; the reviewer is judged by sealed Cases outside the repo

**Status:** accepted

## Decision

1. `core.hooksPath` is `.githooks`. Its `post-commit` and `post-merge` run `.githooks/run-suites.mjs`. That script runs each test suite (wake, hooks, reviewer, heartbeat) whose folder the commit or merge touched. When a suite fails or could not run (no node, no test files, no summary, a timeout), it prints a loud `!!` block. It never blocks: the commit is already made, and the block says it is not verified. Each run appends one line to `.git/suite-runs.jsonl`. A new clone needs `git config core.hooksPath .githooks` once.
2. Every child the runner starts gets the environment without `GIT_*` variables.
3. The Host Desk reviewer's first Judge is `agents/judge/judge-reviewer.mjs`. Its Cases are sealed in `~/mega-sealed/reviewer` (outside the repo), with a sha256 per case in `MANIFEST.json`. `.claude/settings.json` denies Read, Edit and Write there. A Trial copies the reviewer (role, `plane-start.mjs`, `why/`) as one hashed Revision into a temp desk. It serves the case from a stub on 127.0.0.1 and runs the role's own `run.mjs`. It grades the first review the course would have taken and prints one bare line per case.
4. The sealed Cases run from the hook only with `git config hooks.judge true`, because each case starts a model on the human's key. Without it, the hook says the Cases were skipped.

The human asked for the hook and the Judge on 2026-11-21, from the Factory Grow the Team brief.

## Why

Verification happened in a later session, so defects showed up there. A hook moves it to the commit. The reviewer was refused in S04E02 for a pinned 15 % commission (`mega-s04e02/log.txt:24-27`). A Case kept outside the agent's reach catches that regression, and the agent cannot edit the Case to make it pass.

Rule 2 comes from the first end-to-end test of the hook, in a worktree. Git hands a hook `GIT_DIR` and `GIT_INDEX_FILE`. `config-stamp.test.mjs` runs `git init` and `git commit` in a temp folder, and that inherited environment pointed both at this repo. It set `core.bare = true` in `.git/config` and committed an orphan "init" onto the test worktree's HEAD. main was not touched. `core.bare` was set back by hand.

## Limits

- The deny rule covers Claude Code's file tools, not a shell `cat`. The seal hash catches an edit, not a read.
- Case 3's patch was rebuilt from the run's report, because that attempt's patch body was not saved. Case 2 is a variant of case 1, and its verdict follows the course rule rather than a course reply. Each `case.json` says where it came from.
