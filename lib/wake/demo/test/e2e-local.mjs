// Issue #6 / plan § 5: against `wrangler dev` with a local queue and KV, a signed call gets 202,
// the log rows can be read from the admin route, and after /revoke the admin route answers 401.
// Also: the push retries through the queue (a fake ntfy answers 503 once, then 200).
// Usage: node test/e2e-local.mjs            (from lib/wake/demo)
//   WRANGLER=<path to wrangler binary>       default: mail-agent's local copy (no install needed)
// Writes throwaway secrets to .dev.vars (git-ignored) and deletes it at the end. Sends nothing outside this PC.
import { spawn, execSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WRANGLER = process.env.WRANGLER ?? resolve(here, "../../../mega-s02e02/mail-agent/node_modules/.bin/wrangler");
const PORT = 8799, NTFY_PORT = 8798;
const BASE = `http://127.0.0.1:${PORT}`;
const SIGNING_KEY = "sk_local_" + randomBytes(12).toString("hex");
const ADMIN_TOKEN = "adm_local_" + randomBytes(12).toString("hex");
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ": " + detail : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fake ntfy: 503 on the first push, 200 after
const pings = [];
const ntfy = createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c));
  req.on("end", () => { pings.push({ at: Date.now(), body }); res.statusCode = pings.length === 1 ? 503 : 200; res.end(); });
}).listen(NTFY_PORT, "127.0.0.1");

writeFileSync(resolve(here, ".dev.vars"),
  `SIGNING_KEY=${SIGNING_KEY}\nADMIN_TOKEN=${ADMIN_TOKEN}\nNTFY_URL=http://127.0.0.1:${NTFY_PORT}/wake-demo\n`);

const dev = spawn(`"${WRANGLER}" dev --port ${PORT} --ip 127.0.0.1 --local`, { cwd: here, shell: true });
let devOut = "";
dev.stdout.on("data", (d) => (devOut += d)); dev.stderr.on("data", (d) => (devOut += d));

function signed(body) {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = "sha256=" + createHmac("sha256", SIGNING_KEY).update(`${ts}.${body}`).digest("hex");
  return { method: "POST", body, headers: { "content-type": "application/json", "x-course-timestamp": ts, "x-course-signature": sig } };
}
const asAdmin = (method = "GET", token = ADMIN_TOKEN) => ({ method, headers: { authorization: `Bearer ${token}` } });

try {
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000) {
    try { if ((await fetch(BASE + "/")).ok) break; } catch {}
    await sleep(500);
  }
  check("wrangler dev is up", (await fetch(BASE + "/").catch(() => null))?.ok === true);

  const body = JSON.stringify({ ask: "release_hold", n: Date.now() });
  const s = performance.now();
  const r1 = await fetch(BASE + "/course", signed(body));
  const ms = performance.now() - s;
  check("signed call gets 202", r1.status === 202, `${r1.status} ${await r1.text()}`);
  check("202 in under 1 s", ms < 1000, `${ms.toFixed(0)} ms`);

  const r2 = await fetch(BASE + "/course", signed(body));
  check("same call again is 200 duplicate", r2.status === 200 && (await r2.text()) === "duplicate");

  const bad = signed(JSON.stringify({ ask: "x" })); bad.headers["x-course-signature"] = "sha256=" + "0".repeat(64);
  const r3 = await fetch(BASE + "/course", bad);
  check("bad signature is 401 naming the check", r3.status === 401 && /x-course-signature does not match/.test(await r3.text()));

  // wait for the push to fail once, retry through the queue, and land
  let rows = [];
  const w0 = Date.now();
  while (Date.now() - w0 < 90_000) {
    rows = await (await fetch(BASE + "/log", asAdmin())).json();
    if (rows.some((r) => r.event === "notified")) break;
    await sleep(2000);
  }
  const ev = rows.map((r) => `${r.event}${r.status !== undefined ? ":" + r.status : ""}`);
  console.log("      rows: " + ev.join(", "));
  check("admin route reads the log rows", rows.length > 0 && rows.every((r) => typeof r.attempt === "number"));
  check("push failed once (503), retried, then notified", ev.includes("push_attempt:503") && ev.includes("push_attempt:200") && ev.includes("notified:200"));
  check("fake ntfy got 2 pushes", pings.length === 2, pings.length >= 2 ? `retry after ${((pings[1].at - pings[0].at) / 1000).toFixed(1)} s` : `${pings.length}`);
  check("no secret or token in the rows", !JSON.stringify(rows).includes(SIGNING_KEY) && !JSON.stringify(rows).includes(ADMIN_TOKEN));

  check("admin route without a token is 401", (await fetch(BASE + "/log")).status === 401);
  check("admin route with a wrong token is 401", (await fetch(BASE + "/log", asAdmin("GET", "adm_wrong"))).status === 401);
  const rv = await fetch(BASE + "/revoke", asAdmin("POST"));
  check("POST /revoke answers 200", rv.status === 200);
  const after = await fetch(BASE + "/log", asAdmin());
  check("after /revoke the admin route answers 401", after.status === 401, await after.text());
} catch (e) {
  check("script ran without an exception", false, String(e));
  console.log(devOut.slice(-2000));
} finally {
  try { execSync(`taskkill /pid ${dev.pid} /T /F`, { stdio: "ignore" }); } catch { dev.kill(); }
  ntfy.close();
  rmSync(resolve(here, ".dev.vars"), { force: true });
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `${failed} check(s) failed` : `all ${results.length} checks passed`);
  process.exitCode = failed ? 1 : 0; // no process.exit after fetch on this PC (KEEP.md)
}
