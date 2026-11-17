# reviewer

A second role for your Host Desk: it judges a change and sends its findings. `ROLE.md` is what it does (its system prompt), `run.mjs` starts it, its two tools (`vars`, `http`) are in `extensions/`. The `code` tool and `scripts/` that came with it were removed: nothing ran there once the house notes moved into the start bundle. You and your harness may change anything here, code included.

## Set it up

1. In `ROLE.md`, replace `<CHALLENGE_URL>` with the `challenge` URL from start-challenge.
2. In `vars.json` at the top of the Host Desk, put the ticket from start-challenge as `TICKET` and the attempt from the manual as `ATTEMPT`.
3. `hosts.json` in this folder lists the hosts each secret may reach from this role: the attempt goes to hq.mega.dev only, on every redirect too, and no other secret leaves. If your course runs on another host, change it to that host.

## Run it

```
MODEL=openrouter/<model id> node roles/reviewer/run.mjs
```

On Windows PowerShell: `$env:MODEL = "openrouter/<model id>"; node roles/reviewer/run.mjs`.

## Run this role in another harness

`run.mjs` starts it through rook-plane (`../plane-start.mjs`): plane's `startup.mjs` reads `reads.json` (the house notes in `why/`) into a start bundle, which becomes Pi's system prompt; Pi keeps only the two tools in `extensions/`.

For Claude Code or Codex, use plane's own launcher from the Host Desk folder (`.agents/skills/rook-plane/skills/run-anywhere/SKILL.md`):

    node <repo>/.agents/skills/rook-plane/scripts/launch.mjs roles/reviewer --harness claude --hosts roles/reviewer/hosts.json --dry-run

There the role gets that harness's own tools, not the two in `extensions/`, so read-only holds only in words.
