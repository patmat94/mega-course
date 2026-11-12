# night-status

## Role

The S03E01 status page. Reads the course's ops feed live on each request and shows the incidents for the chosen range as a page (`/`) and as JSON (`/status.json`). For the on-call reader the morning after. `RANGE = "last-night"` was the human's choice when product left the range conflict open.

## How to get there

- URL: https://night-status.patrykmatychniak.workers.dev — `/` (page), `/status.json`; anything else is 404
- Source: `mega-s03e01/night-status/src/index.js` (`buildStatus`, `renderPage`)
- Config: `mega-s03e01/night-status/wrangler.toml` — vars `FEED_URL` (the course feed), `RANGE`
- Secrets: none
- Deploy: `npx --no-install wrangler deploy` in `mega-s03e01/night-status`

## How to verify

1. **Probe, changes nothing.** `GET /` → 200 HTML page; `GET /status.json` → 200 with `updatedAt` and `incidents`. Pass: both. Last run 2026-11-12: passed (receipt below).
2. **Unit tests, offline.** `npm test` in `mega-s03e01/night-status` (against `mega-s03e01/feed-1.json`).
3. **Live against the accepted list.** `node mega-s03e01/check-live.mjs` (GETs the page, status.json and the course feed; checks every accepted tag in `list.json`). Pass: 15/15, as at the solve.

## Keep in mind

- the S03E01 status page Worker night-status is deployed at https://night-status.patrykmatychniak.workers.dev and reads the ops feed live; RANGE=last-night was the human's choice · source: mega-s03e01/night-status/wrangler.toml:9 · how: ran

### Receipts

command: How to verify step 1 (PowerShell Invoke-WebRequest, no token or signature; body text cut to 160 characters)
```
GET https://night-status.patrykmatychniak.workers.dev/ -> 200 <!doctype html> <html lang="en"> <head> <meta charset="utf-8"> <meta name="viewport" content="width=device-width, initial-scale=1"> <title>status for the night<
GET https://night-status.patrykmatychniak.workers.dev/status.json -> 200 { "updatedAt": "2026-11-12T20:20:00Z", "incidents": [ { "id": "5214", "line": "sched-prod", "opened": "2026-10-12T03:48:00Z", "closed": "2026-10-12T04:04:00Z", 
```

command: npx --no-install wrangler deploy (mega-s03e01/night-status)
```
Uploaded night-status (3.37 sec)
Deployed night-status triggers (1.89 sec)
  https://night-status.patrykmatychniak.workers.dev
Current Version ID: 403b251f-3aac-43b9-801a-573a3369e950
```
