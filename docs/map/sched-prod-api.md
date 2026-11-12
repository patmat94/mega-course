# sched-prod-api

## Role

The S03E03 incidents API, built by the unattended agent during the round. Serves production's incidents from the course feed to the status page, the on-call board and the support console: `GET /incidents` (with `?status=` and `?since=`), `GET /incidents/{id}`; every incident carries a read-only `suggestions` list (record 0007, option 2; always `[]` while the feed gives none).

## How to get there

- URL: https://sched-prod-api-production.patrykmatychniak.workers.dev — anything else is 404 `{"error":"not found"}`
- Source: `mega-s03e03/sched-prod-api/src/index.js` (local git, never pushed; git-ignored here); contract in `contract/api.md`
- Config: `mega-s03e03/sched-prod-api/wrangler.toml` — `[env.production.vars] FEED_URL` (the round's feed)
- Secrets: none. The starter's `.dev.vars.example` holds a production admin token; never bind or use it.
- Deploy: `npx --no-install wrangler deploy --env production` in `mega-s03e03/sched-prod-api`
- Agent: `mega-s03e03/agent/watch.mjs` (stopped after the round); tracker token in `mega-s03e03/receipts.json`

## How to verify

1. **Probe, changes nothing.** `node mega-s03e03/agent/livecheck.mjs /incidents /incidents/INC-6948 /nope` → 200, 200, 404. Last run 2026-11-12: passed (`mega-s03e03/log.txt`, final poll).

## Keep in mind

- the S03E03 Worker sched-prod-api-production is deployed and reads the round's feed live; undo with `npx --no-install wrangler delete --env production` · source: mega-s03e03/log.txt (wrangler deploy) · how: ran
