// Daily heartbeat: one GET per live Worker (workers.json), one row per Worker appended to heartbeat.jsonl.
// Each probe is the GET half of "How to verify" step 1 in docs/map/<worker>.md: no token, no signature, changes nothing.
// A row is appended the moment its reply arrives (ADR 0014), so a crash mid-run keeps the rows already taken.
// It shows whether a Worker answers, not whether anyone used it; usage is in each Worker's own KV/D1 rows.
// Usage: node agents/heartbeat/heartbeat.mjs   (prints one line per Worker and a summary; exit code 1 if any is down)
import { readFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workers = JSON.parse(readFileSync(join(here, 'workers.json'), 'utf8'));
const out = join(here, 'heartbeat.jsonl');

async function probe(w) {
  const t0 = Date.now();
  try {
    const res = await fetch(w.url, { signal: AbortSignal.timeout(15000), redirect: 'manual' });
    const body = await res.text();
    const why = res.status !== w.status ? `status ${res.status}, want ${w.status}` : w.has && !body.includes(w.has) ? `body lacks "${w.has}"` : '';
    return { status: res.status, ms: Date.now() - t0, ok: !why, why };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, ok: false, why: String(e.cause?.code || e.name || e.message) };
  }
}

let down = 0;
for (const w of workers) {
  let r = await probe(w);
  if (!r.ok && r.status === 0) r = { ...(await probe(w)), retried: true }; // one retry on a network error only
  const row = { at: new Date().toISOString(), worker: w.worker, url: w.url, ...r };
  appendFileSync(out, JSON.stringify(row) + '\n');
  if (!r.ok) down++;
  console.log(`${r.ok ? 'up  ' : 'DOWN'} ${w.worker.padEnd(15)} ${r.status} ${r.ms}ms${r.why ? ' · ' + r.why : ''}`);
}
console.log(`heartbeat: ${workers.length - down} of ${workers.length} up`);
// No process.exit right after fetch on this PC (libuv assertion, KEEP.md); set the code and let Node end.
process.exitCode = down ? 1 : 0;
