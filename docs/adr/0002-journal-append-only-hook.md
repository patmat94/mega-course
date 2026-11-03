# 0002 · Lesson journals are append-only

## Decision

A PreToolUse hook (`.claude/hooks/log-append-only.mjs`, wired in `.claude/settings.json` on `Edit|MultiEdit|Write`) guards every `mega-sXXeYY/log.txt`. It works out what the file would hold after the call and denies the call unless the current content is still there, unchanged, at the start. Only appends pass. A new or empty log passes, and so do log files deeper in a lesson (for example `repo/log.txt`). Line endings and a leading BOM are ignored when comparing, because the logs mix CRLF and LF. If the hook fails, it denies the call.

Appends from the shell (`Add-Content`, `>>`) are not checked. Shell overwrites (`>`, `Set-Content`) are not checked either: the hook covers the file tools only.

## Why

`log.txt` is the journal the debrief is built from, and CLAUDE.md says its replies are kept "exactly". Until now that was a convention only. The S02E02 lesson (Building an Agent) has the harness enforce the journal, so the agent can read it but never rewrite it.

## Checked

On 2026-11-03, 13 scripted cases passed (overwrite, append, Edit, replace_all, MultiEdit, CRLF log, a path with forward slashes, a new lesson, other files). A live Edit on a throwaway `mega-s99e99/log.txt` was denied for a rewrite and allowed for an append.

## Decided by

The human, 2026-11-03, from the S02E02 brief's "Try today".
