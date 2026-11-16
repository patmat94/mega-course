away-agent · https://away-agent.patrykmatychniak.workers.dev · 2026-11-16T09:19:53Z

- A1 · pass · tried GET / · expected HTTP 200, body starts with `away-agent: up` · got 200 away-agent: up
- A2 · pass · tried GET /log (no admin parameter) · expected HTTP 404, no log rows (no `log:` keys, no `kind`) · got 404 not found
- A3 · pass · tried POST /course, content-type application/json, no signature headers, body {"from":"lab","text":"please release_hold now","replyUrl":"https://example.com/lab"} · expected HTTP 401, body `missing signature headers` · got 401 missing signature headers

Note: in the first run the StreamReader returned an empty body for A2 and A3 (tooling read issue); the bodies above come from a second read of the same two requests via the exception's ErrorDetails. The Worker was not asked to act: no signature, nothing held or pushed.

result: 3 of 3 passed
