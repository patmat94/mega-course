// Plan § 2 / issue #2: both verifiers, each with good signature, wrong key, changed body,
// timestamp outside the window and a missing header. Signatures are made with node:crypto,
// not with the code under test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { standardWebhooks, courseHmac } from "../verify.ts";
import { sign as mailAgentSign } from "../../../mega-s02e02/mail-agent/src/svix.ts";

const NOW_MS = Date.UTC(2026, 10, 10, 12, 0, 0);
const NOW_S = Math.floor(NOW_MS / 1000);
const KEY_B64 = Buffer.from("wake-test-key-0123456789abcdef").toString("base64");
const SECRET = `whsec_${KEY_B64}`;
const OTHER = `whsec_${Buffer.from("some-other-key").toString("base64")}`;
const BODY = JSON.stringify({ kind: "pulse", n: 1 });

function swSig(secret: string, id: string, ts: string, body: string) {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return "v1," + createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
}
function swReq(prefix: string, headers: Record<string, string>, body = BODY) {
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) h[`${prefix}-${k}`] = v;
  return new Request("https://example.test/hook", { method: "POST", headers: h, body });
}

for (const prefix of ["webhook", "svix"] as const) {
  const verify = standardWebhooks({ secret: SECRET, prefix });
  const id = "msg_2nT0";
  const ts = String(NOW_S);

  test(`standardWebhooks/${prefix}: good signature passes with the id`, async () => {
    const v = await verify(swReq(prefix, { id, timestamp: ts, signature: swSig(SECRET, id, ts, BODY) }), BODY, NOW_MS);
    assert.deepEqual(v, { ok: true, id });
  });

  test(`standardWebhooks/${prefix}: wrong key fails`, async () => {
    const v = await verify(swReq(prefix, { id, timestamp: ts, signature: swSig(OTHER, id, ts, BODY) }), BODY, NOW_MS);
    assert.equal(v.ok, false);
    assert.match((v as { reason: string }).reason, /signature does not match/);
  });

  test(`standardWebhooks/${prefix}: changed body fails`, async () => {
    const changed = BODY.replace("1", "2");
    const v = await verify(swReq(prefix, { id, timestamp: ts, signature: swSig(SECRET, id, ts, BODY) }, changed), changed, NOW_MS);
    assert.equal(v.ok, false);
    assert.match((v as { reason: string }).reason, /signature does not match/);
  });

  test(`standardWebhooks/${prefix}: timestamp outside 300 s fails`, async () => {
    const old = String(NOW_S - 301);
    const v = await verify(swReq(prefix, { id, timestamp: old, signature: swSig(SECRET, id, old, BODY) }), BODY, NOW_MS);
    assert.equal(v.ok, false);
    assert.match((v as { reason: string }).reason, new RegExp(`${prefix}-timestamp .*outside the 300 s window`));
  });

  test(`standardWebhooks/${prefix}: missing header is named`, async () => {
    const v = await verify(swReq(prefix, { id, timestamp: ts }), BODY, NOW_MS);
    assert.deepEqual(v, { ok: false, reason: `missing header ${prefix}-signature` });
  });
}

test("standardWebhooks: second v1 entry passes (key rotation)", async () => {
  const verify = standardWebhooks({ secret: SECRET });
  const id = "msg_rot", ts = String(NOW_S);
  const sig = `${swSig(OTHER, id, ts, BODY)} ${swSig(SECRET, id, ts, BODY)}`;
  assert.equal((await verify(swReq("webhook", { id, timestamp: ts, signature: sig }), BODY, NOW_MS)).ok, true);
});

test("standardWebhooks: accepts a signature made by mail-agent's sign()", async () => {
  const verify = standardWebhooks({ secret: SECRET, prefix: "svix" });
  const id = "msg_mail", ts = String(NOW_S);
  const sig = "v1," + (await mailAgentSign(SECRET, id, ts, BODY));
  assert.equal((await verify(swReq("svix", { id, timestamp: ts, signature: sig }), BODY, NOW_MS)).ok, true);
});

// ---- courseHmac
const COURSE_KEY = "sk_test_course_key";
function courseSig(key: string, ts: string, body: string) {
  return "sha256=" + createHmac("sha256", key).update(`${ts}.${body}`).digest("hex");
}
function courseReq(headers: Record<string, string>, body = BODY) {
  return new Request("https://example.test/course", { method: "POST", headers, body });
}

{
  const verify = courseHmac({ secret: COURSE_KEY });
  const ts = String(NOW_S);

  test("courseHmac: good signature passes, id is the signature's last 16 hex", async () => {
    const sig = courseSig(COURSE_KEY, ts, BODY);
    const v = await verify(courseReq({ "x-course-timestamp": ts, "x-course-signature": sig }), BODY, NOW_MS);
    assert.deepEqual(v, { ok: true, id: sig.slice(-16) });
  });

  test("courseHmac: timestamp in milliseconds passes", async () => {
    const ms = String(NOW_MS);
    const v = await verify(courseReq({ "x-course-timestamp": ms, "x-course-signature": courseSig(COURSE_KEY, ms, BODY) }), BODY, NOW_MS);
    assert.equal(v.ok, true);
  });

  test("courseHmac: upper-case hex and spaces are accepted", async () => {
    const sig = "  " + courseSig(COURSE_KEY, ts, BODY).toUpperCase().replace("SHA256=", "sha256=") + " ";
    assert.equal((await verify(courseReq({ "x-course-timestamp": ts, "x-course-signature": sig }), BODY, NOW_MS)).ok, true);
  });

  test("courseHmac: wrong key fails", async () => {
    const v = await verify(courseReq({ "x-course-timestamp": ts, "x-course-signature": courseSig("sk_other", ts, BODY) }), BODY, NOW_MS);
    assert.equal(v.ok, false);
    assert.match((v as { reason: string }).reason, /signature does not match/);
  });

  test("courseHmac: changed body fails", async () => {
    const changed = BODY + " ";
    const v = await verify(courseReq({ "x-course-timestamp": ts, "x-course-signature": courseSig(COURSE_KEY, ts, BODY) }, changed), changed, NOW_MS);
    assert.equal(v.ok, false);
    assert.match((v as { reason: string }).reason, /signature does not match/);
  });

  test("courseHmac: timestamp outside 600 s fails", async () => {
    const old = String(NOW_S - 601);
    const v = await verify(courseReq({ "x-course-timestamp": old, "x-course-signature": courseSig(COURSE_KEY, old, BODY) }), BODY, NOW_MS);
    assert.equal(v.ok, false);
    assert.match((v as { reason: string }).reason, /x-course-timestamp .*outside the 600 s window/);
  });

  test("courseHmac: missing header is named", async () => {
    const v = await verify(courseReq({ "x-course-signature": courseSig(COURSE_KEY, ts, BODY) }), BODY, NOW_MS);
    assert.deepEqual(v, { ok: false, reason: "missing header x-course-timestamp" });
  });

  test("courseHmac: no secret set is named, not a crash", async () => {
    const v = await courseHmac({ secret: "" })(courseReq({ "x-course-timestamp": ts, "x-course-signature": "sha256=00" }), BODY, NOW_MS);
    assert.deepEqual(v, { ok: false, reason: "no signing key set" });
  });
}
