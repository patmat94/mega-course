# rook-clock

From rook's rig.

Three skills for a job that runs on its own, and the three scripts they run. The agent works alone inside limits that a program owns: the model cannot give itself more time or change the finish line.

- **bind-secrets** keeps each secret on its own hosts. `hosts.json` lists, for each secret, the exact hosts it may reach. `egress.mjs` fills `{{NAME}}` in only after the check, checks every redirect again, and refuses with one line: `refused: WEATHER_KEY may not go to status.example.com (hop 2; hop 1 answered 302)`.
- **run-alone** runs routine work as a script. `run-job.mjs` runs your `job.mjs` over a list of items inside a time budget and an item cap that are its own flags. It ends on `done`, `failed:<id>`, `budget_spent` or `stopped`, and says so every time.
- **park-for-owner** turns a document's rules into checks, and parks the calls that are yours, not the agent's. `parked.mjs` keeps each parked item's own copy, takes your yes or no from your terminal, and finishes each item once.

Not the same as `rook-loop`: `loop` runs a model until `./verify` passes; `clock` runs a job with no model in its routine, and the model sees only what the script parks.

## What is in the folder

| File | What it is |
|---|---|
| `SKILL.md` | the entry your harness loads; it points to the three skills |
| `skills/bind-secrets/SKILL.md` | rules for secrets and their hosts, with an example |
| `skills/run-alone/SKILL.md` | rules for a routine run, its limits and its exits, with an example |
| `skills/park-for-owner/SKILL.md` | rules for checks, parked items and finishing once, with an example |
| `scripts/egress.mjs` | the one way a secret leaves: a library (`send`) and a command |
| `scripts/run-job.mjs` | the runner |
| `scripts/parked.mjs` | `list`, `show`, `decide` (yours) and `finish` |
| `scripts/*.selftest.mjs` | the checks behind each script's `--self-test`. Your agent does not run these files |
| `templates/hosts.json` | each secret and its hosts |
| `templates/job.mjs` | a job: its checks, `handle` and `finish` |

You need Node.js 20 or newer. No packages, nothing downloads. The scripts run in PowerShell, Git Bash, macOS and Linux.

## Install

Install it in a folder named `rook-clock`, the skill's own name. Leave its inside as it is: `SKILL.md` points to the other files by their paths.

**Claude Code.** For every project on this machine:

    mkdir -p ~/.claude/skills && cp -R /path/to/clock ~/.claude/skills/rook-clock

Or `.claude/skills/rook-clock/` in one project. Then start a new session.

**Codex.** Copy the folder to `~/.codex/skills/rook-clock/`, or `.codex/skills/rook-clock/` in the repository. If your Codex version does not list the skill, add this line to the project's `AGENTS.md`: `When a job should run on its own, follow <path to>/rook-clock/SKILL.md.`

**Pi.** Copy the folder to `~/.pi/agent/skills/rook-clock/`, or `.pi/skills/rook-clock/` in the project.

**Any other harness.** Put the folder in the project, and the same one line in its instructions file.

If your version of a tool looks for skills in another folder, its docs name it. The files stay the same.

## Set up a job

From the folder where the job will live, with `PACK` set to the folder you installed (for example `PACK=~/.claude/skills/rook-clock`):

1. Copy `"$PACK/templates/hosts.json"` and `"$PACK/templates/job.mjs"` here, and fill them in: each secret's hosts, then the job's checks, `handle` and `finish`.
2. Give each secret its value as an environment variable of the same name, or in a `vars.json` here (`{ "WEATHER_KEY": "…" }`) that you pass with `--vars vars.json`. Keep `vars.json` out of version control, for example in `.gitignore`.
3. Write the items, one JSON object per line, each with an `"id"` of letters, digits, `.`, `-` or `_`, to `items.jsonl`.
4. Run it:

       node "$PACK/scripts/run-job.mjs" --job job.mjs --items items.jsonl --budget 10m --hosts hosts.json

5. Decide each parked item in your own terminal, then let the agent finish it:

       node "$PACK/scripts/parked.mjs" list
       node "$PACK/scripts/parked.mjs" decide r17 yes
       node "$PACK/scripts/parked.mjs" finish r17 --job job.mjs --hosts hosts.json --budget 5m

In PowerShell, write `$env:PACK` for `$PACK`, and set a secret for one session with `$env:WEATHER_KEY = "…"`.

The scripts write only in the job's folder: `trace.jsonl`, `left.jsonl`, `parked/` and `finished/` (`--dir` moves them).

## How a run ends

| Exit | When | Exit code |
|---|---|---|
| `done` | every item given ran | 0 |
| `failed:<id>` | that item threw, or `handle` returned neither `{ done }` nor `{ park }`; the run stops there | 1 |
| `budget_spent` | the time budget ran out, also mid-item | 3 |
| `stopped` | Ctrl-C, or a stop signal | 4 |

A refusal from `ctx.send` that `handle` does not catch is not a failure: the item is parked with the refusal line as its reason, and the run goes on. After a redirect, the reason ends `the API may have acted`: the first host got the request. Any other throw is `failed:<id>`, also after a refusal the job caught. Every refusal is traced on the item that sent it: `refused` while the item runs, with its `done` or `parked` line after it, so a refusal the job caught shows too. A send that an item left running and that was refused after the item returned is traced as `refused-after-done` for that item, and the exit line names it: `refused after done: <id>`. A send still open when the run ends is cut: the trace says `send-cut` on its item, and the exit line says `sends cut: <id> (may have acted)`.

A job never writes in `parked/` or `finished/`. When the run ends, the runner reads `parked/` again. A decision set there during the run, a file the run did not park, or a file not named exactly `<its id>.json` ends the run `failed:job`: `parked/<id>.json: decision set during the run, by code or by your human: your human decides it again after the run`. `finish` refuses that decision, and any decision recorded while a run was going (each run's window is in `trace.jsonl`). It also refuses a decision not later than the newest run's last line, and every decision while the newest run has no exit line (`a run is going, or was killed before it read parked/: ask your human`), while `trace.jsonl` has a line it cannot read, or when it is missing. Give `finish` the run's `--trace` when the run had one. The scan and the windows are a speed bump: a job that kills the runner, or a process it leaves behind (see "double fork" below), can still write a decision after the run. Reading `job.mjs` and the harness rules are the guard.

`finish` has a time budget too: `--budget`, 5 minutes unless you give one, counted from the start. A job that does not load within it is refused: `the job did not load within <budget>; nothing was sent`. A finish that runs past it is stopped, and `finished/<id>.json` says `unfinished`: it may have sent part of its work, and it is not run again.

When items never started (after `failed:<id>`, `budget_spent`, `stopped`, or over `--max-items`), the runner writes them to `left.jsonl` in the job's folder, in order, and the exit line names it. Run again with `--items left.jsonl`. A run with nothing left removes it.

On Windows, only Ctrl+C or Ctrl+Break in a console window counts as `stopped`. Ending the run another way (Task Manager, `taskkill`, `kill` in Git Bash, a scheduler's time limit) kills it with no exit line.

A usage error is exit code 2. The last line printed, and the last line of `trace.jsonl`, give the exit, the items done, parked and left, and the item that was cut, if any. Each item gets a `started` line before it runs: a trace that ends on an item's `started` line, with no exit line, is a run that was killed, and that item may have sent part of its work. `egress.mjs` exits 0 when a response came back (any HTTP status), 1 on a network error, 2 on a usage error and 3 on a refusal.

## Run it on a schedule

The pack has no scheduler. Start the run from one: `cron` or a systemd timer on Linux, `launchd` on macOS, Task Scheduler on Windows. Give the scheduled command its own `--budget`, shorter than the gap between two runs.

## Check that it works

1. **It loads.** In a new session, ask: "Which skills can you use?" `rook-clock` should be in the answer.
2. **The scripts.** Each has a self-test that uses no network (one HTTP server on `127.0.0.1`) and leaves no file behind:

       node "$PACK/scripts/egress.mjs" --self-test
       node "$PACK/scripts/run-job.mjs" --self-test
       node "$PACK/scripts/parked.mjs" --self-test

   Each prints `self-test ok`.
3. **A refusal.** With the template `hosts.json`, a request to another host is refused before anything is sent:

       node "$PACK/scripts/egress.mjs" --hosts "$PACK/templates/hosts.json" GET 'https://status.example.com/?k={{WEATHER_KEY}}'

   It prints `refused: WEATHER_KEY may not go to status.example.com (hop 1)` and exits 3. With no `WEATHER_KEY` set it says `refused: WEATHER_KEY has no value` first.

## Make your calls a wall

`decide` refuses a command with no terminal, and one that is not a plain `node` command (`NODE_OPTIONS` set, a Node flag, a wrapper script). That stops a plain command, not an agent that sets out to get past it. `egress.mjs` checks the list in `hosts.json`, not who wrote it. The wall is your harness: it refuses the agent's edits in `parked/`, `finished/`, `hosts.json`, `vars.json` and the pack's own folder, its read of `vars.json`, and its `decide`.

After setup, your human changes `hosts.json`; the agent proposes the change. `--hosts` takes any file, so your human reads `--hosts` in every command they approve: it should name `hosts.json`.

**Claude Code.** In the project's `.claude/settings.json` (an `Edit` rule covers every tool that edits a file, a `Read` rule every tool that reads one). Change the last `Edit` rule to the folder where you installed the pack:

    {
      "permissions": {
        "deny": [
          "Edit(**/parked/**)",
          "Edit(**/finished/**)",
          "Edit(**/hosts.json)",
          "Read(**/vars.json)",
          "Edit(**/vars.json)",
          "Bash(node *parked.mjs decide*)",
          "Bash(*NODE_OPTIONS*)",
          "Edit(~/.claude/skills/rook-clock/**)"
        ]
      }
    }

A deny rule matches a command as it is written, so keep other shell commands on "ask": a script the agent writes can still edit or read a file.

**Codex.** Keep `approval_policy = "untrusted"`, so each command that is not a plain read asks you first, and say no to any command that writes in `parked/`, `finished/`, `hosts.json`, `vars.json` or the pack's folder, or reads `vars.json`. **Pi** asks nothing before a command: run it in a container where `parked/`, `finished/`, `hosts.json` and the pack's folder are read-only to it. There, the agent runs the runner as itself, so it can read `vars.json` or the environment: a key it runs with is a key it can see.

Windows has no `script` command, but a terminal can still be made there in other ways. The harness rules count on every system.

## Known limits

- **The job runs as your user, and the pack does not fence its code in.** The job's process gets no secret: its environment holds only `PATH`, the temp, home and locale variables, and `ctx.send` refuses a listed secret's value written out in place of `{{NAME}}`. It catches a value pasted by mistake, not a job that changes it on purpose. What the pack does not stop: code in `job.mjs` that reads `vars.json` or another file, or the runner's environment (any process of your user can: `/proc/<pid>/environ` on Linux, the process's memory on Windows), and sends with its own client, or that writes a decision into `parked/`. Read `job.mjs` before a run, or check it: `grep -nE "import|require|process\.|fetch|http|vars\.json|readFile|child_process|writeFile|appendFile|rename|unlink|open|parked|finished|node:fs" job.mjs`. Each line it finds is one to read, and every import is a line to read: the template imports nothing, and only the API's URL and four comment lines match. Every send must go through `ctx.send`, and a job never writes in `parked/` or `finished/`. A run that finds a decision set in `parked/` while it ran, a file there it did not park, or one not named exactly for its id, ends `failed:job`, and `finish` refuses that decision and any decision recorded before the newest run ended. That scan and those windows are a speed bump: a job that kills the runner, or a process it leaves behind, can still write a decision after the run. Reading `job.mjs` is the guard.
- **`decide` is a speed bump, not a wall.** It refuses a command with no terminal, and one that is not a plain `node` command: `NODE_OPTIONS` set, any Node flag, or a wrapper script that imports `parked.mjs` (where Node has `import.meta.main`, 24 and newer). A wrapper that imports it on an older Node, after it patches the terminal check, still gets past: that way stays open. An agent with a free shell can also make a terminal (`script` on Linux and macOS), or write a decision into `parked/<id>.json`. `finish` refuses a copy edited by hand without its `copySha`, a decision with no `decidedAt` after its `parkedAt`, and one recorded before the newest run ended, not a decision written in with both after the run. The wall is your harness: see the rules above.
- **Finished once.** `finished/ledger.jsonl` keeps every finish that started, so deleting `finished/<id>.json` sends nothing again. Deleting the ledger too makes the item new: the same harness rules cover it.
- **What is hidden.** Output shows `{{NAME}}` in place of a secret's value and its percent-encoded (either case), base64, JSON-escaped and hex forms. Another form that a server echoes back, such as one cut in parts, stays as it is. A secret shorter than 8 characters is refused: hiding it would garble the output and show where it is.
- **An item cut by the budget or a stop** may have sent part of its work. The trace marks it `unfinished`. A run killed hard leaves it `started`, with no exit line.
- **Processes.** When a run ends, the job's process ends with every process under it. A process that left that tree (a double fork, on every system, or work handed to another service) keeps running. On Linux and macOS, a job in a loop that never yields keeps running when the runner itself is killed hard: check with `ps`.
- **No memory between runs.** Each run handles every item it is given.
- **`egress.mjs`** speaks HTTP/1.1, uses no proxy, reads at most 10 MB of each response as text, and waits 30 seconds for each hop. A secret in a header name, the host, the port or a user name is refused, never sent. A request that holds a secret always checks the certificate, and is refused while `NODE_TLS_REJECT_UNAUTHORIZED=0`.
- **A listed name trusts its DNS.** A name in `hosts.json` that resolves to a loopback or private address is sent there; only link-local and metadata addresses stay refused. An address that is not public is refused only when neither it nor a name for it is listed.
- **Addresses.** The link-local and cloud metadata addresses refused are the ones of the larger clouds. A cloud's metadata service on another address is refused only when that address is on a private network and not in `hosts.json`.

## Turn it off

Delete the `rook-clock` folder from your skills folder. The job's files (`job.mjs`, `hosts.json`, `trace.jsonl`, `left.jsonl`, `parked/`, `finished/`) stay in its folder until you delete them.
