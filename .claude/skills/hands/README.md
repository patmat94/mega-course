# hands

From rook's rig.

A tool contract kit. With it, your harness wraps any CLI, script or API as an MCP tool, schema first: it writes the contract in a TOOL.md, builds the tool to it, then checks the running tool against it.

## What is in it

| File | What it does |
|---|---|
| `SKILL.md` | The rules your harness follows when it builds or changes a tool. |
| `templates/TOOL.md` | The contract to fill in for each tool: name, description, input and output schema, result budget, errors table, side effects, and the samples to check. |
| `scripts/check-tool.mjs` | Calls the tool on a running MCP server with a good sample and a wrong one. It compares the schemas the server lists with TOOL.md and validates `structuredContent` against the output schema. It prints the result's bytes against the budget, and checks that each error names its field and says what to send next. Node 18 or newer, no dependencies. |
| `scripts/check-tool.selftest.mjs` | The checks behind `check-tool.mjs --self-test`. Your agent does not run this file. |
| `examples/define-word.tool.md` | A filled-in TOOL.md for a dictionary lookup tool. |

## Install

Copy the `hands` folder, with its three subfolders, to where your harness reads skills. There is nothing to install or build.

| Harness | One project | Every project |
|---|---|---|
| Claude Code | `.claude/skills/hands/` | `~/.claude/skills/hands/` |
| Cursor | `.cursor/skills/hands/` | `~/.cursor/skills/hands/` |
| Codex | `.agents/skills/hands/` | `~/.codex/skills/hands/` |

For one project in Claude Code, run this from the folder that holds this README:

    mkdir -p /path/to/your-project/.claude/skills
    cp -R . /path/to/your-project/.claude/skills/hands

Harnesses move these folders between versions. If `hands` does not show up, look up where your version reads skills. The folder itself stays the same.

A harness without skills can still use it. Add one line to its instructions file (`AGENTS.md` or `CLAUDE.md`): "When you build or change a tool, follow hands/SKILL.md."

## Check it works

1. Start a new session and ask your harness: "Wrap the `rg` CLI as a tool." It follows the hands skill: it starts a TOOL.md from the template and asks you what the tool is for before it writes any code.
2. Run the script on the example. It checks the TOOL.md and sends nothing:

       node .claude/skills/hands/scripts/check-tool.mjs --spec .claude/skills/hands/examples/define-word.tool.md

   The lines under `spec` read `ok` or `info`, none `FAIL`. The last line says "Only TOOL.md was checked. Nothing was started or sent." The exit code is 2, which means nothing was sent.

## What the script does and does not do

- It reads the one TOOL.md you name. It writes no files.
- It starts the command you give with `--cmd`, or calls the URL you give with `--url`, only when you add `--yes`. Without `--yes`, it prints its plan: the server, the tool and the samples.
- `--cmd` runs in your shell, so read it before you allow it. The server it starts gets your environment, as it does when your harness starts it.
- With `--yes` the tool runs for real on those samples, and it may call its own upstream (an API, a model). So the `good` sample must be safe to repeat.
- A tool that changes anything outside this machine has `"sideEffects": true` in its TOOL.md. The script refuses to run it without `--stub` and `--stub-log`: a stand-in for the upstream on this machine, and the file it logs to. `SKILL.md` shows how to give one.
- When it ends, it stops the server it started and the processes still under it. A process that left that tree can stay behind.
- It follows no redirect, and it stops at 16 MB for one answer and at a time limit for the whole run.
- What it prints from the server or from TOOL.md is data, quoted or not. It stays on one line, with control and invisible characters shown as `\u{…}` codes. Messages and descriptions stand in double quotes; names, paths, versions and other short values print as they are.
- It hides common secret shapes. A secret in another shape, such as an `Authorization: Bearer` value or a password in a database URL, can show.
- It does not sign in. A server that asks for sign-in answers 401, so check its tools through its stdio entry, if it has one. Never turn off a server's sign-in, or add a switch that turns it off, to run the check: a switch left on lets anyone call its tools.
- It installs nothing, and it sends nothing anywhere else.

`node scripts/check-tool.mjs --help` lists every option.
