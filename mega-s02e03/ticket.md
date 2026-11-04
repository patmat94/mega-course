# S02E03 · schema first · our own remote MCP server passes the course's stranger check

## Outcome

A remote MCP server of our own runs over https at a public address, with four tools: memo_write, memo_search, upload, transcribe. Only those we let in can use it (OAuth). The course calls it as a stranger, the human lets the course in through the connect link, and every check passes. The server is ours to keep and grow.

## Scope

- New server in `mega-s02e03/` (stack to decide; Cloudflare Worker fits what we already run).
- Current MCP revision (Streamable HTTP), optionally the previous one too. Spec: https://modelcontextprotocol.io/specification
- OAuth sign-in; protected resource metadata names a plan page as `resource_documentation`, on the same host.
- Plan page: what the tools do, how sign-in works, what data is kept.
- Connect the server to our own harness (Claude Code).
- Claim with `{ "server": "https://<host>/mcp" }`, then save the `note` proof with memo_write before the human opens the connect link, then claim with `{ "noteA": "<code>" }`.

## Out of scope

- Changing the existing Workers (mail-agent, rig-pulse, mcp-fun).
- Paid transcription keys without the human's yes.

## Acceptance

- [x] Server reachable over https at a public address; `/mcp` answers the current MCP revision (2026-07-28, stateless; server/discover) and 2025-11-25 initialize. (e2e 35/35 on live URL)
- [x] Unauthenticated call gets 401 with a WWW-Authenticate pointing to protected resource metadata.
- [x] Protected resource metadata has `resource_documentation` = plan page on the same host; the page loads and covers tools, sign-in and kept data.
- [x] tools/list shows memo_write, memo_search, upload, transcribe, each with an outputSchema.
- [x] memo_write { text } → { id }; memo_search { query } → { notes: [{ id, text }] } — as structuredContent matching the schema.
- [x] upload → { url }; the url is on our server and opens without sign-in.
- [x] transcribe { url } → { segments: [{ start, text }] }, start in seconds, tested on a real audio file.
- [x] Server connected to our own Claude Code and a tool called from it. (claude mcp list: Connected; claude -p memo_search returned notes)
- [x] `note` proof (newest one from the latest claim) saved with memo_write before the human opens the connect link. (memo_hLpsXpI7o8ix8iar)
- [x] Whole tools/call result for transcribe ≤ 1024 B on a short clip (content + structuredContent + rest), measured on the live server. (calibration: 738 B)
- [x] Every transcribe error names the url and says what is wrong (web page, 404, undecodable audio).
- [x] Every outside action (deploy, account, paid key) had the user's yes first.
- [x] Tickets and tokens are masked in `log.txt`; the raw ones are only in `receipts.json`.
- [x] Course log file uploaded with our upload tool, lane line as its own first line, rest byte-identical; public link checked (200, 8483630 B, identical).
- [x] noteA read from the newest course note (source "MEGA course check", 23:10:32Z) with our own memo tool via Claude Code.
- [ ] claim with noteA returns solved (after claim)

## Notes

- Claim 2 refused (log.txt "claim 2"): the course caps a whole tool result at 1024 B and wants tool errors that name the bad input and say what is wrong. Added both to Acceptance.
- "A stranger will call it": the course is a separate OAuth client; it must be able to register (dynamic client registration) and get the human's approval. Source: start-challenge `build`, `submit.how`.
