# S02E04 job-1 replay: results

Step replayed: the job-1 worker (incident-lookup v1), first run 2026-11-06 as `claude -p`, session `25e684bf`. The course's job link expired 2026-11-07T15:30:09Z, so the replay runs against `job1-stub.mjs`, which plays back the four replies recorded in `../log.txt`. Same brief file (`../job1-brief.md`), model `claude-opus-5-5`, `--allowedTools mcp__job1` and working folder. Command: `sh mega-s02e04/replay/run-replay.sh`.

Two runs on 2026-11-09:

| | original (log.txt + job1-worker.json) | replay 1, untraced | replay 2, Langfuse on |
|---|---|---|---|
| session | 25e684bf | b061a099 | 400a846f |
| cost USD | 0.2920 | 0.2647 | 0.2826 |
| assistant messages | 6 | 6 | 6 |
| tool calls | 5 | 5 | 5 |
| tool order | ToolSearch > search > read > redact > submit | same | same |
| MCP calls (log.txt says 4) | 4 | 4 (stub log) | 4 (stub log) |
| output tokens | 2987 | 1706 | 1810 |
| cache read / write | 268604 / 22306 | 276794 / 21893 | 293448 / 23452 |
| API seconds | 26.5 | 15.8 | 19.7 |

Full tables: `compare-untraced.md`, `compare.md`. Stub call logs: `stub-calls-untraced.jsonl`, `stub-calls.jsonl`.

## What differs and why

- **Shape is identical.** Same 6 turns, same 5 calls in the same order, and both replays submitted the redacted text. log.txt counts 4 calls because it lists only the MCP calls. The fifth is Claude Code's own `ToolSearch`, which loads the deferred `job1` tools before the first call. It sits in the transcript, not in the log.
- **Cost is 3–10% lower** in the replays, driven by output tokens (about 1.7–1.8k against 3.0k). The original's final message quoted every reply in full, including the long real step tokens. The stub's short `step-N-replay` tokens make that message shorter.
- **Time is lower** because the stub answers at once, with no network trip to hq.mega.dev.
- **Cache reads are higher** in the replays: today's system prompt and context are larger than on 2026-11-06.

## Langfuse trace (replay 2)

- Trace id `dca85b52ac542d2dffee893462be3852`. The hook's state shows 6 generations and 5 tool spans emitted, which matches the transcript.
- Not checked from here: whether the trace reached the server and how it looks. Reading it back needs the secret key, which only the human holds. Find it in the Langfuse UI under Tracing, by that id or by session id `400a846f-0ec7-40ac-ab24-e54d9c4c0652`.
- Windows issue 1: Claude Code did not find the per-user Git Bash, so the plugin's sh-syntax hook ran in PowerShell and failed (replay 1 sent nothing). Fixed per run with `CLAUDE_CODE_GIT_BASH_PATH`, set in `run-replay.sh`.
- Windows issue 2, or `-p` in general: Claude Code cancels the SessionEnd hook when `claude -p` exits ("Hook cancelled"). The Stop hook sends the observations, but the turn stays marked open in `~/.claude/state/langfuse_state.json`. The root span may show as unfinished in Langfuse.
