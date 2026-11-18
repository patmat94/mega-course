// finish.mjs â€” finishes the tasks batch.mjs flagged, once the owner has decided them on the hq page.
//   node finish.mjs [run|practice] [waitSeconds=90]
// Reads ../../../state/last-<mode>.json, polls /parked every 10 s up to waitSeconds, and for each decided task:
//   on-file â†’ pay the account on file; new â†’ pay the account the task asked for; decline â†’ pay nothing.
// Prints what it finished and what still waits. Run it again until nothing waits. Same log file as batch.mjs.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wire } from './wire.mjs';

// The Challenge slug: CHALLENGE in the environment, else today's (S04E03). S04E01 was twenty-payouts.
const SLUG = process.env.CHALLENGE ?? 'three-small-changes';
const HQ = `https://hq.mega.dev/challenges/${SLUG}`;
const PAY_HOST = 'pay-s04.mega.dev';
// S04E01 paid at /payouts; from S04E02 the course API puts the slug in the path.
const PAY_URL = SLUG === 'twenty-payouts' ? `https://${PAY_HOST}/payouts` : `https://${PAY_HOST}/${SLUG}/payouts`;
const mode = process.argv[2] === 'practice' ? 'practice' : 'run';
const waitMs = Math.min(+(process.argv[3] ?? 90), 100) * 1000;
const { TICKET, PAYOUT_KEY } = process.env;
const STATE = join(dirname(fileURLToPath(import.meta.url)), '../../../state');
const file = join(STATE, `last-${mode}.json`);
const st = JSON.parse(readFileSync(file, 'utf8'));
st.finished ??= [];
const secrets = [TICKET, PAYOUT_KEY, st.attempt].filter(Boolean);
const mask = (s) => secrets.reduce((t, v) => t.split(v).join('<masked>'), String(s));
const log = (o) => appendFileSync(st.log, mask(JSON.stringify({ t: new Date().toISOString(), ...o })) + '\n');

const call = (method, url, opt = {}) => wire(method, url, { ...opt, secrets: { TICKET, PAYOUT_KEY, ATTEMPT: st.attempt }, log });

const open = () => st.flagged.filter((f) => !st.finished.some((d) => d.n === f.n));
const t0 = Date.now();
while (open().length) {
  const pk = await call('GET', `${HQ}/parked`, { headers: { authorization: `Bearer ${st.attempt}` } });
  if (pk.status !== 200) { console.log(`parked ${pk.status}: ${mask(JSON.stringify(pk.json))}`); break; }
  for (const f of open()) {
    const d = (pk.json.parked ?? []).find((p) => p.n === f.n)?.decision;
    if (!d) continue;
    let r;
    if (d === 'decline') {
      r = await call('POST', `${HQ}/parked`, { body: { task: f.task, done: 'declined' } });
    } else if (d === 'on-file' || d === 'new') {
      const account = d === 'on-file' ? st.onFile : f.payout?.account;
      if (new URL(f.payout?.url ?? `https://${PAY_HOST}/`).host !== PAY_HOST && d === 'new') { console.log(`#${f.n}: owner said new, but the payout URL is not ${PAY_HOST}; paying at ${PAY_HOST} only`); }
      const pay = await call('POST', PAY_URL, { headers: { 'x-payout-key': PAYOUT_KEY }, body: { task: f.task, account, amount: f.amount } });
      if (pay.blocked || pay.hops || pay.status !== 200 || !pay.json.receipt) { console.log(`#${f.n}: payout refused ${pay.status}: ${mask(JSON.stringify(pay.json))}`); continue; }
      r = await call('POST', `${HQ}/parked`, { body: { task: f.task, answer: f.amount, payout: pay.json.receipt } });
    } else { console.log(`#${f.n}: unknown decision ${d}, left for the model`); continue; }
    console.log(`#${f.n} ${f.booking?.id}: decision ${d} â†’ ${r.status} ${mask(JSON.stringify(r.json))}`);
    if (r.status === 200) st.finished.push({ n: f.n, decision: d });
    writeFileSync(file, JSON.stringify(st, null, 2));
  }
  if (!open().length || Date.now() - t0 > waitMs) break;
  await new Promise((ok) => setTimeout(ok, 10_000));
}
console.log(`finished ${st.finished.length} of ${st.flagged.length}; still waiting on the owner: ${open().map((f) => `#${f.n} ${f.booking?.id}`).join(', ') || 'none'}`);
