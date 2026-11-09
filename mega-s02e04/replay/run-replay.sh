#!/usr/bin/env sh
# Replays the S02E04 job-1 worker step against job1-stub.mjs, the way the original ran on 2026-11-06:
# same brief file, same model, same --allowedTools, same working folder (mega-s02e04), config with only job1.
# Then compares it with the original session 25e684bf (log.txt: 4 MCP calls; job1-worker.json: $0.29).
# Run from the repo root, in bash:  sh mega-s02e04/replay/run-replay.sh
set -eu
cd "$(dirname "$0")/.."            # mega-s02e04
# Git Bash here is a per-user install that Claude Code does not find, so plugin hooks written for sh
# (the Langfuse one) fall back to PowerShell and fail. Point Claude Code at it for this run.
GB="$HOME/AppData/Local/Programs/Git/bin/bash.exe"
if [ -z "${CLAUDE_CODE_GIT_BASH_PATH:-}" ] && [ -f "$GB" ]; then export CLAUDE_CODE_GIT_BASH_PATH="$(cygpath -w "$GB")"; fi
rm -f replay/stub-calls.jsonl
claude -p "$(cat job1-brief.md)" \
  --model claude-opus-5-5 \
  --mcp-config replay/mcp.json \
  --allowedTools mcp__job1 \
  --output-format json < /dev/null > replay/replay.json
id=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('replay/replay.json','utf8')).session_id)")
echo "replay session: $id"
echo "stub calls: $(wc -l < replay/stub-calls.jsonl)"
node ../.agents/skills/session-trace/scripts/compare-run.mjs \
  original=25e684bf-4ff5-4335-a4d0-5ef6789c396b,job1-worker.json \
  replay="$id",replay/replay.json | tee replay/compare.md
