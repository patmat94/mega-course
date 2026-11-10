// Plan § 3 / issue #3: a bad signature never reaches the queue (401 naming what failed),
// a duplicate is queued once (200), every 202 means the job was queued, a failed send gives 503
// and no seen key. Also the log rows ingress writes (WAKE.md § Exports, log).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { ingress, courseHmac, readLog, writeRow } from "../index.ts";
import type { Job } from "../types.ts";
import { fakeKV, fakeQueue } from "./fakes.ts";

const NOW_MS = Date.UTC(2026, 10, 10, 12, 0, 0);
const KEY = "sk_test_ingress";
const verify = courseHmac({ secret: KEY });

function signed(body: string, ts = String(Math.floor(NOW_MS / 1000)), key = KEY) {
  const sig = "sha256=" + createHmac("sha256", key).update(`${ts}.${body}`).digest("hex");
  return new Request("https://example.test/course", {
    method: "POST", body, headers: { "x-course-timestamp": ts, "x-course-signature": sig },
  });
}
const setup = (failSends = 0) => ({ kv: fakeKV(), queue: fakeQueue<Job>({ failSends }) });
const opts = { verify, kind: "course", nowMs: NOW_MS };

test("good call: 202 after the job is on the queue, with kind, id, body and at", async () => {
  const b = setup();
  const res = await ingress(signed('{"ask":"ack_alert"}'), b, opts);
  assert.equal(res.status, 202);
  assert.equal(b.queue.sent.length, 1);
  const job = b.queue.sent[0] as Extract<Job, { body: unknown }>;
  assert.equal(job.kind, "course");
  assert.deepEqual(job.body, { ask: "ack_alert" });
  assert.match(job.id, /^[0-9a-f]{16}$/);
  assert.equal(job.at, "2026-11-10T12:00:00.000+00:00");
  const seen = b.kv.data.get(`seen:course:${job.id}`);
  assert.equal(seen?.ttl, 86400);
});

test("bad signature: 401 naming what failed, nothing queued, a refused row without the body", async () => {
  const b = setup();
  const res = await ingress(signed('{"ask":"x"}', undefined, "sk_wrong"), b, opts);
  assert.equal(res.status, 401);
  assert.equal(await res.text(), "x-course-signature does not match");
  assert.equal(b.queue.sent.length, 0);
  const rows = await readLog(b.kv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event, "refused");
  assert.equal(rows[0].attempt, 0);
  assert.ok(!JSON.stringify(rows[0]).includes("ask"));
});

test("missing header: 401 names the header", async () => {
  const b = setup();
  const req = new Request("https://example.test/course", { method: "POST", body: "{}" });
  const res = await ingress(req, b, opts);
  assert.equal(res.status, 401);
  assert.equal(await res.text(), "missing header x-course-timestamp");
  assert.equal(b.queue.sent.length, 0);
});

test("duplicate: the same call twice is queued once; the second answer is 200 duplicate", async () => {
  const b = setup();
  const body = '{"ask":"post_status"}';
  const first = await ingress(signed(body), b, opts);
  const second = await ingress(signed(body), b, opts);
  assert.equal(first.status, 202);
  assert.equal(second.status, 200);
  assert.equal(await second.text(), "duplicate");
  assert.equal(b.queue.sent.length, 1);
  assert.deepEqual((await readLog(b.kv)).map((r) => r.event), ["received", "duplicate"]);
});

test("not JSON: 400, nothing queued", async () => {
  const b = setup();
  const res = await ingress(signed("not json"), b, opts);
  assert.equal(res.status, 400);
  assert.equal(b.queue.sent.length, 0);
});

test("failed send: 503, no seen key, so the sender's resend is queued, not called a duplicate", async () => {
  const b = setup(1);
  const body = '{"ask":"rotate_key"}';
  const first = await ingress(signed(body), b, opts);
  assert.equal(first.status, 503);
  assert.equal([...b.kv.data.keys()].filter((k) => k.startsWith("seen:")).length, 0);
  const resend = await ingress(signed(body), b, opts);
  assert.equal(resend.status, 202);
  assert.equal(b.queue.sent.length, 1);
});

test("every 202 has a queued job behind it (mixed run of 12 calls)", async () => {
  const b = setup(2);
  let accepted = 0;
  for (let i = 0; i < 12; i++) {
    const body = JSON.stringify({ n: i % 8 }); // 4 repeats
    const key = i === 5 ? "sk_wrong" : KEY;    // 1 bad signature
    const res = await ingress(signed(body, undefined, key), b, opts);
    if (res.status === 202) accepted++;
  }
  assert.equal(accepted, b.queue.sent.length);
  assert.equal(new Set(b.queue.sent.map((j) => j.id)).size, b.queue.sent.length);
});

test("log rows: oldest first, attempt is a number, sinceMs filters, about is capped at 200", async () => {
  const b = setup();
  await ingress(signed('{"a":1}'), b, { ...opts, nowMs: NOW_MS });
  await ingress(signed('{"a":2}', String(Math.floor(NOW_MS / 1000) + 5)), b, { ...opts, nowMs: NOW_MS + 5000 });
  const rows = await readLog(b.kv);
  assert.equal(rows.length, 2);
  assert.ok(rows[0].at < rows[1].at);
  assert.ok(rows.every((r) => typeof r.attempt === "number"));
  assert.equal((await readLog(b.kv, { sinceMs: NOW_MS + 1000 })).length, 1);
  const logKeys = [...b.kv.data.entries()].filter(([k]) => k.startsWith("log:"));
  assert.ok(logKeys.every(([k, v]) => /^log:\d{13}:[0-9a-z]{6}$/.test(k) && v.ttl === 7 * 86400));
  const same = setup();
  for (const ev of ["push_attempt", "notified", "handled"] as const) {
    await writeRow(same.kv, { event: ev, kind: "push", id: "p1", attempt: 1 }, NOW_MS);
  }
  assert.deepEqual((await readLog(same.kv)).map((r) => r.event), ["push_attempt", "notified", "handled"]);
  const long = await writeRow(b.kv, { event: "refused", kind: "course", id: "-", attempt: 0, about: "x".repeat(500) }, NOW_MS);
  assert.equal(long.about?.length, 200);
});
