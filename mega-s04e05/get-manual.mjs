// Fetches the S04E05 manual ONCE with TICKET (each fetch starts a new attempt). Appends the reply to manual.jsonl on
// arrival, stores the attempt in the Host Desk vars as ATTEMPT and the whole reply in host-desk/state/manual.json
// (the payout batch reads it there instead of refetching). Prints with the attempt masked.
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
const DESK = new URL('../mega-s04e01/starter/host-desk/', import.meta.url);
const VARS = new URL('vars.json', DESK);
const LOG = new URL('./manual.jsonl', import.meta.url);
if (existsSync(LOG) && process.argv[2] !== '--again') { console.log('manual.jsonl exists: the manual was fetched already (pass --again to start a new attempt)'); process.exit(1); }
const vars = JSON.parse(readFileSync(VARS, 'utf8'));
const ticket = JSON.parse(readFileSync(new URL('./receipts.json', import.meta.url), 'utf8')).receipts.ticket;
vars.TICKET = ticket;
writeFileSync(VARS, JSON.stringify(vars, null, 2));
const res = await fetch('https://hq.mega.dev/challenges/make-me-another/manual', { headers: { Authorization: `Bearer ${ticket}` }, redirect: 'manual' });
const text = await res.text();
appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), status: res.status, body: text }) + '\n');
let j; try { j = JSON.parse(text); } catch { console.log(res.status, text.slice(0, 2000)); process.exitCode = 1; }
if (j?.attempt) {
  vars.ATTEMPT = j.attempt;
  writeFileSync(VARS, JSON.stringify(vars, null, 2));
  writeFileSync(new URL('state/manual.json', DESK), JSON.stringify(j, null, 2));
  const m = (s) => s.split(j.attempt).join(`${j.attempt.slice(0, 6)}...(masked)`);
  console.log(res.status, m(JSON.stringify(j, null, 2)));
} else if (j) console.log(res.status, JSON.stringify(j, null, 2));
