# Feature map: live Workers

One file per Worker that is deployed and still running. Each file has four sections:

- **Role**: what the Worker is for and who calls it.
- **How to get there**: its URL, its source folder, its config and where its secrets live (never the secrets).
- **How to verify**: steps that run against the live Worker, cheapest first. Each says what it sends and what a pass looks like. The first step of each file sends nothing that changes state.
- **Keep in mind**: findings about this Worker, in KEEP.md's line shape (`- <finding> · source: <file>:<where> · how: ran | read | told`). They were moved here from KEEP.md; their receipts moved with them.

A step marked "last run" was run for real on that date, with its output under Keep in mind.

## Mapped

| Worker | File |
|---|---|
| tool-home | [tool-home.md](tool-home.md) |
| wake-demo | [wake-demo.md](wake-demo.md) |

## Not mapped yet

Named as still running in the Lessons table of CLAUDE.md: rig-pulse (S01E05), mail-agent (S02E02), away-agent (S02E05), night-status (S03E01). mcp-fun (weather-fun) is deployed too (KEEP.md). Their findings stay in KEEP.md until each gets a file here.
