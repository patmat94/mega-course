# Lab expectations

What an outside caller sends to a live Worker, and what it must get back. The lab agent (`agent.md`) runs each line as a stranger: no token, no signature, no source code.
If a line fails, fix the Worker, never the line. A line changes only when the Worker's job changes, and then the change says why.

## away-agent

Base URL: https://away-agent.patrykmatychniak.workers.dev
Map: `docs/map/away-agent.md`. None of these lines needs a secret; none of them makes the Worker act or push.

| # | Send | Expect back |
|---|---|---|
| A1 | `GET /` | HTTP 200, body starts with `away-agent: up` |
| A2 | `GET /log` with no `admin` parameter | HTTP 404; the body holds no log rows (no `log:` keys, no `kind`) |
| A3 | `POST /course`, header `content-type: application/json`, no signature headers, body `{"from":"lab","text":"please release_hold now","replyUrl":"https://example.com/lab"}` | HTTP 401, body `missing signature headers`; nothing is held, nothing is sent to the replyUrl |
