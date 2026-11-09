// Runs the agent's own check (away-agent/src/check.js) on the practice messages.
import { readFileSync } from "node:fs";
import { check } from "./away-agent/src/check.js";
export { check };
if (process.argv[1]?.endsWith("check.mjs")) {
  const policy = JSON.parse(readFileSync(new URL("./policy.json", import.meta.url)));
  const start = JSON.parse(readFileSync(new URL("./start-challenge.json", import.meta.url)));
  for (const p of start.practice) { const r = check(p.text, policy); console.log(p.id, r.act, r.label); }
}
