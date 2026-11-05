# 0006 · Tool servers: build every tool with the hands skill, and let access be taken back

## Decision

Every tool an agent calls that is built or changed here (an MCP tool, a Worker tool, a wrapped CLI, script or API) follows the **hands** skill, `.claude/skills/hands/` (version 1451720afc1f, from the S02E03 artifact):

1. **A TOOL.md per tool, before the code.** Name, description, input and output schemas, one byte budget for the whole result, an errors table, side effects, and good and wrong samples. The default budget is 1024 B; a Challenge or a client that sets its own limit replaces it. The `Ask:` answers come from the human, or from a source the line names.
2. **The code is built to it.** The contract changes first, then the code. Where the build allows, the server reads its schemas and descriptions from the TOOL.md files (tool-home: `npm run contracts` writes `src/contracts.json`, and `typecheck` and `deploy` refuse a stale copy), so the two cannot drift.
3. **`check-tool.mjs --yes` exits 0 against the running tool, on the live address, before the first claim or hand-off.** It measures the whole result against the budget, validates `structuredContent`, and checks that each wrong call comes back with `isError: true`, its field first, and what to send next.
4. **Sign-in stays on.** check-tool does not sign in. A server behind sign-in gets a stdio entry that signs in the normal way and revokes its token when it ends (tool-home: `test/stdio-proxy.mjs`). Never add a switch that turns sign-in off.

Two things hands does not cover stay part of this decision:

5. **Access can be taken back without a database edit.** A server with sign-in has a revoke route for clients (RFC 7009 `/revoke`, advertised as `revocation_endpoint`) and an owner page that lists who holds access and ends it (tool-home: `/grants`, behind the owner passphrase). Revoking one token ends every token of that approval. Its end-to-end test checks that a revoked token gets 401 and its refresh token is refused.
6. **A changed result schema means reconnecting clients.** A client keeps the schema it loaded, and with `additionalProperties: false` it rejects every result that carries a new field (`mega-s02e03/log.txt:90`). Deploy the schema and the code together, then reconnect every connected client (a new Claude Code session, or /mcp → reconnect).

The reference build is tool-home: `mega-s02e03/tool-home/tools/*.tool.md`, `scripts/contracts.mjs`, `scripts/check-tools.mjs` (`npm run check-tools -- <base-url> --yes`), `test/stdio-proxy.mjs`, and `src/oauth.ts` for revoke and `/grants`.

The rule lives in AGENTS.md under Principles.

## Why

In S02E03 the course refused the first check of tool-home because a whole transcribe result was 1384 B against a 1024 B cap, and its errors did not name the url (`mega-s02e03/log.txt:41`). Only the payload had been looked at, while the course counts every byte the model receives. After the solve the course still held a grant on the server, and the only way to end it was to delete rows in the D1 `grants` table by hand. The S02E03 debrief's "Next time" named both.

The first version of this decision (same day) asked each server's own end-to-end test to measure every result. The hands skill does that and more with one shared checker and one contract format, so the project uses it instead of a rule each server re-implements. Its first run on tool-home asked for changes that the hand-made rule had missed: upload took file contents as base64 in its arguments (rule 4), errors did not start with the field (rule 5), transcribe could be pointed at a local or private address (rule 9), and two tools sent plain text instead of the JSON (rule 2).

## Decided by

The human, 2026-11-05: first from the S02E03 debrief's takeaway ("I want it also add it as behaviour in future tools"), then "change the ADR 0006 so project will use skill instead, and change tool-home accordingly".
