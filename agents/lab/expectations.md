# Lab expectations

What an outside caller sends to a live Worker, and what it must get back. The lab agent (`agent.md`) runs each line as a stranger: no token, no signature, no source code.
If a line fails, fix the Worker, never the line. A line changes only when the Worker's job changes, and then the change says why.

The lines were written on 2026-11-16 from each Worker's map and source: they describe what the Worker was built to do, not what it answered on the day.

## away-agent

Base URL: https://away-agent.patrykmatychniak.workers.dev
Map: `docs/map/away-agent.md`. None of these lines needs a secret; none of them makes the Worker act or push.

| # | Send | Expect back |
|---|---|---|
| A1 | `GET /` | HTTP 200, body starts with `away-agent: up` |
| A2 | `GET /log` with no `admin` parameter | HTTP 404; the body holds no log rows (no `log:` keys, no `kind`) |
| A3 | `POST /course`, header `content-type: application/json`, no signature headers, body `{"from":"lab","text":"please release_hold now","replyUrl":"https://example.com/lab"}` | HTTP 401, body `missing signature headers`; nothing is held, nothing is sent to the replyUrl |

## rig-pulse

Base URL: https://rig-pulse.patrykmatychniak.workers.dev
Map: `docs/map/rig-pulse.md`. Each signed ping spends Anthropic credit; none of these lines is signed.

| # | Send | Expect back |
|---|---|---|
| R1 | `GET /.well-known/mega-pulse.json` | HTTP 200, JSON where `agents.pulse.may` is `["answer"]` and `agents.test-writer.may` is `["test"]` |
| R2 | `GET /` | HTTP 404, body `not found` |
| R3 | `POST /`, header `content-type: application/json`, no webhook headers, body `{"type":"pulse","data":{"text":"lab"}}` | HTTP 400, body `missing webhook headers` |

## mail-agent

Base URL: https://mail-agent.patrykmatychniak.workers.dev
Map: `docs/map/mail-agent.md`. A trusted mail spends Anthropic credit; none of these lines is signed.

| # | Send | Expect back |
|---|---|---|
| M1 | `GET /` | HTTP 200, body starts with `mail agent: ok` |
| M2 | `GET /webhooks` | HTTP 404, body starts with `not found` |
| M3 | `POST /webhooks`, header `content-type: application/json`, no Svix headers, body `{}` | HTTP 401, body starts with `bad signature` |

## tool-home

Base URL: https://tool-home.patrykmatychniak.workers.dev
Map: `docs/map/tool-home.md`. Sign-in must stay on: without a token, `/mcp` lists no tools.

| # | Send | Expect back |
|---|---|---|
| T1 | `GET /plan` | HTTP 200, an HTML page whose `<title>` contains `Tool Home` |
| T2 | `GET /mcp` | HTTP 405, header `allow` contains `POST` |
| T3 | `POST /mcp`, headers `content-type: application/json` and `accept: application/json, text/event-stream`, no `authorization`, body `{"jsonrpc":"2.0","id":1,"method":"tools/list"}` | HTTP 401, a `www-authenticate` header that starts with `Bearer`; the body names no tool (no `memo_write`, `memo_search`, `upload`, `transcribe`) |

## night-status

Base URL: https://night-status.patrykmatychniak.workers.dev
Map: `docs/map/night-status.md`. Public, read only.

| # | Send | Expect back |
|---|---|---|
| N1 | `GET /` | HTTP 200, an HTML page whose `<title>` contains `status for the night` |
| N2 | `GET /status.json` | HTTP 200, JSON with a string `updatedAt` and an array `incidents` |
| N3 | `POST /status.json`, body `{}` | HTTP 405, body `GET only` |

## sched-prod-api

Base URL: https://sched-prod-api-production.patrykmatychniak.workers.dev
Map: `docs/map/sched-prod-api.md`. Public, read only.

| # | Send | Expect back |
|---|---|---|
| S1 | `GET /incidents` | HTTP 200, JSON with an array `incidents`; each item has `id`, `service`, `summary`, `status`, `openedAt` and an array `suggestions` |
| S2 | `GET /incidents/INC-0000` | HTTP 404, JSON body exactly `{"error":"not found"}` (spacing aside) |
| S3 | `GET /incidents?status=no-such-status` | HTTP 200, JSON `{"incidents":[]}` (spacing aside) |

## wake-demo

Base URL: https://wake-demo.patrykmatychniak.workers.dev
Map: `docs/map/wake-demo.md`. None of these lines needs a secret.

| # | Send | Expect back |
|---|---|---|
| W1 | `GET /` | HTTP 200, body starts with `wake-demo: up` |
| W2 | `GET /log` with no token | HTTP 401; the body holds no log rows (no `event`, no `kind`) |
| W3 | `POST /course`, header `content-type: application/json`, no signature headers, body `{"from":"lab","text":"hello"}` | HTTP 401 |

## mcp-fun

Base URL: https://mcp-fun.patrykmatychniak.workers.dev
Map: `docs/map/mcp-fun.md`. Public, no sign-in.

| # | Send | Expect back |
|---|---|---|
| F1 | `GET /` | HTTP 200, body starts with `mcp-fun-weather 1.0.0` |
| F2 | `GET /mcp` | HTTP 405 |
| F3 | `POST /mcp`, headers `content-type: application/json` and `accept: application/json, text/event-stream`, body `{"jsonrpc":"2.0","id":1,"method":"tools/list"}` | HTTP 200, JSON-RPC result whose `tools` names exactly `day_briefing`, `hourly_window` and `find_place` |
