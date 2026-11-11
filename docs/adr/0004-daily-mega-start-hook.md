# 0004 · Mega start runs in the first session of the day

**Status:** accepted

## Decision

A hook (`.claude/hooks/daily-mega-start.mjs`) handles two events, both wired in `.claude/settings.json`:

- **SessionStart:** if `.claude/state/daily-mega-start.txt` does not hold today's local date, the hook adds a note to the agent's context: run mega start (call `mega-start`, brief the human, `save-brief`) before answering the human's first message. It stays quiet after a compaction and once the date matches.
- **PostToolUse** on `mcp__mega-challenge__mega-start`: writes today's date to the stamp file.

The stamp is written when mega-start runs, not when the note is shown. So a session closed before any message keeps the note for the next session that day. A manual "mega start" also counts for the day. If the hook fails, it outputs nothing and the session starts as usual.

The agent acts only when the human sends a message. The first message of the day can be anything, and the brief comes before the answer to it. Opening the folder in VS Code starts nothing unless the Claude Code panel is opened.

## Why

The human wanted mega start to run when they open the repo, at most once a day, without typing the command. A hook cannot call an MCP tool itself (`mega-challenge` uses an OAuth sign-in held by the harness), so the hook prompts the agent. Two other options were rejected: a headless `claude -p` started from the hook, which would cost an extra session a day and need pre-approved tools, and a scheduled task in the Claude app at 08:00, which runs only while the app is open.

## Checked

On 2026-11-04, six scripted cases passed: no stamp gives the note, compaction gives nothing, yesterday's stamp gives the note, PostToolUse writes today's date, today's stamp gives nothing, and bad input gives `{}` with exit 0. Not yet checked live: PostToolUse firing on a real mega-start call, which happens at the next mega start.

## Decided by

The human, 2026-11-04, choosing option A ("SessionStart hook adds a reminder").
