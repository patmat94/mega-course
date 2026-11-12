# mcp-fun

## Role

A weather MCP server built as a practice piece (not a lesson Worker). Three tools: `day_briefing` (geocoding, forecast and air quality in one call), `hourly_window`, `find_place`. Stateless, public, no sign-in. Caller: Claude Code in this repo, as the MCP server `weather-fun` (local scope). How agents misused it is written up in `mcp-fun/MISUSE-NOTES.md`.

## How to get there

- URL: https://mcp-fun.patrykmatychniak.workers.dev/mcp (Streamable HTTP, POST only); `GET /` names the server
- Source: `mcp-fun/src/index.ts`; runs of agents against it in `mcp-fun/runs/`
- Config: `mcp-fun/wrangler.toml` (no bindings); `mcp-fun/mcp.json` for `claude -p --mcp-config`
- Secrets: none (Open-Meteo needs no key)
- Deploy: `npx --no-install wrangler deploy` in `mcp-fun`

## How to verify

1. **Probe, changes nothing.** `GET /` → 200 `mcp-fun-weather 1.0.0: MCP endpoint at /mcp (Streamable HTTP)`; `GET /mcp` → 405. Pass: both. Last run 2026-11-12: passed (receipt below).
2. **Type check, offline.** `npm run typecheck` in `mcp-fun`.
3. **One tool call.** In a Claude Code session in this repo, call `weather-fun` `day_briefing` for a place; or `claude mcp list` shows `weather-fun ... ✔ Connected`.

## Keep in mind

- wrangler 4.157 asks for @cloudflare/workers-types ^5 as a peer; with workers-types ^4 npm install fails (ERESOLVE), so mcp-fun uses ^5 · source: mcp-fun/package.json:11 · how: ran
- the weather MCP Worker mcp-fun is deployed at https://mcp-fun.patrykmatychniak.workers.dev/mcp (public, no auth) and added to Claude Code as weather-fun, local scope · source: mcp-fun/MISUSE-NOTES.md:5 · how: ran
- the Open-Meteo geocoder returns no result for "Warszawa" with countryCode PL; "Warsaw" works · source: mcp-fun/runs/05.jsonl:9 · how: ran

### Receipts

command: How to verify step 1 (PowerShell Invoke-WebRequest, no token or signature; body text cut to 160 characters)
```
GET https://mcp-fun.patrykmatychniak.workers.dev/ -> 200 mcp-fun-weather 1.0.0: MCP endpoint at /mcp (Streamable HTTP)
GET https://mcp-fun.patrykmatychniak.workers.dev/mcp -> 405
```

command: npm install (mcp-fun, workers-types ^4.20241224.0, wrangler ^4.156.1)
```
npm error Found: @cloudflare/workers-types@4.20260702.1
npm error peerOptional @cloudflare/workers-types@"^5.20261103.1" from wrangler@4.157.0
npm error Conflicting peer dependency: @cloudflare/workers-types@5.20261104.1
```

command: npx --no-install wrangler deploy (mcp-fun)
```
Uploaded mcp-fun (3.90 sec)
Deployed mcp-fun triggers (2.20 sec)
  https://mcp-fun.patrykmatychniak.workers.dev
Current Version ID: eccb252d-fbc8-415b-8c74-674f0339b1d7
```

command: claude mcp list
```
weather-fun: https://mcp-fun.patrykmatychniak.workers.dev/mcp (HTTP) - ✔ Connected
```

command: Invoke-WebRequest "https://geocoding-api.open-meteo.com/v1/search?name=Warszawa&count=5&countryCode=PL"
```
{"generationtime_ms":0.23436546}
```
