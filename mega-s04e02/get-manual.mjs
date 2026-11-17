// Fetches the manual with TICKET from the Host Desk vars, appends the reply to manual.jsonl on arrival,
// and stores the new attempt in vars.json as ATTEMPT. Prints the reply with the attempt masked.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
const VARS = new URL('../mega-s04e01/starter/host-desk/vars.json', import.meta.url);
const vars = JSON.parse(readFileSync(VARS, 'utf8'));
const res = await fetch('https://hq.mega.dev/challenges/looks-good-to-me/manual', {
  headers: { Authorization: `Bearer ${vars.TICKET}` }, redirect: 'manual',
});
const text = await res.text();
appendFileSync(new URL('./manual.jsonl', import.meta.url), JSON.stringify({ at: new Date().toISOString(), status: res.status, body: text }) + '\n');
let j; try { j = JSON.parse(text); } catch { console.log(res.status, text.slice(0, 2000)); process.exitCode = 1; }
if (j?.attempt) {
  vars.ATTEMPT = j.attempt;
  writeFileSync(VARS, JSON.stringify(vars, null, 2));
  const m = (s) => s.split(j.attempt).join(`${j.attempt.slice(0, 6)}...(masked)`);
  console.log(res.status, m(JSON.stringify(j, null, 2)));
}
