worker: night-status · base URL: https://night-status.patrykmatychniak.workers.dev · run: 2026-11-16T18:49Z (UTC)
- N1 · pass · tried GET / · expected 200 HTML, title contains `status for the night` · got 200 <!doctype html> ... <title>status for the night</title>
- N2 · pass · tried GET /status.json · expected 200 JSON, string updatedAt, array incidents · got 200 { "updatedAt": "2026-11-16T18:49:00Z", "incidents": [ { "id": "5214", "line": "sched-prod", ... (updatedAt is String, incidents is array)
- N3 · pass · tried POST /status.json body {} · expected 405 `GET only` · got 405 GET only
result: 3 of 3 passed

