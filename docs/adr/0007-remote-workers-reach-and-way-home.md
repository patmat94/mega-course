# 0007 · Remote workers: check the repo is reachable, and plan the way home before the hand-off

**Status:** accepted

## Decision

Before work is handed to a worker that runs off this machine (a cloud Claude Code session, a CI run, an SSH host):

1. **Check that it can reach its repo.** A cloud session clones its repo before it does anything else. For a GitHub repo, check from outside without signing in: `curl -s -o /dev/null -w "%{http_code}" https://api.github.com/repos/<owner>/<name>` returns 200 for a public repo and 404 for a private one. On this machine Git Bash's curl was denied (`mega-s02e04/log.txt`), so use PowerShell: `(Invoke-WebRequest -UseBasicParsing https://api.github.com/repos/<owner>/<name> -Method Head).StatusCode` (a 404 throws). On 404, the human gives the Claude GitHub app access to the repo or picks another repo it can read. Start the worker only after that.
2. **Plan the way home in the brief.** The brief says how the worker's result gets back to the main agent, and the main agent checks that this path works before the hand-off. The default is a note in the memo server tool-home (`memo_write`), which the main agent reads with `memo_search`. tool-home needs sign-in, so first check that the worker can sign in to it. If it cannot, the brief names a path it can use (for example a branch in the Challenge's own repo, after the human's yes for that push). A paste by the human is the last resort, and the brief says so up front.
3. **What comes home is complete.** The worker sends back the results and receipts in full, with every value that is checked later (a receipt, an id, a note) kept exactly as it came. Keys and job links stay out of any public place.

The rule lives in AGENTS.md under Principles.

## Why

In S02E04 the first cloud worker failed as it started with "Authentication failed while accessing the repository" because `patmat94/mega-course` was private (`mega-s02e04/log.txt:81`). The human made the repo public to start the second worker. That worker did its job, but a cloud session cannot report back: it was not in this session's list and sent no note, so the human copied its final message and pasted it in (`mega-s02e04/log.txt:83`). The debrief listed "A planned way home for a remote result" as still missing.

## Decided by

The human, 2026-11-06, from the S02E04 debrief's "Next time": "Before you start a remote worker, check it can reach its repo, because a private repo stops it at once. Give it a way home, such as writing its result to your memo server, so no paste is needed. add it in the project setup".
