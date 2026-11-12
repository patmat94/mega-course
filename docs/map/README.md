# Feature map: live Workers

One file per Worker that is deployed and still running. Each file has four sections:

- **Role**: what the Worker is for and who calls it.
- **How to get there**: its URL, its source folder, its config and where its secrets live (never the secrets).
- **How to verify**: steps that run against the live Worker, cheapest first. Each says what it sends and what a pass looks like. The first step of each file sends nothing that changes state.
- **Keep in mind**: findings about this Worker, in KEEP.md's line shape (`- <finding> · source: <file>:<where> · how: ran | read | told`). They were moved here from KEEP.md; their receipts moved with them.

A step marked "last run" was run for real on that date, with its output under Keep in mind.

## Mapped

| Worker | Built in | Sign-in or signature | Spends money | File |
|---|---|---|---|---|
| rig-pulse | S01E05 | Standard Webhooks signature | Anthropic API per ping | [rig-pulse.md](rig-pulse.md) |
| mail-agent | S02E02 | Svix signature | Anthropic API per trusted mail, no cap | [mail-agent.md](mail-agent.md) |
| tool-home | S02E03 | OAuth, owner passphrase | Workers AI on transcribe | [tool-home.md](tool-home.md) |
| away-agent | S02E05 | HMAC signature; admin token; owner's code for gated acts | no | [away-agent.md](away-agent.md) |
| night-status | S03E01 | none (public page) | no | [night-status.md](night-status.md) |
| sched-prod-api | S03E03 | none (public reads) | no | [sched-prod-api.md](sched-prod-api.md) |
| wake-demo | lib/wake | HMAC signature; admin token | no | [wake-demo.md](wake-demo.md) |
| mcp-fun | practice | none (public) | no | [mcp-fun.md](mcp-fun.md) |

All seven passed How to verify step 1 on 2026-11-12.

A new Worker gets its file here when it is deployed; a Worker that is deleted keeps its file with a line at the top saying when.
