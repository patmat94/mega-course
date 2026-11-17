# rook-plane

From rook's rig.

Three skills for a project with more than one agent role, and the three scripts they run. The layer that decides how the agents work sits apart from the runs themselves: each role is a folder, and the runtime reads that folder fresh at every run.

- **role-folder** keeps each role as a folder: `roles/<name>/ROLE.md` (purpose, startup reads, tools, limits, settings, output) and `reads.json`. Its files hold no facts, only where to read them. One role writes, another judges.
- **fresh-start** reads the facts from their source and the project's why-notes at every start. `startup.mjs` writes a dated start bundle with each read's source, time and version, and adds one line to `runs.jsonl`: the role folder's version, each read's version, the harness. A read that fails ends the start.
- **run-anywhere** starts the same role from Claude Code, Codex or Pi. `launch.mjs` runs the start, then the harness once, with the bundle as its system prompt, no saved session and stdin closed.

`inspect.mjs` lists what each role is, what it reads at its start, its last run, and every setting with no why.

Not the same as `rook-crew`: `crew` sends one job to a helper and checks its receipt; `plane` keeps the roles themselves, their reads and their why.
Not the same as `rook-loop`: `loop` runs a model until `./verify` passes; `plane` starts a role once, from a fresh start.

## What is in the folder

| File | What it is |
|---|---|
| `SKILL.md` | the entry your harness loads; it points to the three skills |
| `skills/role-folder/SKILL.md` | rules for a role's folder, its facts, its limits and its why |
| `skills/fresh-start/SKILL.md` | rules for startup reads, the start bundle and the run record |
| `skills/run-anywhere/SKILL.md` | rules for starting a role in any harness |
| `scripts/startup.mjs` | the start: every read, now |
| `scripts/launch.mjs` | the start, then one harness |
| `scripts/inspect.mjs` | the list of roles, their reads, their last run and the settings with no why |
| `scripts/*.selftest.mjs` | the checks behind each script's `--self-test`. Your agent does not run these files |
| `templates/role/ROLE.md`, `templates/role/reads.json` | the start of a role |
| `templates/why/README.md` | how to write a why-note |

You need Node.js 20 or newer. A `files` read also needs git, and the project in a git repository. No packages, nothing downloads. The scripts run in PowerShell, Git Bash, macOS and Linux.

## Install

Install it in a folder named `rook-plane`, the skill's own name. Leave its inside as it is: `SKILL.md` points to the other files by their paths.

**Claude Code.** For every project on this machine:

    mkdir -p ~/.claude/skills && cp -R /path/to/plane ~/.claude/skills/rook-plane

Or `.claude/skills/rook-plane/` in one project. Then start a new session.

**Codex.** Copy the folder to `~/.codex/skills/rook-plane/`, or `.codex/skills/rook-plane/` in the repository. If your Codex version does not list the skill, add this line to the project's `AGENTS.md`: `When the project has agent roles, follow <path to>/rook-plane/SKILL.md.`

**Pi.** Copy the folder to `~/.pi/agent/skills/rook-plane/`, or `.pi/skills/rook-plane/` in the project.

**Any other harness.** Put the folder in the project, and the same one line in its instructions file.

If your version of a tool looks for skills in another folder, its docs name it. The files stay the same.

**Reads with a secret** need `rook-clock` too. `startup.mjs` looks for its `egress.mjs` in `~/.claude/skills/rook-clock/`, `~/.codex/skills/rook-clock/`, `~/.pi/agent/skills/rook-clock/` and `~/.agents/skills/rook-clock/`, in that order, then in the skills folder that holds `rook-plane`; anywhere else, pass `--egress <path to rook-clock>/scripts/egress.mjs`. It never takes one from inside the project or from a network or device path (one that starts with two slashes, like a share), so with a project-level install of `rook-plane`, install `rook-clock` in your home skills folder. Each start prints the `egress.mjs` it used. When `rook-clock` is installed, its hider covers every listed secret in each bundle and run record, also when no read needs a secret.

## Set up a role

From the project's folder, with `PACK` set to the folder you installed (for example `PACK=~/.claude/skills/rook-plane`):

1. Copy the templates: `mkdir -p roles/checker why && cp "$PACK/templates/role/ROLE.md" "$PACK/templates/role/reads.json" roles/checker/`.
2. Fill in `ROLE.md` with your own words. In `reads.json`, name each source the role reads its facts from, and keep the `why` read. A read that needs a secret lists its hosts in the project's `hosts.json` (`rook-clock`'s format), which you write yourself; a role folder holds no `hosts.json`.
3. Write a note in `why/` for each decision a role must not undo (`templates/why/README.md`).
4. Keep `roles/*/.start/` out of version control (for example in `.gitignore`): a bundle holds what its reads returned.
5. Start it:

       node "$PACK/scripts/launch.mjs" roles/checker --harness codex --dry-run
       node "$PACK/scripts/launch.mjs" roles/checker --harness codex

6. See what you have:

       node "$PACK/scripts/inspect.mjs" roles/

In PowerShell, write `$env:PACK` for `$PACK`.

The scripts write only in the role's folder: `.start/` and `runs.jsonl`.

## Keep a running role off the roles

A role at work must not edit `roles/`, `why/` or `hosts.json`: the next start of a role reads those files as its own context. When a role runs with write tools, give its harness rules that refuse those edits. **Claude Code**, in the settings the role runs with (`.claude/settings.json`; changes to roles are then yours to make):

    {
      "permissions": {
        "deny": [
          "Edit(roles/**)",
          "Write(roles/**)",
          "Edit(why/**)",
          "Write(why/**)",
          "Edit(**/hosts.json)",
          "Write(**/hosts.json)",
          "Edit(**/.gitignore)",
          "Write(**/.gitignore)",
          "Edit(**/.git/**)",
          "Write(**/.git/**)",
          "Read(**/vars.json)",
          "Edit(~/.claude/skills/rook-plane/**)"
        ]
      }
    }

The git rules (`.gitignore`, `.git/`) decide which files a `files` read may take, so they are on the list too: your human changes these; the agent proposes. A deny rule matches a command as it is written, so keep other shell commands on "ask": a script the agent writes can still edit a file. **Codex**: keep `approval_policy = "untrusted"` and say no to any command that writes in `roles/`, `why/` or `hosts.json`. **Pi** asks nothing before a command: run the role in a container where those are read-only to it.

## Exit codes

| Script | 0 | 1 | 2 |
|---|---|---|---|
| `startup.mjs` | the bundle is written; its path is printed, then `hosts: <each secret> → <its hosts> (<file>) · egress: …` | a read failed or was refused: `start failed: read <name>: …`; no bundle, no record | a usage error: the folder, `reads.json`, a flag, a role folder's own `hosts.json` |
| `launch.mjs` | the harness's own exit code, whatever it is | the start failed; no harness started | a usage error, or the harness is not on PATH: `<harness> is not installed: no <harness> on PATH` |
| `inspect.mjs` | it listed, also when a setting has no why | with `--strict`: a setting has no why | no such folder |

## Going back

A role is its folder, so the way back is version control: `git checkout <commit> -- roles/<name>`. Each line of `runs.jsonl` keeps the folder's version (`folder`) and each read's version, so you can see which start ran with which files and which facts. The pack compares nothing and changes nothing back on its own.

## Check that it works

1. **It loads.** In a new session, ask: "Which skills can you use?" `rook-plane` should be in the answer.
2. **The scripts.** Each has a self-test that uses no network (one HTTP server on `127.0.0.1`, and stand-in harnesses on a PATH of their own: no model is called) and leaves no file behind:

       node "$PACK/scripts/startup.mjs" --self-test
       node "$PACK/scripts/launch.mjs" --self-test
       node "$PACK/scripts/inspect.mjs" --self-test

   Each prints `self-test ok`.
3. **A refusal.** In a role whose `reads.json` has a read with `{{API_TOKEN}}` and no `rook-clock` installed, `node "$PACK/scripts/startup.mjs" roles/<name>` prints `start failed: read <name>: this read needs a secret: install rook-clock, or read it without one`, sends nothing and exits 1.
4. **A harness line.** `node "$PACK/scripts/launch.mjs" roles/<name> --harness claude --dry-run` prints the line it would run, and runs nothing.

## Known limits

- **What each harness still loads.** Checked on 16 Nov 2026 with `--help`, and runs that fail before any model call. No model was called.
  - **Claude Code** 2.1.325: `-p`, `--no-session-persistence` and `--model` are in `--help`. `--system-prompt-file` is not listed there, but it is taken: a missing file stops it with `System prompt file not found`, and a misspelt flag with `unknown option`. The file takes the place of Claude Code's own system prompt. Claude Code still loads the `CLAUDE.md` files (the project's, its parent folders', your own), its auto memory, your settings with their permissions and hooks, its skills and its MCP servers. That includes the project's own `.claude/settings.json`: its hooks run, as when you start `claude -p` in that project by hand. `--bare` would skip `CLAUDE.md`, the memory and the hooks, but it reads only `ANTHROPIC_API_KEY` for sign-in and turns off the hooks that may be your guards, so `launch.mjs` does not pass it.
  - **Pi** 1.5.0: `-p`, `--no-session`, `-ne` (`--no-extensions`), `-nc` (`--no-context-files`), `--system-prompt` and `--model` are in `--help`. `launch.mjs` adds `-nc`, so Pi reads no `AGENTS.md` or `CLAUDE.md`. `--system-prompt` takes a file when the path exists, and the path itself as the text when it does not; `launch.mjs` always passes the bundle it has just written. Pi still loads its built-in tools, its skills, its prompt templates, its MCP servers and your settings. Pi needs Node.js 22.19 or newer: on Windows, `launch.mjs` starts Pi's own Node script with the Node.js that runs `launch.mjs`.
  - **Codex** was not installed on the machine this was checked on: its line (`exec`, `--ephemeral`, `-c model_instructions_file=…`, `--model`) is not checked here. Codex may still read the project's `AGENTS.md`, its config and its MCP servers. Check yours with `codex exec --help`, and a `--dry-run` line before the first start.
- **No limit in code from `launch.mjs`.** It passes no tool flags: the role gets the harness's own tools, and a limit in `ROLE.md` holds only in words. A limit in code needs the harness's settings or the role's own starter.
- **The harness runs as you.** It gets your environment and your files, the same as when you start it by hand. `launch.mjs` passes no secret of its own, and a secret read goes through `rook-clock` only; the harness itself may still read `vars.json` or the environment. The walls are your harness's rules, as in `rook-clock`'s README.
- **A read is data.** The bundle is the system prompt, so a read's text reaches the model with it. A source that answers with instructions can try to steer the role: read only sources your human trusts.
- **Reads without a secret** use Node's own `fetch`: they follow redirects, to any host, local addresses too. A read with a secret goes through `egress.mjs`, which checks every hop. A URL with a user name or password in it is refused, and so is a read with no `{{NAME}}` that has a credential header (`authorization`, `cookie`, a key or a token) or, with `rook-clock` installed, a listed secret's value written out as it is, or in a common encoding (percent-encoded in either case, base64, base64url, JSON-escaped, hex), also after one `%xx` decode. This is a guard against mistakes, not a wall: whoever writes the value out has it already, and another transform (encoded twice, split, reversed, lowercased in a host) is not caught.
- **Sizes.** Each read at most 256 KB, the bundle at most 1 MB, at most 32 reads, at most 200 files for one `files` read. A `files` read follows no link and stays in the project. It reads only files that would be committed: in a git repository, a file that git ignores is refused, and so is anything under `.git/`; outside a git repository, every `files` read is refused (`files reads need a git repository here, so ignored files stay out`). The project's git rules decide what is read, so a project change cannot take your ignore line away: a file that a `!` line un-ignores (in any `.gitignore`, `.git/info/exclude` or `core.excludesFile`) is refused (`is un-ignored by a "!" rule`), a file your own ignore file ignores is refused even when the project's `.git/config` points `core.excludesFile` elsewhere, and a file inside another repository in the project (a folder with its own `.git`) is refused. A `.git/` that came with the project (in a zip) can still carry its own index and rules: keep `.gitignore` and `.git/` your human's (the deny rules above). A second check refuses these names, by the file's real name, in any case: `vars.json`, `.env`, `.env.*`, `*.env`, `.envrc`, `.dev.vars`, `secrets.*`, `.npmrc`, `.netrc`, `.pgpass`, `.git-credentials`, `id_*`, `*.pem`, `*.key` and other key files, and the `--vars` file. A path with `:` or a short name like `VARS~1.JSO` is refused, and so is a file with a second name (a hard link): `ROLE.md` and `reads.json` too. A secret committed to the repository is read like any other file: keep secrets in ignored files.
- **Read at the start only.** A fact that changes while the role runs is not read again until the next start.
- **On Windows**, a harness installed as a `.cmd` launcher is started through the Node script that launcher names, never through a shell. A `.cmd` that names no Node script is refused: start that harness yourself with its line.
- **The harness is found on PATH**, in absolute folders only, never inside the project: each one is checked by its real path, so a junction or a short name that leads into the project is skipped too (and so is a `node_modules/.bin` there). A network or device folder (one that starts with two slashes) is skipped. A PATH entry you add is a binary you trust.
- **Old bundles stay.** Each start writes a new file in `.start/`; delete old ones when you like.
- **`inspect.mjs` checks the why, not the facts.** It lists the settings with no why; it does not read the role's text for values pasted in it.

## Turn it off

Delete the `rook-plane` folder from your skills folder. Your roles (`roles/<name>/`, their `.start/` and `runs.jsonl`) and `why/` stay in the project until you delete them.
