# Plan · shared wake module (`lib/wake/`)

Decision: `docs/adr/0009-shared-wake-module.md`. Comparison: `docs/wake-primitive.html`.

**Who it is for / how we'd know it helped:** the agent that builds the next lesson's Worker, and through it the human waiting for a ping. It helped if a new Worker wired with the module answers a signed call with 202 in under 1 s, and a push that fails 5 times in a row still arrives on the next 2xx, with one log row per attempt and nothing lost without a row.

Principles for every section: keep it small enough to read in one sitting (about 150 lines of source, without tests). Copy behaviour from the code that already worked (mail-agent's queue path, the two existing verifiers), not from memory. A push the human must get never depends only on `ctx.waitUntil` (ADR 0008).

## § 1 Contract

`lib/wake/WAKE.md`: what the module does and does not do, its exports and their types, the log row format (`at` with offset, `event`, `attempt`, `status`), and the limits (dedupe TTL, retry delays, max tries). Written before the code; later sections build to it.

## § 2 Signature verifiers

Two adapters behind one `verify(req, raw)` shape:
- `standardWebhooks`: `<prefix>-id`, `-timestamp`, `-signature` headers, HMAC-SHA256 of `id.ts.body`, base64, `v1,` entries, `whsec_` secret, 300 s window. Covers both Svix (mail-agent) and rig-pulse's `webhook-*` headers.
- `courseHmac`: `x-course-timestamp` and `x-course-signature`, `sha256=` + hex HMAC of `ts.body` (away-agent).

Tests: good signature, wrong key, changed body, old timestamp, missing header, each with a fixed `now`.

## § 3 Ingress

`ingress(req, env, opts)`: read the raw body once, verify (401 naming what failed), dedupe by an id taken from the request (KV with TTL; 200 "duplicate"), send to the queue, then 202. The 2xx goes out only after the queue accepted the job. Tests with fake KV and a fake queue: bad signature never reaches the queue, a duplicate is queued once, a 202 always means the job was queued.

## § 4 Queue consumer and push

`consume(batch, env, handlers)`: run the handler for each job; `ack` on success, `retry` with a growing delay on a throw. `push(target, message)` runs as its own queue job: each attempt writes a log row with its HTTP status before anything else, a non-2xx throws so the queue retries it, and the "notified" row is written only on a 2xx, at that moment. After the last try, a "push_failed" row stays where an admin route can list it. Tests with a fake fetch: 5 failures then 200 gives 6 attempt rows and one "notified"; all failures gives no "notified" and one "push_failed".

## § 5 Demo Worker, local

`lib/wake/demo/`: a Worker `wake-demo` with its own queue and KV, using `courseHmac`, whose handler pushes to an ntfy topic. Run under `wrangler dev` with a local queue; a script signs a test call, checks the 202 and reads the log rows from an admin route. The admin route needs a token, and a `/revoke` takes the token back without a database edit (ADR 0006).

## § 6 Deploy the demo and test from Cloudflare

Needs the human's yes first: deploy `wake-demo` to their Cloudflare account (a Worker, a queue and a KV namespace; public URL, admin routes behind a token; undo with `wrangler delete` and deleting the queue and KV). Then send a signed call from the laptop and check the phone. Done when the human confirms the push reached their phone and the log rows show every attempt.

## § 7 Write it down

AGENTS.md Principles: one line pointing new Workers at `lib/wake/` (ADR 0009). KEEP.md: what the Cloudflare test showed, with its source. CLAUDE.md needs no change.

## § 8 Take the demo down or keep it

After § 6, the human decides whether `wake-demo` stays deployed. If not: delete the Worker, queue and KV, and check the URL no longer answers.
