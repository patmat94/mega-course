# The team

Four roles for your Host Desk, each in its own folder: `critic`, `worker` and `integrator` run as they are; `planner` is yours to write with your harness (its `ROLE.md` has the headings, nothing under them yet). Each folder: `ROLE.md` (what the role does, its system prompt), `run.mjs` (starts it), its tools in `extensions/`, its scripts in `scripts/`. You and your harness may change anything here, code included.

## Set it up

1. Your Host Desk in git: in the Host Desk's top folder, `git init`, then commit once (`git add -A && git commit -m start`), if it is not a repo yet. `.gitignore` keeps `vars.json` out.
2. In each `ROLE.md`, replace `<CHALLENGE_URL>` with the `challenge` URL from start-challenge.
3. In `vars.json` at the top of the Host Desk, put the ticket from start-challenge as `TICKET`, fetch the manual once, and put the attempt from its reply as `ATTEMPT`. Every role uses that one attempt, so the whole team shares one board. A role that fetches the manual itself starts a new attempt with an empty board.
4. One git worktree per job, beside the Host Desk: from its top folder, `git worktree add ../host-desk-<job id>`, then copy `vars.json` into the new folder (git leaves it out). Run each job's role from its own worktree (the job that merges may run in the Host Desk itself), so a job's `git diff` holds its own changes and no other job's.
5. Each role's `hosts.json` (in its folder) lists the hosts each secret may reach from that role: the attempt goes to hq.mega.dev only, on every redirect too, and no other secret leaves. If your course runs on another host, change them to that host.

## Run a role

```
MODEL=openrouter/<model id> node roles/<role>/run.mjs "<what to do>"
```

On Windows PowerShell: `$env:MODEL = "openrouter/<model id>"; node roles/<role>/run.mjs "<what to do>"`. Examples: `node roles/critic/run.mjs "Request r2"`, `node roles/worker/run.mjs "Job w-1"`. The last line it prints is the model it ran on (`model: …`). A job's `model` in the plan is the `MODEL` you start that job's role with.

## Run a team in another harness

One line per harness. Run each role in its own folder (`roles/<role>/`), with stdin closed (`< /dev/null`).

- **Pi (recommended):** `node run.mjs "<what to do>"` per role, in its job's worktree, one [Herdr](https://herdr.dev) pane per role or job, so you watch them work side by side. Its model: the `model:` line at the end (Pi's `--mode json` output, `responseModel`).
- **Claude Code:** `claude -p --system-prompt-file ROLE.md --no-session-persistence "<what to do>"` per role, or subagents; each job in its own git worktree (`claude --worktree <name>` or `git worktree add`). Its model: `--output-format json`, the `modelUsage` keys.
- **Codex:** `codex exec --ephemeral -c model_instructions_file="ROLE.md" "<what to do>"` per role, in a git worktree per job. Its model: the `model:` line `codex exec` prints at the start.

In Claude Code and Codex a role uses that harness's own tools, not the ones in `extensions/`.
