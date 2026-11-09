// Local end-to-end: start `wrangler dev` first (port 8787). Starts a reply sink on 127.0.0.1:8799.
import http from "node:http";
import { createHmac } from "node:crypto";
const BASE = process.env.BASE || "http://127.0.0.1:8787";
const KEY = "local-test-key";
const replies = [];
const sink = http.createServer((q, s) => { let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => { replies.push({ path: q.url, body: b }); s.end("ok"); }); }).listen(8799);
const send = async (post, { key = KEY, ts = String(Math.floor(Date.now() / 1000)) } = {}) => {
  const raw = JSON.stringify(post);
  const sig = "sha256=" + createHmac("sha256", key).update(`${ts}.${raw}`).digest("hex");
  const r = await fetch(`${BASE}/course`, { method: "POST", headers: { "content-type": "application/json", "x-course-timestamp": ts, "x-course-signature": sig }, body: raw });
  return r.status;
};
const msg = (n, text) => ({ from: "rook", subject: `t${n}`, text, replyUrl: `http://127.0.0.1:8799/r${n}` });
const results = {
  good_free: await send(msg(1, "Please `purge_cache` now.")),
  good_gated: await send(msg(2, "`rotate_key` please.")),
  bad_sig: await send(msg(3, "`purge_cache`"), { key: "wrong" }),
  old_ts: await send(msg(4, "`purge_cache`"), { ts: String(Math.floor(Date.now() / 1000) - 3600) }),
};
await new Promise((r) => setTimeout(r, 4000));
console.log(JSON.stringify(results));
for (const r of replies) console.log(r.path, r.body);
const log = await (await fetch(`${BASE}/log?admin=local-admin`)).json();
const hold = log.map((e) => e.v).find((v) => v.kind === "decide" && v.label === "gated");
console.log("decides:", log.filter((e) => e.v.kind === "decide").map((e) => `${e.v.act}:${e.v.label}`).join(" "));
sink.close();
