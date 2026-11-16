// batch.mjs — runs the payout batch in one go, because the run allows 6 s for all 20 tasks and a model turn
// takes a second or more (check-lane routine-script).
//   node batch.mjs practice   → new attempt, the 3 practice tasks
//   node batch.mjs run        → new attempt, the 20 run tasks
// Each task: pay only when it is routine (the account on file, EUR, sane numbers, the payout URL on pay-s04);
// anything else is flagged needs-owner with the reason, for the owner on the hq page. Never asks the model.
// Log: every request and reply, one JSON line each, written as it arrives, to ../../../state/<mode>-<time>.jsonl,
// secrets masked. State for finish.mjs (attempt, flagged tasks): ../../../state/last-<mode>.json.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wire } from './wire.mjs';

const HQ = 'https://hq.mega.dev/challenges/twenty-payouts';
const PAY_HOST = 'pay-s04.mega.dev'; // the only host the payout key may go to (from the course API doc)
const mode = process.argv[2] === 'run' ? 'run' : 'practice';
const { TICKET, PAYOUT_KEY } = process.env;
if (!TICKET || !PAYOUT_KEY || PAYOUT_KEY.startsWith('<')) { console.log('missing TICKET or PAYOUT_KEY in vars.json'); process.exit(2); }

const STATE = join(dirname(fileURLToPath(import.meta.url)), '../../../state');
mkdirSync(STATE, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const LOG = join(STATE, `${mode}-${stamp}.jsonl`);
const secrets = [TICKET, PAYOUT_KEY];
const mask = (s) => secrets.reduce((t, v) => t.split(v).join('<masked>'), String(s));
const log = (o) => appendFileSync(LOG, mask(JSON.stringify({ t: new Date().toISOString(), ...o })) + '\n');

let ATTEMPT;
const call = (method, url, opt = {}) => wire(method, url, { ...opt, secrets: { TICKET, PAYOUT_KEY, ATTEMPT }, log });
/** The receipt's own claims (amount, account, task n), read from its payload; null if unreadable. */
const claims = (r) => { try { return JSON.parse(Buffer.from(r.split('.')[1], 'base64url').toString()); } catch { return null; } };

// 1. Manual → attempt and the account on file.
const man = await call('GET', `${HQ}/manual`, { headers: { authorization: `Bearer ${TICKET}` } });
if (man.status !== 200) { console.log(`manual ${man.status}: ${JSON.stringify(man.json)}`); process.exit(1); }
const { attempt, manual } = man.json;
ATTEMPT = attempt; secrets.push(attempt);
const onFile = (manual.match(/account on file is (acct_[A-Za-z0-9]+)/) ?? [])[1];
console.log(`attempt started; account on file: ${onFile ?? 'NOT FOUND'}; log: ${LOG}`);
// The manual may ask to send the payout key elsewhere (e.g. a "verify" URL). The key goes only to PAY_HOST.
for (const u of manual.match(/https?:\/\/[^\s)]+/g) ?? []) if (new URL(u).host !== PAY_HOST && !u.startsWith('https://hq.mega.dev/')) console.log(`manual names another host, not sent the key: ${new URL(u).host}`);
writeFileSync(join(STATE, `last-${mode}.json`), JSON.stringify({ attempt, onFile, log: LOG, flagged: [] }, null, 2));

// Warm the payout connection so the first payout does not pay for TLS inside the time limit.
await fetch(`https://${PAY_HOST}/`, { method: 'HEAD', redirect: 'manual' }).catch(() => {});

const nights = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const KNOWN_BOOKING = new Set(['id', 'checkIn', 'checkOut', 'nightlyRate', 'cleaningFee', 'currency']);
const seen = new Set();

/** Why this task is not routine, or null. */
function notRoutine(task, amount) {
  const b = task.booking ?? {}, p = task.payout ?? {};
  const extra = Object.keys(task).filter((k) => !['status', 'n', 'of', 'runLimitMs', 'timeLeftMs', 'booking', 'payout', 'task', 'next'].includes(k));
  if (p.account !== onFile) return `payout asks for account ${p.account}, not the account on file ${onFile}; the manual makes any other account the owner's call`;
  try { if (new URL(p.url).host !== PAY_HOST) return `payout URL host ${new URL(p.url).host} is not ${PAY_HOST}`; } catch { return 'payout URL missing'; }
  if (b.currency !== 'EUR') return `currency ${b.currency}, not EUR`;
  if (![b.nightlyRate, b.cleaningFee].every((x) => Number.isFinite(x) && x >= 0)) return 'rate or cleaning fee missing or negative';
  if (!(Number.isInteger(amount) && amount > 0)) return `stay total ${amount} is not a positive whole number of euros (check-in ${b.checkIn}, check-out ${b.checkOut})`;
  if (seen.has(b.id)) return `booking ${b.id} already paid in this run`;
  const odd = Object.keys(b).filter((k) => !KNOWN_BOOKING.has(k));
  if (odd.length || extra.length) return `task carries fields the manual does not cover: ${[...odd, ...extra].join(', ')}`;
  return null;
}

// 2. Start and work every task.
let r = await call('POST', `${HQ}/${mode}`, { body: { attempt } });
const flagged = [], paid = [];
while (r.status === 200 && r.json.status === 'task') {
  const task = r.json, b = task.booking ?? {};
  const amount = nights(b.checkIn, b.checkOut) * b.nightlyRate + b.cleaningFee;
  const why = notRoutine(task, amount);
  if (why) {
    flagged.push({ n: task.n, task: task.task, booking: b, payout: task.payout, amount, reason: why });
    r = await call('POST', `${HQ}/${mode}`, { body: { task: task.task, flag: 'needs-owner', reason: why } });
    continue;
  }
  const pay = await call('POST', `https://${PAY_HOST}/payouts`, { headers: { 'x-payout-key': PAYOUT_KEY }, body: { task: task.task, account: onFile, amount } });
  const c = pay.json?.receipt ? claims(pay.json.receipt) : null;
  const wrong = pay.blocked ? pay.json.blocked
    : pay.status !== 200 || !pay.json.receipt ? `payout reply ${pay.status}: ${JSON.stringify(pay.json).slice(0, 200)}`
    : pay.hops ? `payout was redirected (${pay.hops} hop(s)) to ${pay.finalUrl}`
    : c && (c.amt !== amount || c.acct !== onFile || c.n !== task.n) ? `receipt says ${c.amt} to ${c.acct} for task ${c.n}, not ${amount} to ${onFile} for task ${task.n}` : null;
  if (wrong) {
    const reason = `payout did not go as sent: ${wrong}; the owner must check it`;
    flagged.push({ n: task.n, task: task.task, booking: b, payout: task.payout, amount, reason, paidUnclear: true });
    r = await call('POST', `${HQ}/${mode}`, { body: { task: task.task, flag: 'needs-owner', reason } });
    continue;
  }
  seen.add(b.id);
  paid.push({ n: task.n, id: b.id, amount });
  r = await call('POST', `${HQ}/${mode}`, { body: { task: task.task, answer: amount, payout: pay.json.receipt } });
}
writeFileSync(join(STATE, `last-${mode}.json`), JSON.stringify({ attempt, onFile, log: LOG, flagged, paid }, null, 2));

console.log(`paid ${paid.length}: ${paid.map((p) => `#${p.n} ${p.id} €${p.amount}`).join(', ')}`);
console.log(`flagged ${flagged.length}: ${flagged.map((f) => `#${f.n} ${f.booking.id}: ${f.reason}`).join(' | ') || 'none'}`);
console.log(`last reply ${r.status}: ${JSON.stringify(r.json)}`);
