// Issue #7 / plan § 6: against the deployed wake-demo, a signed call gets 202 and the Worker's own
// log rows show each push attempt and an ntfy 2xx. The push goes from Cloudflare to the real ntfy.sh.
// Usage: node test/e2e-remote.mjs [maxWaitSeconds=540]   (from lib/wake/demo; reads .secrets.json, git-ignored)
// Does not call /revoke, so /log stays readable for #8.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const S = JSON.parse(readFileSync(resolve(here, ".secrets.json"), "utf8"));
const maxWait = Number(process.argv[2] ?? 540) * 1000;
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ": " + detail : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const admin = { headers: { authorization: `Bearer ${S.ADMIN_TOKEN}` } };

const up = await fetch(S.BASE + "/");
check("deployed Worker answers", up.ok, `${up.status} ${(await up.text()).trim()}`);
check("/log without a token is 401", (await fetch(S.BASE + "/log")).status === 401);

const body = JSON.stringify({ ask: "wake-demo test from the laptop", sent: new Date().toISOString() });
const ts = String(Math.floor(Date.now() / 1000));
const sig = "sha256=" + createHmac("sha256", S.SIGNING_KEY).update(`${ts}.${body}`).digest("hex");
const t = performance.now();
const r = await fetch(S.BASE + "/course", { method: "POST", body, headers: { "content-type": "application/json", "x-course-timestamp": ts, "x-course-signature": sig } });
const ms = performance.now() - t;
const id = sig.slice(-16);
check("signed call gets 202", r.status === 202, `${r.status} ${await r.text()}, ${ms.toFixed(0)} ms from this laptop, job id ${id}`);
const sentAt = Date.now();

let mine = [], last = "";
while (Date.now() - sentAt < maxWait) {
  const rows = await (await fetch(S.BASE + "/log", admin)).json();
  mine = rows.filter((x) => x.id === id || x.id.startsWith(id + ".push."));
  const line = mine.map((x) => `${x.at.slice(11, 23)} ${x.event}${x.status !== undefined ? ":" + x.status : ""} #${x.attempt}`).join(" | ");
  if (line !== last) { console.log("      " + line); last = line; }
  if (mine.some((x) => x.event === "notified" || x.event === "push_failed")) break;
  await sleep(5000);
}
const attempts = mine.filter((x) => x.event === "push_attempt");
const notified = mine.find((x) => x.event === "notified");
check("every push attempt has a row with its status", attempts.length > 0 && attempts.every((x) => typeof x.status === "number" && typeof x.attempt === "number"),
  attempts.map((x) => x.status).join(", "));
check("ntfy answered 2xx and a notified row was written", !!notified && notified.status >= 200 && notified.status < 300,
  notified ? `notified at ${notified.at}, ${((Date.parse(notified.at) - sentAt) / 1000).toFixed(1)} s after the call` : "no notified row yet");
const failed = results.filter((x) => !x).length;
console.log(failed ? `${failed} check(s) failed` : `all ${results.length} checks passed`);
process.exitCode = failed ? 1 : 0;
