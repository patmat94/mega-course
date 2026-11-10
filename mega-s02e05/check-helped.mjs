// Checks a status log against the ticket's "Who it is for / how we'd know it helped" line,
// not against the course's acceptance.
// Usage: node check-helped.mjs <status-log.jsonl> [heldActs=1]
// What the log alone cannot show (who sent the ping) is printed as "not in log".
import { readFileSync } from "node:fs";

const PING_MAX_S = 120; // gated ask -> ping on the phone
const DONE_AFTER_CODE_MAX_S = 60; // owner's code -> held act done

const [file, heldArg = "1"] = process.argv.slice(2);
const held = Number(heldArg);
const rows = readFileSync(file, "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l));
const r2 = rows.filter((r) => Number(r.round) === 2);
const t = (r) => Date.parse(r.at);
const first = (ev, after = -Infinity) => r2.find((r) => r.event === ev && t(r) >= after);

const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

const received = first("received");
const notified = r2.filter((r) => r.event === "notified");
const ping = notified[0];
const lag = ping && received ? (t(ping) - t(received)) / 1000 : null;
check(`ping within ${PING_MAX_S} s of the gated ask`, lag !== null && lag <= PING_MAX_S,
  lag === null ? "no notified row" : `${lag.toFixed(1)} s`);
check(`one ping per held act (${held}), none for free acts`, notified.length === held,
  `${notified.length} notified row(s)`);
const code = ping && first("owner_answered", t(ping));
const done = code && first("replied", t(code));
const doneLag = done ? (t(done) - t(code)) / 1000 : null;
check(`held act done within ${DONE_AFTER_CODE_MAX_S} s of the code`,
  doneLag !== null && doneLag <= DONE_AFTER_CODE_MAX_S,
  doneLag === null ? "no owner_answered -> replied after the ping" : `${doneLag.toFixed(1)} s`);
check("round is a number on every row", rows.every((r) => typeof r.round === "number"),
  rows.filter((r) => typeof r.round !== "number").length + " row(s) with text");

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}: ${r.detail}`);
console.log("not in log: whether the agent itself sent the ping (see log.txt)");
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
