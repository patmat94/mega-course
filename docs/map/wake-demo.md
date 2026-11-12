# wake-demo

## Role

The shared wake module (`lib/wake/`, ADR 0009) wired into one deployed Worker. A signed call to `/course` gets 202; the job goes on a queue, and the consumer sends an ntfy push that retries until a 2xx, writing a log row per attempt. It is the starting point for any new Worker an outside service wakes. The human chose to keep it running (issue #10).

## How to get there

- URL: https://wake-demo.patrykmatychniak.workers.dev — `/` (health), `POST /course` (signed call), `/log` and `/revoke` (admin token)
- Source: `lib/wake/demo/src/index.ts`; the module itself in `lib/wake/`, contract in `lib/wake/WAKE.md`
- Config: `lib/wake/demo/wrangler.toml` — KV `wake-demo-kv`, queue `wake-demo-jobs` (producer and consumer)
- Secrets: `SIGNING_KEY`, `ADMIN_TOKEN`, `NTFY_URL` on Cloudflare and in `lib/wake/demo/.secrets.json` (git-ignored). The ntfy topic is the same as away-agent's; both were rotated to a new topic on 2026-11-12. `.secrets.json` also keeps the retired URL as `NTFY_URL_OLD`, for a rollback only.
- Deploy: `npx --no-install wrangler deploy` in `lib/wake/demo`

## How to verify

1. **Probe, no token, changes nothing.** `GET /` → 200 with `wake-demo: up`, and `GET /log` with no token → 401. Pass: both. Last run 2026-11-12: passed (receipt below).
2. **Module tests, offline.** From the repo root: `node --test "lib/wake/test/*.test.ts"`. Pass: all tests pass (36 on 2026-11-10).
3. **Local end to end.** In `lib/wake/demo`: `node test/e2e-local.mjs` against `wrangler dev` with a fake ntfy. Pass: a push that fails once is retried and notified.
4. **Live end to end — sends a real push to the human's phone; ask first.** In `lib/wake/demo`: `node test/e2e-remote.mjs`. Signs a call to `/course`, then polls `/log` until a `notified` row. Pass: 202, a row per push attempt, a 2xx `notified` row. ntfy.sh may refuse for many minutes first.

## Keep in mind

- on 2026-11-10 ntfy.sh refused the deployed wake-demo Worker's push 7 times (429, 429, 522, 522, 429, 429, 429) and accepted attempt 8 at 10:49:57Z, about 18.5 min after the call; the queue retried it with no manual re-ping · source: lib/wake/demo/test/e2e-remote.mjs:38 · how: ran
- after the 2026-11-12 topic rotation, ntfy.sh refused wake-demo's push for job f66435e3079c35e8 14 times (522 ×5, then 429 and 522 mixed, then 429 ×6) and accepted attempt 15 at 21:22:30Z, about 55 min after the 20:27:32Z call; the queue retried with no manual re-ping, and the message is on the new topic · source: lib/wake/demo/src/index.ts:50 · how: ran
- the human confirmed that wake-demo's ping (10:49:57Z) arrived on their phone, on away-agent's ntfy topic · source: human · how: told
- wake-demo is deployed at https://wake-demo.patrykmatychniak.workers.dev with KV wake-demo-kv and queue wake-demo-jobs; its secrets are only on Cloudflare and in lib/wake/demo/.secrets.json (git-ignored); the human chose to keep it (issue #10) · source: lib/wake/demo/wrangler.toml:10 · how: ran
- under wrangler dev (4.157) the local queue honours retry delaySeconds: a push that got 503 was retried 15.1 s later, matching delayFor(1) = 15 · source: lib/wake/demo/test/e2e-local.mjs:79 · how: ran

### Receipts

command: node test/e2e-remote.mjs 600 (lib/wake/demo, after the topic rotation, 2026-11-12; the 10-minute wait ran out before delivery; its 7 indented progress lines are left out, the watcher line below holds the same rows)
```
PASS  deployed Worker answers: 200 wake-demo: up
PASS  /log without a token is 401
PASS  signed call gets 202: 202 accepted, 1130 ms from this laptop, job id f66435e3079c35e8
PASS  every push attempt has a row with its status: 522, 522, 522, 522, 429, 522
FAIL  ntfy answered 2xx and a notified row was written: no notified row yet
1 check(s) failed
```

command: node watcher polling GET /log on wake-demo for job f66435e3079c35e8, last line before its 45-minute limit (admin token <secret removed>)
```
20:28:00 push_attempt:522 #1 | 20:28:35 push_attempt:522 #2 | 20:29:25 push_attempt:522 #3 | 20:30:45 push_attempt:522 #4 | 20:32:46 push_attempt:429 #5 | 20:37:06 push_attempt:522 #6 | 20:42:06 push_attempt:429 #7 | 20:47:07 push_attempt:429 #8 | 20:52:27 push_attempt:522 #9 | 20:57:27 push_attempt:429 #10 | 21:02:28 push_attempt:429 #11 | 21:07:29 push_attempt:429 #12 | 21:12:29 push_attempt:429 #13 | 21:17:30 push_attempt:429 #14
```

command: node one-off GET /log on wake-demo for job f66435e3079c35e8 (admin token <secret removed>)
```
21:23:15Z 16 rows; last 3:
21:17:30 push_attempt:429 #14
21:22:30 push_attempt:200 #15
21:22:30 notified:200 #15
```

command: PowerShell GET https://ntfy.sh/<new topic>/json?poll=1&since=all (2026-11-12)
```
message 20:53:09Z title=new topic check msg=Sent from the laptop after the topic rotation. If you see this, the phone is on the new topic.
message 21:22:30Z title=wake-demo msg=course asked: {"ask":"wake-demo test from the laptop","sent":"2026-11-12T20:27:32.610Z"}
```

command: How to verify step 1 (PowerShell Invoke-WebRequest, GET / and GET /log with no token)
```
GET https://wake-demo.patrykmatychniak.workers.dev/ -> 200 wake-demo: up
GET https://wake-demo.patrykmatychniak.workers.dev/log -> 401 www-authenticate:
```

command: node watcher polling GET /log on wake-demo for job e5025902641bf7fa (admin token <secret removed>)
```
10:50:21 10:31:30 push_attempt:429 #1 | 10:31:45 push_attempt:429 #2 | 10:32:36 push_attempt:522 #3 | 10:33:56 push_attempt:522 #4 | 10:35:56 push_attempt:429 #5 | 10:39:56 push_attempt:429 #6 | 10:44:57 push_attempt:429 #7 | 10:49:57 push_attempt:200 #8 | 10:49:58 notified:200 #8
DONE
```

command: wrangler deploy (lib/wake/demo)
```
Uploaded wake-demo (4.66 sec)
Deployed wake-demo triggers (5.16 sec)
  https://wake-demo.patrykmatychniak.workers.dev
  Producer for wake-demo-jobs
  Consumer for wake-demo-jobs
Current Version ID: 4deba545-f154-4012-80e6-b63c318cf72a
```

command: node test/e2e-local.mjs (lib/wake/demo, against wrangler dev)
```
PASS  push failed once (503), retried, then notified
PASS  fake ntfy got 2 pushes: retry after 15.1 s
```
