// Plan § 4 / issue #4: 5 failures then a 200 gives 6 push_attempt rows and exactly one "notified";
// failures on every try give no "notified" and one "push_failed"; every attempt is a number;
// each attempt's row is written before the retry is asked for (ADR 0008).
import { test } from "node:test";
import assert from "node:assert/strict";
import { consume, delayFor, readLog } from "../index.ts";
import type { Job, Handler, MessageLike } from "../types.ts";
import { fakeKV, fakeQueue } from "./fakes.ts";

const T0 = Date.UTC(2026, 10, 10, 12, 0, 0);

/** Delivers one job the way a Cloudflare Queue would: again after each retry(), with attempts + 1. */
async function deliver(job: Job, opts: {
  handlers?: Record<string, Handler>; statuses?: (number | "throw")[]; maxTries?: number;
}) {
  const b = { kv: fakeKV(), queue: fakeQueue<Job>() };
  const statuses = [...(opts.statuses ?? [])];
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFake = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const s = statuses.shift() ?? 200;
    if (s === "throw") throw new Error("network down");
    return new Response("", { status: s });
  };
  const delays: number[] = [];
  const rowsAtRetry: number[] = [];
  let now = T0;
  for (let attempts = 1; attempts <= 100; attempts++) {
    let outcome: "ack" | "retry" | null = null;
    const msg: MessageLike<Job> = {
      body: job, attempts,
      ack: () => { outcome = "ack"; },
      retry: (o) => { outcome = "retry"; delays.push(o?.delaySeconds ?? 0); rowsAtRetry.push(b.kv.data.size); },
    };
    await consume({ messages: [msg] }, b, opts.handlers ?? {}, { maxTries: opts.maxTries, fetch: fetchFake, now: () => now });
    if (outcome !== "retry") return { b, calls, delays, rowsAtRetry, outcome, attempts, rows: await readLog(b.kv) };
    now += (delays.at(-1) ?? 0) * 1000;
  }
  throw new Error("never settled");
}

const pushJob: Job = {
  kind: "push", id: "j1.push.1", at: "2026-11-10T12:00:00.000+00:00",
  push: { url: "https://ntfy.example/topic", headers: { Title: "Needs you" }, body: "release_hold is held", about: "release_hold" },
};

test("delayFor: 15 s doubling, capped at 300 s", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 30].map(delayFor), [15, 30, 60, 120, 240, 300, 300, 300]);
});

test("push: 5 failures then 200 gives 6 push_attempt rows and exactly one notified", async () => {
  const r = await deliver(pushJob, { statuses: [429, 522, "throw", 500, 522, 200] });
  const ev = r.rows.map((x) => x.event);
  assert.equal(ev.filter((e) => e === "push_attempt").length, 6);
  assert.equal(ev.filter((e) => e === "notified").length, 1);
  assert.equal(ev.at(-1), "notified");
  assert.deepEqual(r.rows.filter((x) => x.event === "push_attempt").map((x) => x.status), [429, 522, -1, 500, 522, 200]);
  assert.deepEqual(r.rows.filter((x) => x.event === "push_attempt").map((x) => x.attempt), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(r.delays, [15, 30, 60, 120, 240]);
  assert.equal(r.outcome, "ack");
  assert.equal(r.calls.length, 6);
  assert.equal(r.calls[0].init.method, "POST");
  assert.equal(r.calls[0].init.body, "release_hold is held");
  // the notified row carries the time of the 2xx: 465 s after the first try
  const notified = r.rows.find((x) => x.event === "notified")!;
  assert.equal(notified.at, new Date(T0 + 465_000).toISOString().replace("Z", "+00:00"));
});

test("push: every attempt's row is written before retry() is called", async () => {
  const r = await deliver(pushJob, { statuses: [500, 500, 200] });
  assert.deepEqual(r.rowsAtRetry, [1, 2]); // 1 row before the 1st retry, 2 before the 2nd
});

test("push: failures on every try give no notified and one push_failed, then ack", async () => {
  const r = await deliver(pushJob, { statuses: Array(40).fill(522), maxTries: 30 });
  const ev = r.rows.map((x) => x.event);
  assert.equal(ev.filter((e) => e === "push_attempt").length, 30);
  assert.equal(ev.filter((e) => e === "notified").length, 0);
  assert.equal(ev.filter((e) => e === "push_failed").length, 1);
  assert.equal(r.outcome, "ack");
  assert.equal(r.delays.length, 29);
  assert.equal(r.delays.reduce((a, b) => a + b, 0), 7665);
  assert.ok(r.rows.every((x) => typeof x.attempt === "number"));
});

test("handler: resolves -> handled row, ack; Tools.push queues a push job, never fetches", async () => {
  const job: Job = { kind: "course", id: "c1", body: { ask: "release_hold" }, at: "x" };
  let queued: Job[] = [];
  const r = await deliver(job, {
    handlers: { course: async (_j, t) => { await t.push({ url: "https://ntfy.example/t", body: "hold" }); await t.log({ event: "handled", kind: "course", id: "c1", attempt: 0, about: "custom" }); } },
  });
  queued = r.b.queue.sent;
  assert.equal(r.outcome, "ack");
  assert.equal(r.calls.length, 0);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "push");
  assert.equal(queued[0].id, "c1.push.1");
  assert.deepEqual(r.rows.map((x) => x.event), ["handled", "handled"]);
});

test("handler: throws twice then works -> 2 handler_failed rows naming the error, then handled", async () => {
  let n = 0;
  const job: Job = { kind: "course", id: "c2", body: {}, at: "x" };
  const r = await deliver(job, { handlers: { course: async () => { if (++n < 3) throw new Error(`reply POST got 503 (${n})`); } } });
  assert.deepEqual(r.rows.map((x) => x.event), ["handler_failed", "handler_failed", "handled"]);
  assert.match(r.rows[0].about ?? "", /reply POST got 503 \(1\)/);
  assert.deepEqual(r.delays, [15, 30]);
});

test("handler: throws on every try -> job_failed on the last, then ack", async () => {
  const job: Job = { kind: "course", id: "c3", body: {}, at: "x" };
  const r = await deliver(job, { handlers: { course: async () => { throw new Error("always"); } }, maxTries: 4 });
  assert.deepEqual(r.rows.map((x) => x.event), ["handler_failed", "handler_failed", "handler_failed", "job_failed"]);
  assert.equal(r.outcome, "ack");
});

test("no handler for the kind -> job_failed naming the kind, ack at once", async () => {
  const r = await deliver({ kind: "mail", id: "m1", body: {}, at: "x" }, {});
  assert.deepEqual(r.rows.map((x) => x.event), ["job_failed"]);
  assert.match(r.rows[0].about ?? "", /no handler for kind "mail"/);
  assert.equal(r.attempts, 1);
});
