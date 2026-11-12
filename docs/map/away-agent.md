# away-agent

## Role

The S02E05 Worker. The course sends signed messages to `POST /course`; it answers them, does free acts alone, and holds gated acts (`release_hold`, `rotate_key`) behind a hold form at `/hold/<id>` that needs the owner's code. It pings the human's phone through ntfy. Built before `lib/wake/`; new Workers start from wake-demo instead (ADR 0009).

## How to get there

- URL: https://away-agent.patrykmatychniak.workers.dev — `GET /` (health), `POST /course` (signed), `/hold/<id>` (owner's code), admin routes `/log`, `/status`, `/holds`, `/reqs`, `/reprocess`, `/testping`, `/reping`, `/window` (admin token as `?admin=` in the URL)
- Source: `mega-s02e05/away-agent/src/` — `index.js` (routes), `check.js`, `policy.json` (which acts are free and which are gated)
- Config: `mega-s02e05/away-agent/wrangler.toml` — KV `STATE`, no vars
- Secrets: `SIGNING_KEY`, `ADMIN_TOKEN`, `NTFY_TOKEN`, `NTFY_TOPIC` on Cloudflare; locally `.dev.vars` (holds `NTFY_TOPIC`), `.admin-token` and `.signing-key`, all git-ignored
- Deploy: `npx --no-install wrangler deploy` in `mega-s02e05/away-agent`

## How to verify

1. **Probe, no token, changes nothing.** `GET /` → 200 `away-agent: up`; `GET /log` with no admin token → 404. Pass: both. Last run 2026-11-12: passed (receipt below).
2. **Local end to end.** Start `wrangler dev` (port 8787), then `node test/e2e.mjs` in `mega-s02e05/away-agent`. It signs with a local test key and sinks replies on 127.0.0.1:8799.
3. **Live push — reaches the human's phone; ask first.** `POST /testping` with the admin token, then read `/log`.

## Keep in mind

- until 2026-11-12 the ntfy topic was a plain var in the committed wrangler.toml of the public repo, so anyone could read or push to it; on 2026-11-12 it was rotated to a new topic kept only as the secret NTFY_TOPIC (and as wake-demo's NTFY_URL), and the old topic, still in git history, is retired · source: mega-s02e05/away-agent/wrangler.toml:13 · how: ran
- after the rotation the human subscribed the phone to the new topic, dropped the old one, and confirmed that the "new topic check" push sent from the laptop (stored on ntfy.sh at 20:53:09Z on 2026-11-12) reached the phone · source: human · how: told
- a ntfy push from the away-agent Worker, run in ctx.waitUntil after the reply, can fail with no trace; direct re-pings from the Worker got 429 and 522 for about 12 minutes before a 200 · source: mega-s02e05/log.txt:186 · how: ran

### Receipts

command: How to verify step 1 (PowerShell Invoke-WebRequest, no token or signature; body text cut to 160 characters)
```
GET https://away-agent.patrykmatychniak.workers.dev/ -> 200 away-agent: up
GET https://away-agent.patrykmatychniak.workers.dev/log -> 404 
```

command: npx --no-install wrangler deploy, then node … | npx --no-install wrangler secret put NTFY_TOPIC, then wrangler secret list (mega-s02e05/away-agent, 2026-11-12)
```
Uploaded away-agent (5.80 sec)
Deployed away-agent triggers (1.92 sec)
  https://away-agent.patrykmatychniak.workers.dev
Current Version ID: 5ef638aa-0222-42d5-8565-72ef220d03b2
=== secret put
───────────────────────────────────────────────
🌀 Creating the secret for the Worker "away-agent"
✨ Success! Uploaded secret NTFY_TOPIC
=== list
    "name": "ADMIN_TOKEN",
    "name": "NTFY_TOKEN",
    "name": "NTFY_TOPIC",
    "name": "SIGNING_KEY",
```

command: node … | npx --no-install wrangler secret put NTFY_URL --name wake-demo, then wrangler secret list --name wake-demo (2026-11-12)
```
🌀 Creating the secret for the Worker "wake-demo"
✨ Success! Uploaded secret NTFY_URL
    "name": "ADMIN_TOKEN",
    "name": "NTFY_URL",
    "name": "SIGNING_KEY",
```

command: PowerShell POST https://ntfy.sh/<new topic> from the laptop (Title: new topic check), then GET /<new topic>/json?poll=1&since=1h (2026-11-12)
```
publish from PC -> 200
messages on the new topic in the last hour: 0
```

command: PowerShell GET https://ntfy.sh/<new topic>/json?poll=1&since=all, right after (2026-11-12)
```
status 200, 252 chars
message 20:53:09Z title=new topic check
```

command: PowerShell POST /testping?admin=<secret removed> on away-agent, first try after the rotation (2026-11-12)
```
testping -> 200 {"status":429,"token":true}
```

command: the same, second try (its time is the laptop's local clock, UTC+1, so 20:28:42Z)
```
21:28:42 testping -> 200 {"status":429,"token":true}
```

command: node loop POST /reping on away-agent every 30 s (admin token <secret removed>)
```
2026-11-09T15:45:22.155Z [{"act":"release_hold","status":522}]
2026-11-09T15:46:41.138Z [{"act":"release_hold","status":522}]
2026-11-09T15:48:00.256Z [{"act":"release_hold","status":522}]
2026-11-09T15:49:39.067Z [{"act":"release_hold","status":522}]
2026-11-09T15:50:53.556Z [{"act":"release_hold","status":200}]
```
