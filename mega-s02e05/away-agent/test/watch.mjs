// Polls the agent's event log; exits when a new event of interest appears (or after max minutes).
import { readFileSync } from "node:fs";
const A = readFileSync(new URL("../.admin-token", import.meta.url), "utf8").trim();
const B = "https://away-agent.patrykmatychniak.workers.dev";
const since = process.argv[2] || new Date().toISOString();
const max = Number(process.argv[3] || 40) * 60e3, t0 = Date.now();
for (;;) {
  try {
    const items = await (await fetch(`${B}/log?admin=${A}`)).json();
    const fresh = items.filter((e) => e.k.slice(4, 28) > since && e.v.kind !== "ping");
    if (fresh.length) { for (const e of fresh) console.log(e.k, JSON.stringify(e.v)); break; }
  } catch (e) { console.log("poll error", String(e)); }
  if (Date.now() - t0 > max) { console.log("no new events"); break; }
  await new Promise((r) => setTimeout(r, 15000));
}
