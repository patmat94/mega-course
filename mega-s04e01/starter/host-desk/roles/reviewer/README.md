# reviewer

A second role for your Host Desk: it judges a change and sends its findings. `ROLE.md` is what it does (its system prompt), `run.mjs` starts it, its tools are in `extensions/`, its scripts in `scripts/`. You and your harness may change anything here, code included.

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

Each line starts it with fresh context and `ROLE.md` as the system prompt. Run it in `roles/reviewer/`, with stdin closed (`< /dev/null`).

- Pi: `pi -p --no-session -ne --system-prompt ROLE.md "Start."` (what `run.mjs` does, with the three tools)
- Claude Code: `claude -p --system-prompt-file ROLE.md --no-session-persistence "Start."`
- Codex: `codex exec --ephemeral -c model_instructions_file="ROLE.md" "Start."`

In Claude Code and Codex the role uses that harness's own tools, not the three in `extensions/`.
