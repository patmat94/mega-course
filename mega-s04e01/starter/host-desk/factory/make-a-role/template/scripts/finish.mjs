// finish.mjs · finishes the tasks tasks.mjs flagged, once the owner has decided them on the hq page. Each once.
//   node finish.mjs [run|practice] [waitSeconds=90]
// Reads ../../../state/last-<role>-<mode>.json, polls /parked every 10 s up to waitSeconds. The course API (read now):
//   amount > 0: pay it (decision on-file → the account on file; any other decision → the account the task asks for),
//   then POST /parked { task, answer: amount, payout }; amount 0: POST /parked { task, done: "declined" };
//   decision null: not decided yet, read /parked again later. A task finished once is never finished again.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECRET_HOSTS, wire } from './wire.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROLE = JSON.parse(readFileSync(join(here, '..', 'role.json'), 'utf8'));
const mode = process.argv[2] === 'practice' ? 'practice' : 'run';
const waitMs = Math.min(+(process.argv[3] ?? 90), 100) * 1000;
const { TICKET, ATTEMPT, PAYOUT_KEY } = process.env;
const STATE = join(here, '..', '..', '..', 'state');
const file = join(STATE, `last-${ROLE.role}-${mode}.json`);
const st = JSON.parse(readFileSync(file, 'utf8'));
st.finished ??= [];
const secrets = [TICKET, ATTEMPT, PAYOUT_KEY].filter(Boolean);
const mask = (s) => secrets.reduce((t, v) => t.split(v).join('<masked>'), String(s));
const log = (o) => appendFileSync(st.log, mask(JSON.stringify({ t: new Date().toISOString(), finish: true, ...o })) + '\n');
const call = (method, url, opt = {}) => wire(method, url, { ...opt, secrets: { TICKET, ATTEMPT, PAYOUT_KEY }, log });

const idx = await call('GET', ROLE.api);
const PARKED = idx.json?.parked?.list?.url, FINISH = idx.json?.parked?.finish?.url ?? PARKED, PAY_URL = idx.json?.payouts?.url;
if (idx.status !== 200 || !PARKED || !PAY_URL) { console.log(`api index ${idx.status}: no parked or payouts URL`); process.exit(1); }
if (!(SECRET_HOSTS.PAYOUT_KEY ?? []).includes(new URL(PAY_URL).host)) { console.log(`payouts host ${new URL(PAY_URL).host} is not in hosts.json for PAYOUT_KEY`); process.exit(1); }

const open = () => st.flagged.filter((f) => !st.finished.some((d) => d.n === f.n));
const t0 = Date.now();
while (open().length) {
  const pk = await call('GET', PARKED, { headers: { authorization: `Bearer ${ATTEMPT}` } });
  if (pk.status !== 200) { console.log(`parked ${pk.status}: ${mask(JSON.stringify(pk.json))}`); break; }
  for (const f of open()) {
    const entry = (pk.json.parked ?? []).find((p) => p.n === f.n);
    if (!entry?.decision) continue;
    if (entry.finished) { st.finished.push({ n: f.n, decision: entry.decision, note: 'the course says finished already' }); writeFileSync(file, JSON.stringify(st, null, 2)); continue; }
    let r;
    if (entry.amount === 0) {
      r = await call('POST', FINISH, { body: { task: f.task, done: 'declined' } });
    } else if (Number.isInteger(entry.amount) && entry.amount > 0) {
      const account = entry.decision === 'on-file' ? st.onFile : f.payout?.account ?? st.onFile;
      const pay = await call('POST', PAY_URL, { headers: { 'x-payout-key': PAYOUT_KEY }, body: { task: f.task, account, amount: entry.amount } });
      if (pay.blocked || pay.hops || pay.status !== 200 || !pay.json?.receipt) { console.log(`#${f.n}: payout refused ${pay.status}: ${mask(JSON.stringify(pay.json))}`); continue; }
      r = await call('POST', FINISH, { body: { task: f.task, answer: entry.amount, payout: pay.json.receipt } });
    } else {
      console.log(`#${f.n}: decision ${entry.decision} has no amount the API says how to finish; left for the owner`);
      continue;
    }
    console.log(`#${f.n} ${f.booking ?? ''}: decision ${entry.decision}, amount ${entry.amount} → ${r.status} ${mask(JSON.stringify(r.json))}`);
    if (r.status === 200) st.finished.push({ n: f.n, decision: entry.decision, amount: entry.amount });
    writeFileSync(file, JSON.stringify(st, null, 2));
  }
  if (!open().length || Date.now() - t0 > waitMs) break;
  await new Promise((ok) => setTimeout(ok, 10_000));
}
console.log(`finished ${st.finished.length} of ${st.flagged.length}; still waiting on the owner: ${open().map((f) => `#${f.n} ${f.booking ?? ''}`).join(', ') || 'none'}`);
