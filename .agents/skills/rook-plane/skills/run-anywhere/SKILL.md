---
name: run-anywhere
description: Use when a role should start from Claude Code, Codex or Pi with fresh context and nothing carried over from another session. launch.mjs runs the start, then the harness once in print mode, with the role and its fresh reads as the system prompt and stdin closed.
---

# run-anywhere

A role that only starts in one harness is tied to it. A role that starts the same way in every harness can move. `launch.mjs` gives each harness the same thing: the role's start bundle as its system prompt, no saved session, stdin closed. The scripts sit in `scripts/` in the pack folder, two levels above this file.

## The lines

From the project's folder:

    node scripts/launch.mjs roles/<name> --harness claude|codex|pi [--model <id>] [--prompt "Start."]

It runs `startup.mjs`, then one of these, with `<bundle>` the start bundle:

| Harness | The line it runs |
|---|---|
| Claude Code | `claude -p --system-prompt-file <bundle> --no-session-persistence "Start."` |
| Codex | `codex exec --ephemeral -c model_instructions_file="<bundle>" "Start."` |
| Pi | `pi -p --no-session -ne -nc --system-prompt <bundle> "Start."` |

`--model` adds `--model <id>`. It is the only way a model reaches the harness: a `model:` line under Settings in `ROLE.md` is a note for humans, and `launch.mjs` never reads it. A model id of one harness does not work in another, so write one line per harness (`model (claude): <id>`) or "the harness's default", and pass the one you mean with `--model`. It prints `run (in <folder> · hosts: <secret> → <its hosts> (<file>) · egress: <path>): <the line>` before it runs it: each secret the reads name with the hosts it may go to, and the `egress.mjs` the start uses, or `none`. The harness is never taken from inside the project, even through a link or a short name, nor from a network or device folder.

## Rules

1. **Look before you run.** Run with `--dry-run` first: it prints the line and runs nothing, not even the reads. Show your human the line when it is the first start in a harness. Then run `node scripts/startup.mjs roles/<name>` once: it reads every source and starts no model, and its `runs.jsonl` line says `launcher: none`. Check, before the first real start: a `--dry-run` line for each harness, and a `startup.mjs` start (`launcher: none`) that read every source. The printed line names the role's `.start/`, the harness you meant, and the hosts file your human keeps.
2. **Start a role only through `launch.mjs`.** No pasted role text in a running session, no `--continue`, no resumed session: each start is fresh, and its reads are new. Check: the role's `runs.jsonl` has a line for this start, with the harness (a line with `launcher: none` is a `startup.mjs` start, with no harness).
3. **The harness's exit is the run's exit.** `launch.mjs` exits with the harness's own code. `start failed: …` (exit 1) means a read failed and no harness started: see `fresh-start`. `<harness> is not installed` (exit 2) means it is not on PATH: tell your human, and never install one yourself. Check: your report gives the exit and the last line printed.
4. **Know what each harness still brings.** A fresh context is not an empty one: Claude Code still loads its `CLAUDE.md` files, its memory, settings and MCP servers; Codex reads `AGENTS.md`. The pack's README lists what each one loads (Known limits). When a role must not see one of these, tell your human. Check: your report says what the harness loaded besides the bundle, when it matters.
5. **Tools differ by harness.** Each harness gives the role its own tools. A limit that holds in code in one harness (no write tool) may hold only in words in another. Check: before a judge runs in a new harness, its Limits still say how each one holds there.

## Example

Your human: "Let me start the checker from Codex too."

1. `node scripts/launch.mjs roles/checker --harness codex --dry-run` prints `would run (in /work/shop · hosts: none · egress: none): /usr/local/bin/codex exec --ephemeral -c "model_instructions_file=\"roles/checker/.start/<this start>.md\"" "Start."`.
2. Your human: "Go." Run it without `--dry-run`. It prints `start bundle: roles/checker/.start/2026-11-16T10-02-41-118Z.md`, the line, then the checker's findings.
3. `node scripts/inspect.mjs roles/` shows `last run: 2026-11-16T10:02:41.118Z · codex · …`.
4. Tell your human: "The checker ran in Codex from a fresh start; its findings are above. Codex also read the project's AGENTS.md."

## Done looks like

- The role started through `launch.mjs`, in the harness your human named.
- `runs.jsonl` has the start's line, with the harness.
- Your report gives the exit, and what the harness loaded besides the bundle when it matters.
