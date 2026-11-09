---
name: session-trace
description: Use when you want to see what a Claude Code session or one step of a past solve really cost — tokens, dollars, tool calls, time — by tracing it to Langfuse and/or replaying the step against a recorded stub and comparing it with the original run. Also use when setting up Langfuse tracing for a project.
metadata:
  version: "1"
---

# session-trace

Two parts, usable apart:

| Part | What it gives | Needs |
|---|---|---|
| A. Langfuse tracing | One trace per turn: prompts, replies, tool calls with inputs and outputs, tokens, timing, in the Langfuse UI | A Langfuse account and keys (your human makes them), Python 3.9+, the official plugin or hook |
| B. Replay and compare | The same numbers, local and offline, side by side with the original run, from transcripts and `claude -p` JSON | Node 18+ and the original session's transcript or log |

Do B even when A is on: the local numbers check the trace, and the trace shows what the numbers cannot (tool inputs and outputs, where the time went).

## A. Langfuse tracing (one project, one session)

Tracing sends whole transcripts (prompts, file contents that tools read, tool outputs) to Langfuse's servers. **Ask your human before you turn it on**, and never in a project whose transcripts may hold secrets or client data unless they agree to that specifically.

Your human's part. You never create the account and never handle the secret key:

1. They sign up at https://cloud.langfuse.com (EU) or https://us.cloud.langfuse.com (US), make a project, and create an API key pair (`pk-lf-…`, `sk-lf-…`).
2. They say yes to installing the plugin and the Python package below.

Your part, after that yes:

1. Check Python: `python3 --version` (3.9+). Install the SDK the hook needs: `python3 -m pip install "langfuse>=4.0,<5"`.
2. Install the official plugin, by the user, so it is available in every project:

   ```
   claude plugin marketplace add langfuse/Claude-Observability-Plugin
   claude plugin install langfuse-observability@langfuse-observability
   ```

   It asks for `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and `LANGFUSE_BASE_URL` when it is enabled, and keeps the secret in the OS keychain. **Your human types the keys**, in an interactive `claude` session or with `claude plugin configure langfuse-observability@langfuse-observability`. Never ask for them in chat.
   Manual route without the plugin: a Stop hook `python3 ~/.claude/hooks/langfuse_hook.py` (script from the Langfuse docs page, read it before saving it) plus `TRACE_TO_LANGFUSE`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and `LANGFUSE_BASE_URL` under `env` in the project's `.claude/settings.local.json`. That file must be git-ignored (`git check-ignore -v .claude/settings.local.json`) before any key goes in.
3. Turn tracing on only for the project and the session you mean. Restart Claude Code, or start the `claude -p` run, after the change, because settings are read at start.
   **On Windows:** the plugin's hook is written for sh. If Claude Code cannot find Git Bash (a per-user install under `%LOCALAPPDATA%\Programs\Git` is not found), the hook runs in PowerShell and fails with `Missing '(' after 'if'`, and nothing is traced. Set `CLAUDE_CODE_GIT_BASH_PATH` to that `bash.exe`: for one run with `export` before `claude -p`, or for good under `env` in `~/.claude/settings.json` (ask first). Test with a one-word `claude -p` on a cheap model and look for a new line in `~/.claude/state/langfuse_hook.log` before you run the real step.
   **With `claude -p`:** Claude Code cancels the SessionEnd hook when the process exits ("Hook cancelled"). The Stop hook still sends the generations and tool spans, but the turn stays marked open in `~/.claude/state/langfuse_state.json`. To get the trace id, read `turn_progress.*.trace_id` in that file for the session.
4. Run the session. Check that the trace arrived in the Langfuse UI (Tracing, filter by session id). If none arrived, read `~/.claude/state/langfuse_hook.log`; `CC_LANGFUSE_DEBUG=true` makes it verbose.
5. When you are done, turn it off again (disable the plugin or remove `TRACE_TO_LANGFUSE`), unless your human wants it to stay on.

Docs: https://langfuse.com/integrations/developer-tools/claude-code

## B. Replay one step and compare

1. **Pick one step** with a clear input and output that ran as its own session, such as a worker run by `claude -p`. Find its record: the session id (in the `-p` JSON, `receipts.json` or the log), the transcript at `~/.claude/projects/<folder>/<id>.jsonl`, and the `-p` JSON if it was saved.
2. **Freeze what it called.** If the live tool, link or API is gone or must not be called again, write a stub that replays the recorded replies (an MCP stdio server, plain Node). Mirror the original reply shapes, mark each reply the record did not hold as synthetic, and log each call to a file. A stub never sends anything on.
3. **Rerun the step the same way**: same brief (from the file it was sent from, not retyped), same model, same flags, same working folder; only the tool endpoint points at the stub. Save the JSON: `claude -p "<brief>" --model <id> --mcp-config <stub config> --allowedTools <same> --output-format json < /dev/null > replay.json`. The `< /dev/null` stops `claude -p` from reading stdin it was not meant to read.
4. **Compare** with the original:

   ```
   node <this skill's folder>/scripts/compare-run.mjs original=<session id>[,<orig.json>] replay=<session id>,replay.json
   ```

   It prints a Markdown table: model, cost (from the `-p` JSON only), messages, tool calls by name, tokens (input, output, cache read and write) and time. Check its token totals against the `-p` JSON once: they must agree.
5. **Write it down**: the table, what differs and why (a cache that was warm in one run, an extra tool search, a stub that answers faster than the real tool), and, if A was on, the Langfuse trace id or link.

## Rules

- Transcripts and traces can hold link keys, receipts and personal data. Never paste a key into a brief, a trace note or a commit. Mask it as the log does.
- A replay is not the original: the stub's speed, a different cache state and the model's own variation all shift the numbers. Compare the shape (which tools, in what order, how many turns) before the dollars.
- Cost in this kit comes only from Claude Code's own `total_cost_usd`. Never work out a price from tokens in your head.

## Done

- If A: your human said yes, the keys went in through their hands only, a trace for the session is visible in Langfuse, and tracing is off again unless they asked to keep it.
- If B: the comparison table is saved next to the step, with the replay's JSON and the stub's call log, and each difference has a one-line reason.
