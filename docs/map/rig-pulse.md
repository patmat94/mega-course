# rig-pulse

## Role

The S01E05 Worker. The course sends it signed pings (Standard Webhooks headers); it declares two agents in `/.well-known/mega-pulse.json`: `pulse` (reads the live tracker and answers with phrase, open issue and recommendation; may `answer` only) and `test-writer` (calls Claude to write a failing test for the cited bug; may `test` only). Caller: the course.

## How to get there

- URL: https://rig-pulse.patrykmatychniak.workers.dev — `GET /.well-known/mega-pulse.json` (manifest, public), `POST /` (signed ping)
- Source: `mega-s01e05/pulse-agent/src/index.ts`
- Config: `mega-s01e05/pulse-agent/wrangler.toml` (no bindings)
- Secrets: `PING_KEY`, `ANTHROPIC_API_KEY`, on Cloudflare only (`mega-s01e05/outcome.md`)
- Deploy: `npx --no-install wrangler deploy` in `mega-s01e05/pulse-agent`
- Cost: each accepted ping can call the Anthropic API.

## How to verify

1. **Probe, no signature, changes nothing.** `GET /.well-known/mega-pulse.json` → 200 with `pulse` may `["answer"]` and `test-writer` may `["test"]`; `POST /` with no webhook headers → 400. Pass: both. Last run 2026-11-12: passed (receipt below).
2. **Type check, offline.** `npm run typecheck` in `mega-s01e05/pulse-agent`. There are no tests.
3. **A signed ping** needs `PING_KEY`, which is only on Cloudflare, so only the course can send one.

## Keep in mind

- set each agent's may-only to exactly what it does; permissions are checked before pings are sent, so any extra action blocks all progress · source: human · how: told

### Receipts

command: How to verify step 1 (PowerShell Invoke-WebRequest, no token or signature; body text cut to 160 characters)
```
GET https://rig-pulse.patrykmatychniak.workers.dev/.well-known/mega-pulse.json -> 200 {"owner":"own-3dbe522d7ed13d7d","agents":{"pulse":{"wakes":"pulse","may":["answer"]},"test-writer":{"wakes":"test","may":["test"]}}}
POST https://rig-pulse.patrykmatychniak.workers.dev/ -> 400 
```
