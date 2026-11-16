worker: sched-prod-api · base URL: https://sched-prod-api-production.patrykmatychniak.workers.dev · run: 2026-11-16T18:49Z (UTC)
- S1 · pass · tried GET /incidents · expected 200, array incidents, each with id, service, summary, status, openedAt, array suggestions · got 200 {"incidents":[{"id":"INC-6948","service":"booking-api","summary":"reminder mails delayed","status":"open","openedAt":"2026-11-11T02:38:00.000Z","suggestions":[]},... (12 items, 0 missing a field)
- S2 · pass · tried GET /incidents/INC-0000 · expected 404 {"error":"not found"} · got 404 {"error":"not found"}
- S3 · pass · tried GET /incidents?status=no-such-status · expected 200 {"incidents":[]} · got 200 {"incidents":[]}
result: 3 of 3 passed

