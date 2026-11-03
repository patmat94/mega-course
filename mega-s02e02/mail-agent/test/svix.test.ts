import { test } from "node:test";
import assert from "node:assert/strict";
import { sign, verify } from "../src/svix.ts";
import { scrub, isTrusted, address } from "../src/guard.ts";
import { htmlToText } from "../src/page.ts";

test("page: headings and links survive, scripts go", () => {
  const html = `<html><head><title>Example Domain</title><style>h1{}</style></head><body><div><h1>Example Domain</h1><p>Text &amp; more.</p><p><a href="/more">Learn more</a></p><script>x()</script></div></body></html>`;
  const t = htmlToText(html, "https://example.com/");
  assert.match(t, /^Title: Example Domain/);
  assert.match(t, /# Example Domain/);
  assert.match(t, /\[Learn more\]\(https:\/\/example\.com\/more\)/);
  assert.match(t, /Text & more\./);
  assert.equal(t.includes("x()"), false);
});

// Known vector from Svix's own library tests.
const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const ID = "msg_p5jXN8AQM9LWM0D4loKWxJek";
const TS = "1614265330";
const BODY = '{"test": 2432232314}';
const SIG = "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=";

test("svix: known vector verifies", async () => {
  assert.equal(`v1,${await sign(SECRET, ID, TS, BODY)}`, SIG);
  assert.equal(await verify(SECRET, { id: ID, timestamp: TS, signature: SIG }, BODY, Number(TS)), true);
});

test("svix: tampered body, old timestamp and missing header fail", async () => {
  assert.equal(await verify(SECRET, { id: ID, timestamp: TS, signature: SIG }, BODY + " ", Number(TS)), false);
  assert.equal(await verify(SECRET, { id: ID, timestamp: TS, signature: SIG }, BODY, Number(TS) + 600), false);
  assert.equal(await verify(SECRET, { id: ID, timestamp: TS, signature: null }, BODY, Number(TS)), false);
});

test("svix: one of several signatures may match", async () => {
  const multi = `v1,AAAA ${SIG}`;
  assert.equal(await verify(SECRET, { id: ID, timestamp: TS, signature: multi }, BODY, Number(TS)), true);
});

test("guard: exact secrets and key shapes are scrubbed", () => {
  const key = "am_live_1234567890abcdefghij";
  const r = scrub(`key is ${key} and sk-ant-api03-abcdefgh and secret-xyz-123456`, [key, "secret-xyz-123456"]);
  assert.equal(r.text.includes(key), false);
  assert.equal(r.text.includes("sk-ant-"), false);
  assert.equal(r.text.includes("secret-xyz"), false);
  assert.ok(r.hits >= 3);
});

test("guard: trusted sender check uses the bare address", () => {
  assert.equal(address("Rook <ROOK@mail.mega.dev>"), "rook@mail.mega.dev");
  assert.equal(isTrusted("Rook <rook@mail.mega.dev>", "rook@mail.mega.dev, me@x.io"), true);
  assert.equal(isTrusted("rook@mail.mega.dev.evil.io", "rook@mail.mega.dev"), false);
});
