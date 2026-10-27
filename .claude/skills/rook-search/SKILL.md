---
name: rook-search
description: Use when searching for Rook's traces across MEGA course lessons and challenges — in local files, log entries, challenge API responses, and via the rook MCP tool.
---

# rook-search

Rook is a character in the WAKE story threaded through the MEGA.dev course. Rook communicates through lesson files, challenge API responses embedded in `log.txt`, and a live MCP tool called `rook` that appears in the harness.

## Scope

| Scope | What to search |
|---|---|
| Project-wide (default) | All `mega-s*` folders under the course root |
| Lesson-specific | The named folder only, e.g. `mega-s01e01` |

Ask the user which scope to use if not stated.

## Search steps — run in order

1. **Named files** — Glob `rook*.*` inside the scope. These are direct drops from Rook (e.g. `rook-message.txt`).
2. **File contents** — Grep for `rook` (case-insensitive) in `*.txt`, `*.md`, `*.json` within scope. Report path + the matching line.
3. **Log entries** — Inside each `log.txt`, grep for `rook`. These appear as API response bodies from challenge endpoints. Quote the relevant lines.
4. **Live MCP tool** — The `mcp__mega-challenge__rook` tool gives direct access to Rook. **Ask the user before calling it** — it is a live call and Rook may respond.

## Permission gates — always ask before

- Calling `mcp__mega-challenge__rook`
- Reading files outside `mega-s*` folders
- Any write or modification

## Stopping rule

If more than 20 files match OR search has run for 3+ minutes:
1. Stop immediately
2. Summarise: folders checked, files found with paths, key excerpts seen
3. Ask: continue with full scope, or narrow to a specific lesson?

## Output format

```
## Rook traces found

**Named files**
- mega-s01e01/rook-message.txt — [first line of file]

**Log entries**
- mega-s01e01/log.txt (2026-10-27) — [rook's note or reference, one line]

**MCP tool response** (if called)
> [Rook's exact text, quoted]

**Summary**: Rook appears most prominently in [lesson/location], with [N] distinct traces.
```

If nothing is found: state clearly that no traces were found in the searched scope and suggest widening scope or calling the live MCP tool.
