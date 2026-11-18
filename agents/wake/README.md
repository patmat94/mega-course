# wake · domain agent

Owns `lib/wake/**` (`domain.json`). Advises Main and never writes.

- Agent: `.claude/agents/wake-domain.md` (haiku; Read, Grep, Glob only).
- Memories: `memories.md`, with Engineering and Customer-facing sections. Every line cites an ADR, commit, log line or contract line. Main updates the file; the agent only reads it.
- Wake-up: `.claude/hooks/domain-wake.mjs`, PreToolUse on Read|Edit|MultiEdit|Write. When Main touches a file under the globs, the hook runs `claude -p --agent wake-domain` (hooks off, no MCP) and passes its answer to Main as context. It fires once per session for reads, and once per session per file for edits. It never blocks the tool. Tests: `node --test ".claude/hooks/test/*.test.mjs"`.
- A new domain is a new `agents/<name>/domain.json` plus its agent file. The hook picks it up with no change.

## Checked 2026-11-18

1. Hook run by hand on a naive Edit of `lib/wake/ingress.ts` (writing the `seen` key before `queue.send`): 15 s. The agent said the edit breaks the memory, and named the 503-then-"duplicate" loss and the lost-job-on-crash case, each with its source.
2. A fresh terminal `claude -p` (haiku) that read `lib/wake/ingress.ts` was blocked with no `CLAUDE_CODE_GIT_BASH_PATH`: the project hooks need Git Bash, and Claude Code in a terminal does not find it on this PC. With `CLAUDE_CODE_GIT_BASH_PATH` set, the hook ran and the session quoted "Domain agent wake-domain (agents/wake, haiku) woke for Read on lib/wake/ingress.ts" from its context, after 26 s in total.
