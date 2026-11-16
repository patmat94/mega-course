# tool-home

## Role

MCP server built in S02E03. Keeps notes (memo_write, memo_search), stores files behind public links (upload) and transcribes audio from a link (transcribe, Whisper on Workers AI). Callers: this repo's Claude Code sessions (MCP server `tool-home`, local scope of mega-course) and the course, which holds a grant. Sign-in is OAuth with an owner passphrase; access can be taken back without a database edit.

## How to get there

- URL: https://tool-home.patrykmatychniak.workers.dev/mcp (plan page at `/plan`, owner page at `/grants`, clients revoke at `/revoke`)
- Source: `mega-s02e03/tool-home/` — `src/index.ts` (routes), `src/oauth.ts` (sign-in, grants), `tools/*.tool.md` (one contract per tool, the source for `src/contracts.json`)
- Config: `mega-s02e03/tool-home/wrangler.toml` — D1 database `tool-home`, Workers AI binding, `ALLOWED_ORIGINS`
- Secrets: owner passphrase in `mega-s02e03/tool-home/.dev.vars` (git-ignored) and on Cloudflare
- Deploy: `npm run deploy` in the folder (checks the contracts first, then `wrangler deploy`; wrangler is a local package)

## How to verify

1. **Probe, no sign-in, changes nothing.** From PowerShell:
   `Invoke-WebRequest https://tool-home.patrykmatychniak.workers.dev/plan` → 200, and a POST to `/mcp` with no token → 401 with a `www-authenticate: Bearer ...` header. Pass: both. Shows the Worker is up and sign-in is still on. Last run 2026-11-16: the GET passed; the POST with no token was not sent, because the Claude Code auto-mode classifier refused the probe call (receipt below). Last full pass 2026-11-12.
2. **Every tool against its contract, signed in.** In `mega-s02e03/tool-home`: `npm run check-tools -- https://tool-home.patrykmatychniak.workers.dev --yes`. Signs in through `test/stdio-proxy.mjs` with the passphrase, calls each tool with its good and wrong samples, revokes its token at the end. Pass: exit 0. Writes a sample memo and spends a little Workers AI on transcribe.
3. **End to end.** `node test/e2e.mjs` in the same folder (read it first for its target and what it writes).

## Agreement

Proposed by the agent on 2026-11-14 from this file and the lesson records; the human has not signed it yet.

- **Should do:** serve memo_write, memo_search, upload and transcribe to signed-in clients only, every tool result ≤1024 B; let the owner take access back at `/grants`.
- **Signal it works:** `/plan` → 200 and an unsigned `POST /mcp` → 401 with `www-authenticate: Bearer` (How to verify step 1); signed-in clients keep getting fresh access grants.
- **Turn off when:** the course no longer needs its grant and no session here lists `tool-home` as an MCP server. Revoke the course's grant at `/grants` first, then delete. Until then it stays.

## Last week (2026-11-07 to 2026-11-14), read on 2026-11-14

- Source: read-only counts with `wrangler d1 execute tool-home --remote`.
- Memos: none written this week (25 in all, newest 2026-11-05T09:47Z).
- Files: 5 uploads on 2026-11-10 between 11:15Z and 11:28Z (323270, 228375, 517, 323270, 517 B): the S03E01 pack.
- Grants: access grants expiring on 11-09, 11-10, 11-11, 11-12 and 11-14, and one refresh grant expiring 2026-12-14, so a client signed in or refreshed today. Expired access rows stay in the table: nothing prunes them.
- No new OAuth clients since 2026-11-05. Live version 314f4d2b, created 2026-11-05.

## Keep in mind

- the S02E03 MCP server tool-home is deployed at https://tool-home.patrykmatychniak.workers.dev/mcp and added to Claude Code as tool-home, local scope of mega-course · source: mega-s02e03/log.txt:30 · how: read
- in S02E03 the course caps a whole tools/call result at 1024 B and refuses tool errors that do not name the bad input and say what is wrong with it · source: mega-s02e03/log.txt:41 · how: read
- in S02E03 the course hands an 8.5 MB file to upload; it cannot pass through a model as a tool argument, so tool-home's upload returns a one-time PUT upload_url when content is left out · source: mega-s02e03/log.txt:57 · how: read
- tool-home's upload no longer takes file contents: it always returns upload_url for one HTTP PUT · source: mega-s02e03/tool-home/tools/upload.tool.md:15 · how: read
- a Claude Code session keeps the tool schemas it loaded at start: after tool-home's memo_search output gained fields (outputSchema has additionalProperties false), this session's call was rejected, while a fresh `claude -p` got the new schema and worked; reconnect clients after an output schema changes · source: mega-s02e03/log.txt:90 · how: ran
- tool-home has an owner page /grants (passphrase) to take a client's access back, and /revoke for clients; no database edit needed · source: mega-s02e03/log.txt:85 · how: read
- the hands skill (version 1451720afc1f) is installed in .claude/skills/hands/; its check-tool.mjs does not sign in, so tool-home is checked through test/stdio-proxy.mjs (npm run check-tools -- <base-url> --yes) · source: mega-s02e03/log.txt:94 · how: ran
- tool-home transcribe (Whisper) wrote the S03E01 memo tag at 34 s as "RH-5-H"; the human listened and heard RZ-5-H (R-Z5H); a second run gave the same wrong text, so spoken tags need a human ear when a claim says unknown_tag · source: human · how: told

### Receipts

command: How to verify step 1, 2026-11-16, GET only (PowerShell Invoke-WebRequest, GET /plan, then POST /mcp with a tools/list body and no token)
```
GET https://tool-home.patrykmatychniak.workers.dev/plan -> 200 <!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"> <title>Tool Home — plan</title><s
```

from: mcp__tool-home__memo_search {query:""} in this Claude Code session, after deploy 5707f363
```
Structured content does not match the tool's output schema: data must NOT have additional properties, data must NOT have additional properties, data/notes/0 must NOT have additional properties
```
