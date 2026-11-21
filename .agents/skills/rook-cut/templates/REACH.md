# Reach list

Written by `reach.mjs` from `.reach/jobs.jsonl`. Do not edit by hand: change the list with `reach.mjs add`, `seen`, or a stop through `cut.mjs`.

| id | owner | state | stop | start again | since | note |
|---|---|---|---|---|---|---|
| sync-worker | writer (yours) | running | pid:4120 | `node workers/sync.mjs` | 2026-01-05T09:12:00Z | my human: sync-worker is the writer's |
| report-job | checker (yours) | running | task:ReportJob | | 2026-01-05T09:14:00Z | |
| 7731 | none | found | pid:7731 | | 2026-01-05T10:02:00Z | takes items on the queue's worker list; nobody here started it |

Stop one: `node ".claude/skills/rook-cut/scripts/cut.mjs" --job <id>`, first with `--dry-run`. Run it from the project's folder.

Your roles: checker, writer. A job is yours only when it was added (not seen) and its owner is one of them, both now and when its line was written.
