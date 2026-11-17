# 0016 One skill source for every harness, and a config stamp per session

**Status:** accepted

## Context

AGENTS.md already said `.agents/skills/` is the one source for skills. In practice only recall, split-plan and triage lived there and were linked into `.claude/skills/`. The other 11 skills (ask, bet, challenge-close, challenge-start, crew, hands, netlify-upload, prove, read, rook-clock, rook-search) were real folders in `.claude/skills/`. Pi, which ran the S04E01 agent, loads only `.agents/skills/` in this repo, so it saw 5 of 16 skills.

There was also no record of which instructions a session ran under, so a past solve could not be matched to its AGENTS.md and KEEP.md.

The S04E02 lesson (Software Factory, Build the workspace) asks for both: define once with an adapter per harness, and record the config version with every run.

## Decision

1. Every skill lives in `.agents/skills/<name>/`. `.claude/skills/` holds only Windows junctions to those folders and is git-ignored as a whole, because Git follows a junction and would commit a second copy. New skills, including Challenge artifacts, go into `.agents/skills/` first and then get a junction.
2. A SessionStart hook, `.claude/hooks/config-stamp.mjs`, appends one JSON line to `runs.jsonl` at the repo root. The line holds session id, UTC time, start source, harness, git HEAD, a dirty flag (which ignores runs.jsonl itself) and `config`, the sha256 of the raw bytes of AGENTS.md followed by those of KEEP.md. The hook prints nothing and never blocks a session. `runs.jsonl` is tracked in git.

## Checks (2026-11-17)

- Before the move, Pi in RPC mode (`get_commands`, no prompt sent) listed 5 project skills. After the move it listed all 16, each from `.agents/skills/`.
- The skill self-tests (hands, bet, rook-clock ×3, read cut-diff, prove build-id) exit 0 when run through the `.claude/skills/...` junction paths.
- `node --test ".claude/hooks/test/*.test.mjs"`: 4 of 4 pass.

## Consequences

- Pi, Claude Code and any harness that reads `.agents/skills/` load the same skill files.
- On a new machine the junctions must be made again, because they are not in git: `mklink /J .claude\skills\<name> .agents\skills\<name>` for each folder in `.agents/skills/`.
- Only Claude Code sessions write `runs.jsonl`. A Pi run has no stamp until Pi gets an adapter, for example an extension that runs the same script.
- `runs.jsonl` gains a line with every session start, including resumes and compactions.
