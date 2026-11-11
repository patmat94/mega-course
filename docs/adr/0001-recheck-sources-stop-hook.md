# 0001 · Re-read the sources before the agent stops

**Status:** accepted

## Decision

A Stop hook (`.claude/hooks/recheck-sources.mjs`, wired in `.claude/settings.json`) runs every time Claude Code is about to stop in this repo. It picks the lesson folder whose `log.txt` changed last, within 12 hours. It reads that folder's `receipts.json` → `watch` (file-list URLs, pages, local folders), and compares each source with the snapshot from the previous stop. The snapshots live in `.claude/state/`, which git ignores. If a source changed, the hook blocks the stop, and its reason lists what is new or gone. It blocks at most 3 times per session, and a source it cannot fetch never blocks.

Reading session files from any harness goes through the `recall` skill (`.agents/skills/recall/`, linked from `.claude/skills/recall`).

## Why

In S02E01 the course added session files after the plan check-in and again after the first passing build. The first build rested on the first archive and was refused ("Something changed since your check-in"). The agent stopped without looking again, because nothing made it.

## Decided by

The human, 2026-11-02, after the S02E01 debrief listed both as missing.
