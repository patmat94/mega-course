worker: mail-agent · base URL: https://mail-agent.patrykmatychniak.workers.dev · run: 2026-11-16T18:49Z (UTC)
- M1 · pass · tried GET / · expected 200, body starts `mail agent: ok` · got 200 mail agent: ok
- M2 · pass · tried GET /webhooks · expected 404, body starts `not found` · got 404 not found
- M3 · pass · tried POST /webhooks content-type application/json, no Svix headers, body {} · expected 401, body starts `bad signature` · got 401 bad signature
result: 3 of 3 passed

