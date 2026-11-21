# Make a role with your factory

`make-a-role` is the part of your factory that makes a new role from the owner's one line. `SKILL.md` says how to use it; any harness can follow it. It writes `roles/<role>/` from `template/`. You and your harness may change anything here, code included.

| Path | What it is |
|---|---|
| `SKILL.md` | The steps: write the job's rule, run `make.mjs`, run the new role, fix the factory when it falls short. |
| `make.mjs` | Writes `roles/<role>/`: `ROLE.md`, `run.mjs`, `extensions/`, `hosts.json`, `reads.json`, `role.json`, `scripts/`. Plain Node, no install. |
| `template/` | The parts every new role shares: the host-bound tools, the start through rook-plane, the task runner (`scripts/tasks.mjs`), the parked-task finisher (`scripts/finish.mjs`), `scripts/wire.mjs`. They hold the house rules of `../CHECKLIST.md` in code. |
| `jobs/<role>.mjs` | One role's rule for one task, with its test. The only part that differs between roles. |

## Make it

From the top of your Host Desk:

```
node factory/make-a-role/make.mjs <role> "<the owner's line>" --api <the api URL from start-challenge>
```

`state/` inside a role survives a remake; the rest is made again.

## Run the made role

Run the made role in a fresh session, from the top of the Host Desk, with the manual of this attempt saved in `state/manual.json` and `ATTEMPT` in `vars.json`:

- Pi: `MODEL=anthropic/<model id> node roles/<role>/run.mjs practice`, then `… run.mjs run` (on Windows PowerShell: `$env:MODEL = "anthropic/<model id>"; node roles/<role>/run.mjs practice`).

`run.mjs` starts the role through the rook-plane start bundle (`roles/plane-start.mjs`), so it reads the house notes and the course API at every start.
