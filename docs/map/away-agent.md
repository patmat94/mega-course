# away-agent

## Role

The S02E05 Worker. The course sends signed messages to `POST /course`; it answers them, does free acts alone, and holds gated acts (`release_hold`, `rotate_key`) behind a hold form at `/hold/<id>` that needs the owner's code. It pings the human's phone through ntfy. Built before `lib/wake/`; new Workers start from wake-demo instead (ADR 0009).

## How to get there

- URL: https://away-agent.patrykmatychniak.workers.dev — `GET /` (health), `POST /course` (signed), `/hold/<id>` (owner's code), admin routes `/log`, `/status`, `/holds`, `/reqs`, `/reprocess`, `/testping`, `/reping`, `/window` (admin token as `?admin=` in the URL)
- Source: `mega-s02e05/away-agent/src/` — `index.js` (routes), `check.js`, `policy.json` (which acts are free and which are gated)
- Config: `mega-s02e05/away-agent/wrangler.toml` — KV `STATE`, var `NTFY_TOPIC`
- Secrets: `SIGNING_KEY`, `ADMIN_TOKEN`, `NTFY_TOKEN` on Cloudflare; locally `.dev.vars` and `.admin-token` (both git-ignored) and `.signing-key`
- Deploy: `npx --no-install wrangler deploy` in `mega-s02e05/away-agent`

## How to verify

1. **Probe, no token, changes nothing.** `GET /` → 200 `away-agent: up`; `GET /log` with no admin token → 404. Pass: both. Last run 2026-11-12: passed (receipt below).
2. **Local end to end.** Start `wrangler dev` (port 8787), then `node test/e2e.mjs` in `mega-s02e05/away-agent`. It signs with a local test key and sinks replies on 127.0.0.1:8799.
3. **Live push — reaches the human's phone; ask first.** `POST /testping` with the admin token, then read `/log`.

## Keep in mind

- the ntfy topic is a plain var in mega-s02e05/away-agent/wrangler.toml, which is committed to the public repo patmat94/mega-course, while wake-demo keeps the same topic as a secret because the repo is public; anyone who reads the file can read or push to that topic unless the topic is protected by a token · source: mega-s02e05/away-agent/wrangler.toml:14 · how: read
- a ntfy push from the away-agent Worker, run in ctx.waitUntil after the reply, can fail with no trace; direct re-pings from the Worker got 429 and 522 for about 12 minutes before a 200 · source: mega-s02e05/log.txt:186 · how: ran

### Receipts

command: How to verify step 1 (PowerShell Invoke-WebRequest, no token or signature; body text cut to 160 characters)
```
GET https://away-agent.patrykmatychniak.workers.dev/ -> 200 away-agent: up
GET https://away-agent.patrykmatychniak.workers.dev/log -> 404 
```

command: node loop POST /reping on away-agent every 30 s (admin token <secret removed>)
```
2026-11-09T15:45:22.155Z [{"act":"release_hold","status":522}]
2026-11-09T15:46:41.138Z [{"act":"release_hold","status":522}]
2026-11-09T15:48:00.256Z [{"act":"release_hold","status":522}]
2026-11-09T15:49:39.067Z [{"act":"release_hold","status":522}]
2026-11-09T15:50:53.556Z [{"act":"release_hold","status":200}]
```
