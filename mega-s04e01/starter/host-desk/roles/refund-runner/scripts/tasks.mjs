// tasks.mjs · the routine work of a factory-made role, in one go (the run allows a few seconds for all its tasks).
//   node tasks.mjs practice | run | survey
// survey: one practice that pays nothing and flags every task, to learn the job before its rule is trusted
// (factory/CHECKLIST.md). It logs each task and its settings and writes ../../../state/survey-<role>.json: every field
// path the tasks carry, with its kinds and an example, each text field that was filled, each id that came twice, and
// the settings versions. Write the job's rule from that file, not from the manual alone.
// Each task: read the house settings for this task (GET /settings, Bearer = the task), ask job.mjs what the task owes,
// then pay it and answer, or flag it needs-owner with the reason. The job's rule lives in job.mjs (made from
// factory/make-a-role/jobs/<role>.mjs); the house rules below hold for every role (factory/CHECKLIST.md):
//   facts read live: the course API index (payout URL), state/manual.json (this attempt's one manual), /settings per task;
//   secrets only to their hosts in hosts.json, every hop (wire.mjs); the account on file only; whole euros;
//   one result per task; every receipt checked; every request and reply logged on arrival, secrets masked.
// Log: ../../../state/<mode>-<role>-<time>.jsonl. State for finish.mjs: ../../../state/last-<role>-<mode>.json, written
// after every task, so a crash keeps the tokens of the tasks it flagged.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECRET_HOSTS, wire } from './wire.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROLE = JSON.parse(readFileSync(join(here, '..', 'role.json'), 'utf8')); // { role, api, made }, written by make.mjs
const mode = process.argv[2];
if (!['practice', 'run', 'survey'].includes(mode)) { console.log('usage: node tasks.mjs practice | run | survey'); process.exit(2); }
const { TICKET, ATTEMPT, PAYOUT_KEY } = process.env;
if (!ATTEMPT || (mode !== 'survey' && (!PAYOUT_KEY || PAYOUT_KEY.startsWith('<')))) { console.log('missing ATTEMPT or PAYOUT_KEY in vars.json'); process.exit(2); }

const STATE = join(here, '..', '..', '..', 'state');
mkdirSync(STATE, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const LOG = join(STATE, `${mode}-${ROLE.role}-${stamp}.jsonl`);
const STATE_FILE = join(STATE, `last-${ROLE.role}-${mode}.json`);
const secrets = [TICKET, ATTEMPT, PAYOUT_KEY].filter(Boolean);
const mask = (s) => secrets.reduce((t, v) => t.split(v).join('<masked>'), String(s));
const log = (o) => appendFileSync(LOG, mask(JSON.stringify({ t: new Date().toISOString(), ...o })) + '\n');
const call = (method, url, opt = {}) => wire(method, url, { ...opt, secrets: { TICKET, ATTEMPT, PAYOUT_KEY }, log });
/** The receipt's own claims (amount, account, task n), read from its payload; null if unreadable. */
const claims = (r) => { try { return JSON.parse(Buffer.from(String(r).split('.')[1], 'base64url').toString()); } catch { return null; } };

// 1. This attempt's manual, from the one fetch (a fetch here would start a new attempt).
let manual;
try {
  const saved = JSON.parse(readFileSync(join(STATE, 'manual.json'), 'utf8'));
  if (saved.attempt !== ATTEMPT) { console.log('state/manual.json belongs to another attempt than ATTEMPT in vars'); process.exit(1); }
  manual = saved.manual;
} catch { console.log('state/manual.json missing: save the manual from the one fetch there'); process.exit(1); }
const onFile = (manual.match(/account on file is (acct_[A-Za-z0-9]+)/) ?? [])[1];
if (!onFile) { console.log('the manual names no account on file; no run'); process.exit(1); }

// 2. The course API index, read now: where to start, answer, read settings and pay.
const idx = await call('GET', ROLE.api);
const course = mode === 'survey' ? 'practice' : mode; // a survey is a practice that pays nothing
if (idx.status !== 200 || !idx.json?.[course]?.url || !idx.json?.payouts?.url || !idx.json?.settings?.url) { console.log(`api index ${idx.status}: no ${course}, payouts or settings URL; no run`); process.exit(1); }
const START = idx.json[course].url, SETTINGS = idx.json.settings.url, PAY_URL = idx.json.payouts.url;
const PAY_HOST = new URL(PAY_URL).host;
if (!(SECRET_HOSTS.PAYOUT_KEY ?? []).includes(PAY_HOST)) { console.log(`the API pays at ${PAY_HOST}, which hosts.json does not list for PAYOUT_KEY; no run`); process.exit(1); }
console.log(`role ${ROLE.role} · ${mode} · account on file ${onFile} · pays at ${PAY_HOST} · log ${LOG}`);
for (const u of manual.match(/https?:\/\/[^\s)`'"]+/g) ?? []) {
  const h = new URL(u).host;
  if (!Object.values(SECRET_HOSTS).some((hs) => hs.includes(h))) console.log(`the manual names ${h}; no secret goes there (hosts.json)`);
}

// 3s. Survey: no rule, no payout. Every task is logged, its shape kept, and flagged; nothing is paid.
if (mode === 'survey') {
  const fields = new Map(); // path → { kinds, example, filled }
  const ids = new Map(); // "path=value" → [task n]
  const versions = new Set();
  const TOKENISH = /^v1.[A-Za-z0-9_-]{20,}/;
  const walk = (v, path, n) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) { for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, n); return; }
    const f = fields.get(path) ?? { kinds: new Set(), example: undefined, filled: 0, tasks: 0 };
    f.tasks += 1;
    f.kinds.add(v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
    if (v !== null && v !== '' && v !== undefined) { f.filled += 1; if (f.example === undefined) f.example = typeof v === 'string' && TOKENISH.test(v) ? '<token>' : v; }
    fields.set(path, f);
    if (/(^|.)id$/.test(path) && v != null) ids.set(`${path}=${v}`, [...(ids.get(`${path}=${v}`) ?? []), n]);
  };
  let r = await call('POST', START, { body: { attempt: ATTEMPT } });
  let count = 0;
  while (r.status === 200 && r.json?.status === 'task') {
    const task = r.json;
    count += 1;
    const { task: _token, next: _next, timeLeftMs: _t, ...shape } = task;
    walk(shape, '', task.n);
    const set = await call('GET', SETTINGS, { headers: { authorization: `Bearer ${task.task}` } });
    if (set.status === 200) { versions.add(JSON.stringify(set.json)); walk({ settings: set.json }, '', task.n); }
    r = await call('POST', START, { body: { task: task.task, flag: 'needs-owner', reason: 'survey: this practice only reads the job; nothing is paid' } });
  }
  const out = {
    role: ROLE.role, at: new Date().toISOString(), tasks: count, log: LOG,
    fields: Object.fromEntries([...fields].map(([p, f]) => [p, { kinds: [...f.kinds], example: f.example, filled: `${f.filled} of ${f.tasks}` }])),
    textFilled: [...fields].filter(([p, f]) => f.kinds.has('string') && f.kinds.has('null')).map(([p]) => p),
    repeatedIds: Object.fromEntries([...ids].filter(([, ns]) => ns.length > 1)),
    settings: [...versions].map((v) => JSON.parse(v)),
    last: { status: r.status, reply: r.json },
  };
  const file = join(STATE, `survey-${ROLE.role}.json`);
  writeFileSync(file, mask(JSON.stringify(out, null, 2)));
  console.log(`survey: ${count} task(s), ${fields.size} field paths, nothing paid; ${Object.keys(out.repeatedIds).length} id(s) came twice; text sometimes filled: ${out.textFilled.join(', ') || 'none'}`);
  console.log(`settings seen: ${out.settings.map((s) => JSON.stringify(s)).join(' | ')}`);
  console.log(`last reply ${r.status}: ${mask(JSON.stringify(r.json))}`);
  console.log(`shape: ${file}`);
  process.exit(0);
}

// 3. The job's rule: decide({ task, settings, manual, onFile }) → { amount, account?, key?, data?, why } | { flag: reason }.
//    key is what one result is for (e.g. a refund id); data is what was asked. One result per key (ADR 0021): a key that
//    comes again is never paid again. The course takes only an answer with a payout for that task, or a flag, so a
//    repeat is flagged for the owner with the first task's number and amount. (2026-11-21: answer with no receipt refused,
//    practice 2; the first receipt reused refused, "No payout matching this task and this answer", practice 4; paid 0
//    and answered 0, "Task 5: wrong answer", practice 5. Flagged, practice 3, passed task 5.)
const { default: decide } = await import('./job.mjs');

await fetch(`https://${PAY_HOST}/`, { method: 'HEAD', redirect: 'manual' }).catch(() => {}); // warm TLS outside the clock

const st = { role: ROLE.role, mode, attempt: '<in vars>', onFile, payUrl: PAY_URL, log: LOG, paid: [], flagged: [], answered: [], repeats: [] };
const save = () => writeFileSync(STATE_FILE, JSON.stringify(st, null, 2));
const seenBooking = new Set();
const results = new Map(); // job key → { n, amount, data }
const flag = async (task, reason, extra = {}) => {
  st.flagged.push({ n: task.n, task: task.task, booking: task.booking?.id, payout: task.payout, reason, ...extra });
  save();
  return call('POST', START, { body: { task: task.task, flag: 'needs-owner', reason } });
};

// 4. Start and work every task.
let r = await call('POST', START, { body: { attempt: ATTEMPT } });
while (r.status === 200 && r.json?.status === 'task') {
  const task = r.json;
  const set = await call('GET', SETTINGS, { headers: { authorization: `Bearer ${task.task}` } });
  if (set.status !== 200) { r = await flag(task, `the house settings for this task could not be read (${set.status}); no refund without them`); continue; }
  let d;
  try { d = decide({ task, settings: set.json, manual, onFile }); } catch (e) { d = { flag: `the job rule failed on this task: ${e.message}` }; }
  if (d?.flag) { r = await flag(task, d.flag, { amount: d.amount }); continue; }
  if (d?.key !== undefined && results.has(d.key)) {
    const first = results.get(d.key);
    if (JSON.stringify(first.data) !== JSON.stringify(d.data)) { r = await flag(task, `${d.key} came again with other data than task #${first.n} (${JSON.stringify(first.data)} then ${JSON.stringify(d.data)}); the owner decides which holds`); continue; }
    st.repeats.push({ n: task.n, booking: task.booking?.id, key: d.key, of: first.n, amount: first.amount });
    r = await flag(task, `${d.key} came again with the same data: it was paid once already in task #${first.n} (${first.amount} EUR to the account on file); not paid twice, the owner decides this repeat`, { repeatOf: first.n });
    continue;
  }
  const amount = d?.amount, account = d?.account ?? task.payout?.account ?? onFile;
  const why =
    !Number.isInteger(amount) || amount < 0 ? `the job gave ${amount}, not a whole number of euros`
    : account !== onFile ? `the task asks to pay ${account}, not the account on file ${onFile}; any other account is the owner's call`
    : task.payout?.url && new URL(task.payout.url).host !== PAY_HOST ? `the task's payout URL is on ${new URL(task.payout.url).host}, not ${PAY_HOST}`
    : d.key === undefined && task.booking?.id && seenBooking.has(task.booking.id) ? `booking ${task.booking.id} was already answered in this run`
    : null;
  if (why) { r = await flag(task, why, { amount }); continue; }
  if (task.booking?.id) seenBooking.add(task.booking.id);
  const pending = d.key !== undefined ? { n: task.n, amount, data: d.data } : null;
  // An answer always carries a payout receipt (API answer shape), so a refund of 0 is sent to the payout API as 0 too.
  const pay = await call('POST', PAY_URL, { headers: { 'x-payout-key': PAYOUT_KEY }, body: { task: task.task, account: onFile, amount } });
  const c = pay.json?.receipt ? claims(pay.json.receipt) : null;
  const wrong = pay.blocked ? pay.json.blocked
    : pay.status !== 200 || !pay.json?.receipt ? `payout reply ${pay.status}: ${JSON.stringify(pay.json).slice(0, 200)}`
    : pay.hops ? `payout was redirected (${pay.hops} hop(s)) to ${pay.finalUrl}`
    : c && ((c.amt !== undefined && c.amt !== amount) || (c.acct !== undefined && c.acct !== onFile) || (c.n !== undefined && c.n !== task.n)) ? `receipt says ${c.amt} to ${c.acct} for task ${c.n}, not ${amount} to ${onFile} for task ${task.n}` : null;
  if (wrong) { r = await flag(task, `payout did not go as sent: ${wrong}; the owner must check it`, { amount, paidUnclear: true }); continue; }
  if (pending) results.set(d.key, { ...pending, receipt: pay.json.receipt });
  (amount === 0 ? st.answered : st.paid).push({ n: task.n, booking: task.booking?.id, amount, key: d.key, why: d.why });
  save();
  r = await call('POST', START, { body: { task: task.task, answer: amount, payout: pay.json.receipt } });
}
st.last = { status: r.status, reply: r.json };
save();

console.log(`paid ${st.paid.length}: ${st.paid.map((p) => `#${p.n} ${p.booking} €${p.amount}`).join(', ') || 'none'}`);
console.log(`answered 0 ${st.answered.length}: ${st.answered.map((p) => `#${p.n} ${p.booking}: ${p.why}`).join(' | ') || 'none'}`);
console.log(`repeats ${st.repeats.length} (flagged, not paid twice): ${st.repeats.map((p) => `#${p.n} = #${p.of} ${p.key}`).join(', ') || 'none'}`);
console.log(`flagged ${st.flagged.length}: ${st.flagged.map((f) => `#${f.n} ${f.booking}: ${f.reason}`).join(' | ') || 'none'}`);
console.log(`last reply ${r.status}: ${mask(JSON.stringify(r.json))}`);
console.log(`state: ${STATE_FILE}`);
