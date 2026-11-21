# rook-cut

From rook's rig.

Two skills for a project where jobs keep running in the background, and the two scripts they run. Each job you start goes on a reach list with an id, an owner and a stop method. You stop jobs by their id, only from that list, and your own keep running.

- **reach-list** keeps the list: `reach.mjs add` when a job starts, `seen` for one found running, `list` to read it. The data is `.reach/jobs.jsonl`; `REACH.md` is written from it for people.
- **stop-the-orphans** stops the jobs you added that no role of yours owns, by id, and keeps yours: `cut.mjs --orphans`, after a `--dry-run`. A job found running (`seen`) stops only by its id, after your human says yes: `cut.mjs --job <id>`.

Not the same as `rook-clock`: `clock` runs one job inside a budget and stops it at the end; `cut` stops jobs that are already running, from the list.
Not the same as `rook-plane`: `plane` keeps the roles themselves; `cut` reads them only to know which jobs are yours.

## What is in the folder

| File | What it is |
|---|---|
| `SKILL.md` | the entry your harness loads; it points to the two skills |
| `skills/reach-list/SKILL.md` | rules for writing each job on the list when it starts |
| `skills/stop-the-orphans/SKILL.md` | rules for finding and stopping the jobs that are not yours |
| `scripts/reach.mjs` | the list: `add`, `seen`, `list` |
| `scripts/cut.mjs` | the stops: `--job`, `--orphans`, `--lane`, `--dry-run` |
| `scripts/*.selftest.mjs` | the checks behind each script's `--self-test`. Your agent does not run these files |
| `templates/REACH.md` | what the list looks like for people |
| `templates/rules/cut-on-orphan.md` | a rule for when the agent may run `--orphans`, and what stays your human's call |

You need Node.js 20 or newer. No packages, nothing downloads. The scripts run in PowerShell, Git Bash, macOS and Linux.

## Install

Install it in a folder named `rook-cut`, the skill's own name. Leave its inside as it is: `SKILL.md` points to the other files by their paths.

**Claude Code.** For every project on this machine:

    mkdir -p ~/.claude/skills && cp -R /path/to/cut ~/.claude/skills/rook-cut

Or `.claude/skills/rook-cut/` in one project. Then start a new session.

**Codex.** Copy the folder to `~/.codex/skills/rook-cut/`, or `.codex/skills/rook-cut/` in the repository. If your Codex version does not list the skill, add this line to the project's `AGENTS.md`: `When jobs run in the background, follow <path to>/rook-cut/SKILL.md.`

**Pi.** Copy the folder to `~/.pi/agent/skills/rook-cut/`, or `.pi/skills/rook-cut/` in the project.

**Any other harness.** Put the folder in the project, and the same one line in its instructions file.

**Stops that need a secret** (a `url:` stop with `{{NAME}}` in it) need `rook-clock` too. `cut.mjs` looks for its `egress.mjs` in `~/.claude/skills/rook-clock/`, `~/.codex/skills/rook-clock/`, `~/.pi/agent/skills/rook-clock/` and `~/.agents/skills/rook-clock/`, in that order; `--egress <path>` picks one of those four, and nothing else: rook-clock installed anywhere else is not used, so install it in one of them. It takes only a file at `rook-clock/scripts/egress.mjs` with `rook-clock/SKILL.md` next to it, checked before any of its code runs, and never one from inside the project (its top folder, from any subfolder, or a folder above it with `.reach`, `.git` or `.claude`) or from a network path. Without it, such a stop is refused and nothing is sent. The secret goes only to the hosts that the project's `hosts.json` lists for its name; `--dry-run` prints the name and those hosts.

## Use it

From the project's folder, with `PACK` set to the folder you installed (in PowerShell, `$env:PACK`):

    node "$PACK/scripts/reach.mjs" add sync-worker --owner writer --stop pid:4120
    node "$PACK/scripts/reach.mjs" list
    node "$PACK/scripts/cut.mjs" --orphans --dry-run
    node "$PACK/scripts/cut.mjs" --orphans
    node "$PACK/scripts/cut.mjs" --job sync-worker --dry-run

Your roles are the folders in `roles/` (as `rook-plane` keeps them), or `--roles writer,checker`. The folders in `roles/` decide which listed jobs are kept. A job counts as yours only when its owner was one of them when `add` wrote its line (the line says so, signed): a folder made later does not make it yours, and `--orphans` asks for `--yes` before it stops that job. Without `roles/`, `--roles` is the only word on whose jobs are whose, so every stop of `--orphans` asks for `--yes`. The project's folder is its top folder: the folder you run from, or the nearest one above it with `.reach`, `.git` or `.claude` (never your home folder). A run from a subfolder uses the same list.

Keep `.reach/` and `REACH.md` out of version control: they hold process ids of this machine. `reach.mjs` writes `.reach/.gitignore` for the folder; add `REACH.md` to your `.gitignore` yourself. A secret is never written out in a `url:` stop or a `--start` line: `reach.mjs` refuses one (`token=…`, or the value of a secret your environment or `hosts.json` names). Write `{{NAME}}` in a URL and `$NAME` in a start line.

The scripts write only in the project's `.reach/` folder, `REACH.md`, and the list's key in `~/.rook-cut/key`.

Here `~` is your account's home folder, as the system knows it (your user profile), never `HOME` or `USERPROFILE`: a project can set those for every command your harness runs. A key or an `egress.mjs` whose real path is inside the project (through a link, say) is not used.

## Make your stops a wall

Each line of `.reach/jobs.jsonl` carries a MAC made with `~/.rook-cut/key`, a key outside the project that `reach.mjs` makes on first use. A line someone else wrote (a cloned repository, a planted file, a job that writes the file) has no valid MAC, and `cut.mjs` then uses nothing on the list: delete that line. The lines are one chain: each MAC also covers the line's place and the MAC before it, and `~/.rook-cut/<…>.head` keeps how many lines the list has and its last MAC. A line copied again, moved or deleted, or a list cut short or deleted, is refused whole: `the reach list was changed outside reach.mjs; nothing stopped`. So a stop already done is never sent again by a copied line. To start a new list, your human deletes `.reach/` and the `.head` file the message names. A pid line also holds when that process started, so a pid the system gave to another process later is never stopped.

That proves `reach.mjs` wrote a line on this computer, not who ran it. `--yes` and the stop of a found job are your human's word, and the agent can type them too. The wall is your harness: it asks you before each of those commands, and refuses the agent's edits to `.reach/`, `REACH.md`, `hosts.json`, `roles/`, the key and the pack's folder. Those are your files: your human changes these; the agent proposes.

**Claude Code.** In the project's `.claude/settings.json` (change the last rule to the folder where you installed the pack):

    {
      "permissions": {
        "ask": [
          "Bash(*cut.mjs*--yes*)",
          "Bash(*cut.mjs*--job*)",
          "Bash(*cut.mjs*--hosts*)",
          "Bash(*cut.mjs*--vars*)"
        ],
        "deny": [
          "Edit(**/.reach/**)",
          "Edit(**/REACH.md)",
          "Edit(**/hosts.json)",
          "Edit(**/roles/**)",
          "Read(~/.rook-cut/**)",
          "Edit(~/.rook-cut/**)",
          "Edit(~/.claude/skills/rook-cut/**)"
        ]
      }
    }

A rule matches a command as it is written, so keep other shell commands on "ask": a script the agent writes can still edit a file.

**Codex.** Keep `approval_policy = "untrusted"`, and say no to a `--yes`, `--job`, `--hosts` or `--vars` you did not ask for (`--hosts` names where a secret may go, `--vars` where its value comes from), and to any command that writes in `.reach/`, `REACH.md`, `hosts.json`, `roles/` or `~/.rook-cut/`. **Pi** asks nothing before a command: run it where those files are read-only to it.

## Scheduled jobs outside Windows

`task:` stops a Windows Task Scheduler task: `schtasks /End`, then `/Change /DISABLE`. On other systems the script does not edit the scheduler; stop the job by hand and record it:

- **cron**: `crontab -e`, comment out the line.
- **launchd**: `launchctl bootout gui/$(id -u)/<label>`.
- **systemd**: `systemctl --user disable --now <unit>`.

## Exit codes

| Script | 0 | 1 | 2 |
|---|---|---|---|
| `reach.mjs` | done | refused (a file of `.reach/` is a link, or not the project's) | a usage error |
| `cut.mjs` | every job it stopped is quiet, or a dry run | a stop was refused or failed, or a job still runs: `still running: …`; a list line with no valid MAC | a usage error, an id not on the list, `--lane` (or an `--orphans` that keeps none of your jobs, stops a job of a role in `roles/` that `--roles` leaves out or whose owner became a role after its line, or runs with no `roles/`) with no `--yes` |

## Check that it works

1. **It loads.** In a new session, ask: "Which skills can you use?" `rook-cut` should be in the answer.
2. **The scripts.** Each has a self-test that uses no network: it starts its own `node` child processes as stand-in jobs, an HTTP server on `127.0.0.1`, and a stand-in `schtasks` on a PATH of its own. It stops only what it started and leaves no file behind:

       node "$PACK/scripts/reach.mjs" --self-test
       node "$PACK/scripts/cut.mjs" --self-test

   Each prints `self-test ok`.
3. **A refusal.** `node "$PACK/scripts/cut.mjs" --job not-on-the-list` prints `not on the list: not-on-the-list` and stops nothing.

## Known limits

- **The project's environment is part of the wall.** A project that sets `NODE_OPTIONS` or `PATH` for your harness (in `.claude/settings.json` `env`, or `.envrc`) runs its own code as `node`, and none of these checks then hold. Review a project's `env` settings before you trust it.
- **The key is yours, and so is every program you run.** The MAC stops a line planted in a file. A program that runs as your user can read `~/.rook-cut/key` and write a line that checks out. Deleting the key makes every list refused until you delete its lines.
- **A pid line needs a running process.** `add` and `seen` read when the pid started (Windows: `Win32_Process` through the System32 PowerShell; Linux: `/proc` and the boot id; macOS and others: `/bin/ps`, to the second) and refuse a pid that does not run. `cut.mjs` refuses a pid whose start time differs or cannot be read: `pid <n> is another process now; not stopped`.
- **Never your harness, never a kept job.** `taskkill /T` and a process-group stop take every process below the job. `cut.mjs` reads the process list first and refuses a stop whose tree holds this script, any process above it, pids 0 to 4, or a `pid:` job on the list that this run keeps. A kept `url:` or `task:` job is not checked: if its process runs below a tree that stops, it stops too. A process that left the tree (a double fork) is neither stopped nor checked.
- **A pid can change hands in the last moment.** `cut.mjs` reads the listed pid's start time again just before `taskkill`, `SIGTERM` and `SIGKILL`, and stops nothing when it differs. Between that read and the signal (milliseconds), the system can still give the pid to another process.
- **`taskkill`, `schtasks` and `powershell`** are taken from `%SystemRoot%\System32` only, and only when `%SystemRoot%` is `<drive>:\Windows` on this computer, outside the project, and each program's real path is in it. Else that stop is refused.
- **`url:` stops** send one `POST`. Without a secret they use Node's own `fetch` and follow no redirect. With `{{NAME}}` they go through `rook-clock`'s egress, which follows a redirect (as a `GET`) to a host on its list: `cut.mjs` then reports the stop as not done, but the second request was sent.
- **A secret check is a check of forms, not a wall.** `reach.mjs` refuses `name=value` with a secret's name, and the value of a secret this computer names, as it is, percent-encoded or base64. A value in another form is written as it is.
- **One writer at a time.** `reach.mjs` and `cut.mjs` take `.reach/jobs.lock` while they add a line; `cut.mjs` holds it from before its first stop until it has marked the stopped jobs. A lock held by another run, or left behind, makes `cut.mjs` stop nothing (`the reach list is locked by another run: …; nothing stopped`), and so does a changed list: it never stops and then fails to record. If one is stopped while it writes, the list can end one line past its head, and is refused: your human starts a new list as above.
- **A found job added is your human's word, not a check.** `add` of a pid that this session did not start (below this script, its shell or the harness) needs `--note`, and the list marks it `found then added`. Nothing else stops it: `--orphans` stops it like any job you added. Read the `found then added` lines before you say yes to a stop.
- **The list is only as good as its lines.** A job nobody wrote down is not stopped: add it with `seen` first.

## Turn it off

Delete the `rook-cut` folder from your skills folder. The project's `.reach/` and `REACH.md` stay until you delete them.
