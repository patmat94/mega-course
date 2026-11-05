# 0006 · Tool servers: measure every result, and let access be taken back

## Decision

Every tool server built here (an MCP server, a Worker that agents call, any tool a model reads results from) does these two things before it is called done:

1. **Measure each tool's whole result on the live server.** The end-to-end test calls every tool on the deployed address, measures the whole result object the client receives (content, structuredContent, `_meta` and the rest, not only the payload), and fails when any result is over the budget. The default budget is 1024 B; a Challenge or a client that sets its own limit replaces it. The server also logs each result's tool name and size (never its arguments), so an over-budget call shows in the logs after deploy. This runs before the first claim or hand-off, not after a refusal.
2. **Give a way to take access back without a database edit.** A server with sign-in has a revoke route for clients (RFC 7009 `/revoke`, advertised as `revocation_endpoint`) and a place where the owner sees who holds access and ends it (for example a `/grants` page behind the owner passphrase). Revoking one token ends every token of that approval. The end-to-end test checks that a revoked token gets 401 and that its refresh token is refused.

When a change adds fields to a tool's result, add them to its outputSchema in the same deploy, and reconnect every client that is already connected (a new Claude Code session, or /mcp → reconnect). A client keeps the schema it loaded, and with `additionalProperties: false` it rejects every result that carries the new fields (`mega-s02e03/log.txt:90`).

The reference build is tool-home: `mega-s02e03/tool-home/test/e2e.mjs` (sections 9 and 10), `src/oauth.ts` (revoke, grants page) and `src/mcp.ts` (result-size log).

The rule lives in AGENTS.md under Principles.

## Why

In S02E03 the course refused the first check of tool-home because a whole transcribe result was 1384 B against a 1024 B cap. Only the payload had been looked at, while the course counts every byte the model receives (`mega-s02e03/log.txt`, claim 2). After the solve the course still held a grant on the server, and the only way to end it was to delete rows in the D1 `grants` table by hand. The S02E03 debrief's "Next time" named both.

## Decided by

The human, 2026-11-05, from the S02E03 debrief's takeaway: "I want it also add it as behaviour in future tools".
