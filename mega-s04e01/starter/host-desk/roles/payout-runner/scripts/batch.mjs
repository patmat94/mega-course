// batch.mjs â€” runs the payout batch in one go, because the run allows 6 s for all 20 tasks and a model turn
// takes a second or more (check-lane routine-script).
//   node batch.mjs practice   â†’ new attempt, the 3 practice tasks
//   node batch.mjs run        â†’ new attempt, the 20 run tasks
// Each task: pay only when it is routine (the account on file, EUR, sane numbers, the payout URL on pay-s04);
// anything else is flagged needs-owner with the reason, for the owner on the hq page. Never asks the model.
// Log: every request and reply, one JSON line each, written as it arrives, to ../../../state/<mode>-<time>.jsonl,
// secrets masked. State for finish.mjs (attempt, flagged tasks): ../../../state/last-<mode>.json.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wire } from './wire.mjs';
import { hostPayout as price } from './pricing.mjs';

// The Challenge slug: CHALLENGE in the environment, else today's (S04E04). S04E01 was twenty-payouts, S04E03 three-small-changes.
const SLUG = process.env.CHALLENGE ?? 'leave-it-running';
const HQ = `https://hq.mega.dev/challenges/${SLUG}`;
const PAY_HOST = 'pay-s04.mega.dev';
// S04E01 paid at /payouts; from S04E02 the course API puts the slug in the path.
const PAY_URL = SLUG === 'twenty-payouts' ? `https://${PAY_HOST}/payouts` : `https://${PAY_HOST}/${SLUG}/payouts`; // the only host the payout key may go to (from the course API doc)
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

// 1. Manual â†’ attempt and the account on file.
// From S04E03 the whole team shares one attempt: with ATTEMPT in vars the batch never fetches the manual (each fetch
// starts a new attempt with an empty board); it reads the copy the one fetch saved in state/manual.json (git-ignored).
let attempt, manual;
if (process.env.ATTEMPT) {
  let saved;
  try { saved = JSON.parse(readFileSync(join(STATE, 'manual.json'), 'utf8')); } catch { console.log('ATTEMPT is set but state/manual.json is missing: save the manual from the one fetch there'); process.exit(1); }
  if (saved.attempt !== process.env.ATTEMPT) { console.log('state/manual.json belongs to another attempt than ATTEMPT in vars'); process.exit(1); }
  ({ attempt, manual } = saved);
} else {
  const man = await call('GET', `${HQ}/manual`, { headers: { authorization: `Bearer ${TICKET}` } });
  if (man.status !== 200) { console.log(`manual ${man.status}: ${JSON.stringify(man.json)}`); process.exit(1); }
  ({ attempt, manual } = man.json);
}
ATTEMPT = attempt; secrets.push(attempt);
const onFile = (manual.match(/account on file is (acct_[A-Za-z0-9]+)/) ?? [])[1];
console.log(`attempt started; account on file: ${onFile ?? 'NOT FOUND'}; log: ${LOG}`);
// The manual may ask to send the payout key elsewhere (e.g. a "verify" URL). The key goes only to PAY_HOST.
for (const u of manual.match(/https?:\/\/[^\s)]+/g) ?? []) if (new URL(u).host !== PAY_HOST && !u.startsWith('https://hq.mega.dev/')) console.log(`manual names another host, not sent the key: ${new URL(u).host}`);
writeFileSync(join(STATE, `last-${mode}.json`), JSON.stringify({ attempt, onFile, log: LOG, flagged: [] }, null, 2));

// From S04E02 the host gets the stay total minus the house commission, rounded down to whole EUR (manual;
// why/payout-rounding.md). The commission changes between attempts, so it is read live from /settings, never pinned.
let commissionPct = 0;
if (SLUG !== 'twenty-payouts') {
  const set = await call('GET', `${HQ}/settings`, { headers: { authorization: `Bearer ${attempt}` } });
  commissionPct = set.json?.commissionPct;
  if (set.status !== 200 || !Number.isFinite(commissionPct) || commissionPct < 0 || commissionPct >= 100) { console.log(`settings ${set.status}: ${mask(JSON.stringify(set.json))}; no run without the house commission`); process.exit(1); }
  console.log(`settings ${set.json.version}: commission ${commissionPct} %`);
}
// The payout is composed in pricing.mjs (discount, city tax, commission, cleaning fee; one Math.floor at the end).
const hostPayout = (p) => price({ ...p, commissionPct });

// Warm the payout connection so the first payout does not pay for TLS inside the time limit.
await fetch(`https://${PAY_HOST}/`, { method: 'HEAD', redirect: 'manual' }).catch(() => {});

const nights = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

// From S04E04 the night-desk records each booking event's change in host-desk/night/changes.json (git-ignored):
// { booking, nights | refund, event, at }. The manual: pay each booking as it is after the night's events — nights an
// event adds are part of the stay; a cancel's refund comes off the host's payout. One row per (event, booking, kind):
// a role that ran twice for one event must not add its nights or refund twice, so the last row of each wins.
const NIGHT = join(STATE, '..', 'night', 'changes.json');
const night = new Map(); // booking → { nights, refund, events: [] }
try {
  const rows = JSON.parse(readFileSync(NIGHT, 'utf8'));
  const last = new Map();
  for (const r of rows) for (const kind of ['nights', 'refund']) if (Number.isInteger(r[kind])) last.set(`${r.event}|${r.booking}|${kind}`, { booking: r.booking, kind, n: r[kind], event: r.event });
  for (const { booking, kind, n, event } of last.values()) {
    const c = night.get(booking) ?? { nights: 0, refund: 0, events: [] };
    c[kind] += n; c.events.push(`${event} ${kind} ${n}`);
    night.set(booking, c);
  }
  console.log(`night changes: ${night.size} booking(s) from ${NIGHT}${[...night].map(([b, c]) => `\n  ${b}: +${c.nights} night(s), refund ${c.refund} (${c.events.join('; ')})`).join('')}`);
} catch (e) {
  console.log(e.code === 'ENOENT' ? `night changes: none (${NIGHT} missing)` : `night changes unreadable: ${e.message}; no run on bookings the night may have changed`);
  if (e.code !== 'ENOENT') process.exit(1);
}
log({ night: Object.fromEntries(night) });
const usedNight = new Set();
// A booking the night-desk parked (a guest's request) waits on the owner's call, so its payout is the owner's too:
// flag it needs-owner, never pay it as booked (S04E04 run 1: BK-13202 paid as booked while its guest's "add one night"
// was parked → "Task 1: wrong answer"). Read from night/events.jsonl, the poller's own per-event log.
const parkedFor = new Map(); // booking → what the guest asked
try {
  const lines = readFileSync(join(STATE, '..', 'night', 'events.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const byId = new Map(lines.filter((l) => l.event).map((l) => [l.id, l.event]));
  const byFirst = new Map(); for (const l of lines) if (l.event && !byFirst.has(l.id)) byFirst.set(l.id, l.event);
  for (const l of lines) if (l.status === 'parked') { const e = byId.get(l.id); if (e?.data?.booking) parkedFor.set(e.data.booking, l.redelivery ? `${e.type} ${l.id} came back (delivery ${l.redelivery}) with new data ${JSON.stringify(e.data)}, first delivery ${JSON.stringify(byFirst.get(l.id)?.data)}` : `${e.type} ${l.id}: "${e.data.text ?? ''}"`); }
} catch (e) { if (e.code !== 'ENOENT') { console.log(`night events unreadable: ${e.message}`); process.exit(1); } }
console.log(`parked by the night-desk: ${[...parkedFor].map(([b, w]) => `${b} (${w})`).join('; ') || 'none'}`);
const KNOWN_BOOKING = new Set(['id', 'checkIn', 'checkOut', 'nightlyRate', 'cleaningFee', 'currency']);
const seen = new Set();

/** Why this task is not routine, or null. */
function notRoutine(task, amount) {
  const b = task.booking ?? {}, p = task.payout ?? {};
  const extra = Object.keys(task).filter((k) => !['status', 'n', 'of', 'runLimitMs', 'timeLeftMs', 'booking', 'payout', 'task', 'next', 'day'].includes(k));
  if (p.account !== onFile) return `payout asks for account ${p.account}, not the account on file ${onFile}; the manual makes any other account the owner's call`;
  try { if (new URL(p.url).host !== PAY_HOST) return `payout URL host ${new URL(p.url).host} is not ${PAY_HOST}`; } catch { return 'payout URL missing'; }
  if (b.currency !== 'EUR') return `currency ${b.currency}, not EUR`;
  if (![b.nightlyRate, b.cleaningFee].every((x) => Number.isFinite(x) && x >= 0)) return 'rate or cleaning fee missing or negative';
  if (!(Number.isInteger(amount) && amount > 0)) return `stay total ${amount} is not a positive whole number of euros (check-in ${b.checkIn}, check-out ${b.checkOut})`;
  if (seen.has(b.id)) return `booking ${b.id} already paid in this run`;
  if (parkedFor.has(b.id)) return `the night-desk parked a request for ${b.id} for the owner (${parkedFor.get(b.id)}); its payout waits on the owner's call`;
  const odd = Object.keys(b).filter((k) => !KNOWN_BOOKING.has(k));
  if (odd.length || extra.length) return `task carries fields the manual does not cover: ${[...odd, ...extra].join(', ')}`;
  return null;
}

// 2. Start and work every task.
let r = await call('POST', `${HQ}/${mode}`, { body: { attempt } });
const flagged = [], paid = [];
while (r.status === 200 && r.json.status === 'task') {
  const task = r.json, b = task.booking ?? {};
  const d = task.day ?? {};
  const ch = night.get(b.id) ?? { nights: 0, refund: 0 };
  if (night.has(b.id)) usedNight.add(b.id);
  const n = nights(b.checkIn, b.checkOut) + ch.nights;
  const stayTotal = n * b.nightlyRate + b.cleaningFee;
  const amount = Number.isFinite(stayTotal) ? hostPayout({ nights: n, nightlyRate: b.nightlyRate, cleaningFee: b.cleaningFee, guests: d.guests, bookedAt: d.bookedAt }) - ch.refund : stayTotal;
  const why = notRoutine(task, amount);
  if (why) {
    // A parked guest request is decided add-night or as-booked (API "decisions"): keep both amounts for finish.mjs.
    const amountAddNight = parkedFor.has(b.id) && Number.isFinite(stayTotal) ? hostPayout({ nights: n + 1, nightlyRate: b.nightlyRate, cleaningFee: b.cleaningFee, guests: d.guests, bookedAt: d.bookedAt }) - ch.refund : undefined;
    flagged.push({ n: task.n, task: task.task, booking: b, payout: task.payout, amount, amountAddNight, reason: why });
    r = await call('POST', `${HQ}/${mode}`, { body: { task: task.task, flag: 'needs-owner', reason: why } });
    continue;
  }
  const pay = await call('POST', PAY_URL, { headers: { 'x-payout-key': PAYOUT_KEY }, body: { task: task.task, account: onFile, amount } });
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

const unused = [...night.keys()].filter((id) => !usedNight.has(id));
if (unused.length) console.log(`night changes for bookings no task named: ${unused.join(', ')}`);
console.log(`paid ${paid.length}:${paid.map((p) => `#${p.n} ${p.id} â‚¬${p.amount}`).join(', ')}`);
console.log(`flagged ${flagged.length}: ${flagged.map((f) => `#${f.n} ${f.booking.id}: ${f.reason}`).join(' | ') || 'none'}`);
console.log(`last reply ${r.status}: ${JSON.stringify(r.json)}`);
