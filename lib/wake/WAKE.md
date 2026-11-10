# wake · contract

The shared path for a Cloudflare Worker that an outside service wakes with a signed HTTPS call: check the signature, drop a duplicate, queue the job, answer 2xx, then run the job and any push from the queue. Decision: `docs/adr/0009-shared-wake-module.md`. Plan: `plan.md` (issues #1–#11 on patmat94/mega-course).

This file is written before the code. Sections 2–5 of the plan build to it; a change to the behaviour changes this file first.

## Who it is for / how we'd know it helped

The agent that builds the next lesson's Worker, and through it the human waiting for a ping. It helped if a Worker wired with it answers a signed call with 202 in under 1 s, and a push that fails 5 times in a row still arrives on the next 2xx, with one log row per attempt and no attempt without a row.

## Principles

- **A 2xx means the job is safe.** The caller gets 202 only after the queue has accepted the job. Reason: in S02E05 work done after the reply, in `ctx.waitUntil`, ended with no trace.
- **Every attempt leaves a row, before anything waits.** Reason: a push that is missing must be visible, not inferred from silence (ADR 0008).
- **"notified" means the push service answered 2xx.** It is written at that moment, never from memory or a later rebuild.
- **Say what failed.** A refusal names the header or check that failed and what was wrong, so the sender can fix it.
- **Small enough to read in one sitting:** about 150 lines of source without tests. What belongs to one lesson stays in that Worker.
- **Copy behaviour from code that worked:** `mega-s02e02/mail-agent/src/svix.ts` and its queue path, `mega-s02e05/away-agent/src/index.js` `verify`.

## Does

- Verifies a request with one of two verifiers.
- Drops a request it has already queued (same id within the dedupe TTL).
- Queues the job on a Cloudflare Queue and answers 202.
- Runs queued jobs through handlers the Worker gives it; retries a job that throws, with a growing delay.
- Sends pushes as their own queue jobs, retried until a 2xx or the last try.
- Writes log rows to KV and reads them back.

## Does not

- Hold policy, holds, owner codes, may lists, replies or prompts: those stay in each Worker.
- Expose HTTP routes other than through `ingress`. Admin routes (`/log`, `/revoke`) belong to the Worker, which reads rows with `readLog` (plan § 5).
- Send through a second push channel when one fails (ADR 0009, point 6).
- Store or log signing keys, tokens or full request bodies.
- Change rig-pulse, mail-agent or away-agent.

## Exports

All from `lib/wake/index.ts`. Types use `@cloudflare/workers-types`.

```ts
// ---- verifiers (plan § 2)
type Verdict = { ok: true; id: string } | { ok: false; reason: string };
type Verifier = (req: Request, raw: string, nowMs?: number) => Promise<Verdict>;

function standardWebhooks(o: {
  secret: string;            // "whsec_<base64>" or bare base64
  prefix?: "webhook" | "svix"; // header names <prefix>-id, -timestamp, -signature; default "webhook"
  toleranceS?: number;       // default 300
}): Verifier;
// Signed content: `${id}.${timestamp}.${raw}`, HMAC-SHA256, base64.
// Signature header: space-separated "v1,<base64>" entries; any match passes (key rotation).
// Verdict id: the <prefix>-id header.

function courseHmac(o: {
  secret: string;
  toleranceS?: number;       // default 600 (away-agent's MAX_SKEW_S)
}): Verifier;
// Headers: x-course-timestamp (seconds or milliseconds), x-course-signature "sha256=<hex>".
// Signed content: `${timestamp}.${raw}`, HMAC-SHA256, lower-case hex.
// Verdict id: the last 16 hex characters of the signature (as away-agent did).

// ---- ingress (plan § 3)
type Bindings = { kv: KVNamespace; queue: Queue<Job> };
type Job =
  | { kind: string; id: string; body: unknown; at: string }          // a woken job
  | { kind: "push"; id: string; push: Push; at: string };            // a push job
type Push = { url: string; headers?: Record<string, string>; body: string; about?: string };

function ingress(req: Request, b: Bindings, o: {
  verify: Verifier;
  kind: string;              // handler name for this route
  dedupeTtlS?: number;       // default 86400
  parse?: (raw: string) => unknown; // default JSON.parse; a throw gives 400
  nowMs?: number;
}): Promise<Response>;

// ---- consumer and push (plan § 4)
type Tools = { push(p: Push): Promise<void>; log(row: Omit<Row, "at">): Promise<void> };
type Handler = (job: Job, t: Tools) => Promise<void>;

function consume(batch: MessageBatch<Job>, b: Bindings, handlers: Record<string, Handler>, o?: {
  maxTries?: number;         // default 30
}): Promise<void>;

function delayFor(attempt: number): number; // seconds: min(15 * 2^(attempt-1), 300)

// ---- log
type Row = {
  at: string;                // ISO 8601 with offset, e.g. "2026-11-10T14:03:22.118+00:00"
  event: Event;
  kind: string;              // job kind, or "push"
  id: string;                // job id
  attempt: number;           // a number, never text (ADR 0008); 0 for rows before the queue
  status?: number;           // HTTP status of a push attempt; -1 when fetch threw
  about?: string;            // short note, never a secret or a full body
};
type Event = "received" | "duplicate" | "refused" | "handled" | "handler_failed" | "job_failed"
           | "push_attempt" | "notified" | "push_failed";

function readLog(kv: KVNamespace, o?: { sinceMs?: number; limit?: number }): Promise<Row[]>; // oldest first
```

## Behaviour

### ingress

In this order:

1. Read the raw body once (`req.text()`).
2. Verify. On failure: `401` with the verdict's reason as plain text, and a `refused` row (no body in it).
3. Look up `seen:<kind>:<id>` in KV. If present: `200` "duplicate" and a `duplicate` row. Nothing is queued.
4. Parse the body. On a throw: `400` "body is not JSON" (or the parser's message).
5. `queue.send(job)`. If it throws: `503` "could not queue the job, send again", no `seen` key, so a resend is not dropped.
6. Put `seen:<kind>:<id>` with the dedupe TTL, then a `received` row.
7. `202` "accepted".

The `seen` key is written after the send, not before (mail-agent wrote it before), so a failed send never turns the sender's retry into a "duplicate". The cost: a crash between 5 and 6 can queue the same job twice, so handlers must be safe to run twice.

### consume

For each message in the batch:

- A job whose `kind` has no handler: `job_failed` row naming the kind, then `ack` (retrying cannot help).
- A push job: one `push_attempt` row with the status, written before anything else; then
  - 2xx: `notified` row, `ack`;
  - otherwise, and `msg.attempts < maxTries`: `retry({ delaySeconds: delayFor(msg.attempts) })`;
  - otherwise: `push_failed` row, `ack`. The row stays in the log, where an admin route lists it.
- Any other job: run its handler.
  - Resolves: `handled` row, `ack`.
  - Throws, and `msg.attempts < maxTries`: `handler_failed` row with the error message, `retry` with `delayFor`.
  - Throws on the last try: `job_failed` row, `ack`.

`Tools.push(p)` queues a push job; it never calls fetch itself. A push is therefore never sent from the request or from `ctx.waitUntil`.

The module decides the last try, not the queue: set the queue's `max_retries` in `wrangler.toml` above `maxTries` (e.g. 40 for the default 30), so the queue never drops a message before `push_failed` or `job_failed` is written.

## Limits

| Limit | Value | Why |
|---|---|---|
| Dedupe TTL | 86 400 s (24 h) | away-agent's `seen:` key; mail-agent used 7 days for mail |
| Retry delay | 15 s, 30 s, 60 s, 120 s, 240 s, then 300 s each | the S02E05 ntfy outage lasted about 12 min; the first 6 tries cover about 12.75 min |
| Max tries | 30 per job or push | about 2 h of retries at 300 s |
| Queue `max_retries` | above max tries (40) | the module, not the queue, writes the last row |
| Signature window | 300 s standard webhooks, 600 s course | the values the existing Workers use |
| Log rows | key `log:<ms, 13 digits>:<random 6>`, TTL 7 days | sorted by time when listed; old rows expire |
| Row `about` | at most 200 characters | rows are read by people and models; no bodies |
| Source size | about 150 lines without tests | plan principle |

## Tests (plan §§ 2–4)

Run with `node --test lib/wake/test/` (Node 24 runs `.ts` test files directly). Every test fixes `nowMs`. Fakes stand in for KV, the queue, the message batch and `fetch`; nothing calls Cloudflare.

- § 2: for each verifier, good signature passes; wrong key, changed body, timestamp outside the window and a missing header each fail with a reason that names the problem.
- § 3: a bad signature never reaches the queue; the same id twice is queued once; every 202 has a queued job behind it; a failed send gives 503 and no `seen` key.
- § 4: 5 failures then 200 gives 6 `push_attempt` rows and exactly one `notified`; failures on every try give no `notified` and one `push_failed`; every `attempt` is a number.
