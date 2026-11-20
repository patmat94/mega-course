// The night's poller: claims a job on the board, keeps it beating, starts the night, pulls the events and wakes the
// night-desk for each one (run.mjs), then acks the event and posts its result. It stops after the night closes.
//
//   node roles/night-desk/night.mjs <challenge url>      (from host-desk/)
//
// The attempt comes from host-desk/vars.json (`ATTEMPT`). JOB names the job (default `night-desk/1`).
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { mayReach } from './extensions/hosts.mjs';

// S04E04 nights 1-3: many UND_ERR_CONNECT_TIMEOUT to hq.mega.dev and a timed-out model call, while the same host answered
// 15 of 15 times between nights. Node's connection racing gives each address 250 ms by default; on a slow moment that
// fails the connect. 3 s here, and the same for the role (Pi's model calls) through NODE_OPTIONS.
setDefaultAutoSelectFamilyAttemptTimeout(3_000);
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --network-family-autoselection-attempt-timeout=3000`.trim();

const here = dirname(fileURLToPath(import.meta.url));
const desk = join(here, '..', '..');
const base = (process.argv[2] ?? process.env.CHALLENGE_URL ?? '').replace(/\/+$/, '');
const JOB = process.env.JOB ?? 'night-desk/1';
const PULL_EVERY_MS = 5_000;
const AFTER_CLOSE_MS = 60_000;

if (!/^https?:\/\//.test(base)) {
  console.error('usage: node roles/night-desk/night.mjs <challenge url>');
  process.exit(1);
}
// The attempt goes to the course only: a host it may reach (roles/night-desk/hosts.json), https (security review 2026-11-16 #10).
if (!mayReach('ATTEMPT', base) && !mayReach('TICKET', base)) {
  console.error(`not started: the attempt may not reach ${new URL(base).host} (roles/night-desk/hosts.json)`);
  process.exit(1);
}
const attempt = JSON.parse(readFileSync(join(desk, 'vars.json'), 'utf8')).ATTEMPT;
if (!attempt) {
  console.error('No ATTEMPT in host-desk/vars.json: fetch the manual once and put the attempt from its reply there.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// S04E04 fix: a connect timeout to the course (2026-11-20 ~15:20 UTC) threw out of the main loop and killed the poller.
// Now a failed call is retried up to 3 times, then returns status 0; the loop pulls again on its next turn, so the
// poller and its heartbeats outlive a short outage.
async function call(method, path, body) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${attempt}`, ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15_000),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) console.error(`${method} ${path} -> ${res.status} ${json.message ?? ''}`);
      if (res.status >= 500 && i < 3) { await sleep(1_000 * i); continue; }
      return { status: res.status, body: json };
    } catch (e) {
      console.error(`${method} ${path}: ${e?.cause?.code ?? e?.name ?? 'error'} (try ${i} of 3)`);
      if (i >= 3) return { status: 0, body: {} };
      await sleep(1_000 * i);
    }
  }
}

// One start of the night-desk for one event: the event in a file, its result back in another. Its answer = the status
// it wrote (applied, conflict or parked). It failed, ran out of time or wrote none → no status and why: the poller then
// posts nothing for that event and says so in its log (a made-up result would tell the course the desk acted).
// ROLE_TIMEOUT_MS sets the time (default 90 s, inside the 2 minutes an event has for its result).
const ROLE_TIMEOUT_MS = Number(process.env.ROLE_TIMEOUT_MS) || 90_000;
const STATUSES = ['applied', 'conflict', 'parked'];
function wake(event, timeoutMs = ROLE_TIMEOUT_MS) {
  const inbox = join(desk, 'night', 'inbox');
  mkdirSync(inbox, { recursive: true });
  const eventFile = join(inbox, `${event.seq}.json`);
  const resultFile = join(inbox, `${event.seq}.result.json`);
  writeFileSync(eventFile, JSON.stringify(event, null, 2));
  rmSync(resultFile, { force: true });
  return new Promise((done) => {
    let late = false;
    const child = spawn(process.execPath, [join(here, 'run.mjs')], { cwd: here, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, NIGHT_EVENT: eventFile, NIGHT_RESULT: resultFile } });
    const timer = setTimeout(() => {
      late = true;
      child.kill();
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      let status;
      try {
        status = JSON.parse(readFileSync(resultFile, 'utf8')).status;
      } catch {}
      if (STATUSES.includes(status)) return done({ status });
      const why = late ? `the night-desk ran over ${Math.round(timeoutMs / 1000)} s` : code ? `the night-desk stopped with exit code ${code}` : 'the night-desk wrote no status';
      done({ status: null, why });
    });
  });
}

const claim = await call('POST', '/board/claims', { job: JOB, role: 'night-desk' });
if (claim.status !== 200) process.exit(1);
const beatEveryMs = Math.max(claim.body.beatEveryMs ?? 30_000, 1_000);
await call('POST', '/board/heartbeats', { job: JOB });
const beats = setInterval(() => void call('POST', '/board/heartbeats', { job: JOB }).catch(() => {}), beatEveryMs);

// S04E04 run 4 hint: "Who else could take events from your outbox, and where would you see them?" On the board, the
// ownerless course job `legacy/export` ran on every attempt, and every night lost seq 5 to it. With the human's yes
// (2026-11-20), the poller stops that one job by id (POST /board/stop) before the night opens. Run 5 was still refused
// at task 18 with the same hint; the one other running job was `rook/lint` (owner rook, asleep). With the human's second
// yes (2026-11-20), it is stopped too. Only jobs named in STOP_JOBS are stopped, owned or not; nothing else on the board.
const STOP_JOBS = (process.env.STOP_JOBS ?? 'legacy/export,rook/lint').split(',').map((s) => s.trim()).filter(Boolean);
const board = await call('GET', '/board');
console.log(`board: ${(board.body.jobs ?? []).map((j) => `${j.id} (${j.owner ?? 'no owner'}, ${j.state ?? '?'})`).join(', ')}`);
for (const j of board.body.jobs ?? []) {
  if (!STOP_JOBS.includes(j.id) || j.id === JOB || j.state === 'stopped') continue;
  const stop = await call('POST', '/board/stop', { job: j.id });
  console.log(`stopped job ${j.id}: ${stop.status} ${JSON.stringify(stop.body)}`);
}

const night = await call('POST', '/events/window');
if (night.status !== 200) process.exit(1);
const closesAt = Date.parse(night.body.closesAt);
console.log(`night: ${night.body.opensAt} → ${night.body.closesAt} · job ${JOB}`);

// S04E04 change: each event is woken at once, in parallel, so a burst of events cannot push a later one past its
// 2 minutes behind the earlier ones' role starts. One line per event in night/events.jsonl, written as it happens:
// when it came, when its result was posted, the status and the course's reply (ADR 0014).
const EVENTS_LOG = join(desk, 'night', 'events.jsonl');
mkdirSync(dirname(EVENTS_LOG), { recursive: true });
const note = (o) => appendFileSync(EVENTS_LOG, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n');
const seen = new Map(); // event id → its first delivery's data
const inFlight = new Set();
const chains = new Map();
async function handle(event) {
  const got = Date.now();
  note({ seq: event.seq, id: event.id, type: event.type, got: true, event });
  const ack = await call('POST', '/events/ack', { ids: [event.id] });
  note({ seq: event.seq, id: event.id, ack: ack.status, reply: ack.body });
  // S04E04 night 2: one role start stopped with exit code 1 during a network outage, and event 10 got no result. A start
  // that ends with no status is started again while the event's 2 minutes allow one more (deadline 105 s after it came,
  // leaving time to post). A start that recorded a change and then failed is harmless to repeat: the batch keeps one row
  // per (event, booking, kind).
  const deadline = got + 105_000;
  let status, why;
  for (let tryNo = 1; ; tryNo++) {
    const left = deadline - Date.now() - 5_000;
    ({ status, why } = await wake(event, Math.min(ROLE_TIMEOUT_MS, left)));
    if (status) break;
    note({ seq: event.seq, id: event.id, try: tryNo, failed: why });
    console.error(`event ${event.seq}: try ${tryNo} gave no status (${why})`);
    if (deadline - Date.now() < 20_000) break;
  }
  if (status) {
    // S04E04 night 3: three result posts for event 2 timed out and it got no result. The post is retried until the
    // event's 2 minutes are nearly up (118 s after it came), not just 3 times.
    let res;
    do {
      res = await call('POST', '/events/results', { id: event.id, result: { status } });
      if (res.status === 200) break;
      note({ seq: event.seq, id: event.id, status, posted: res.status, retrying: true });
      await sleep(1_000);
    } while (Date.now() < got + 118_000);
    note({ seq: event.seq, id: event.id, status, posted: res.status, secs: (Date.now() - got) / 1000, reply: res.body });
    console.log(`event ${event.seq}: ${status} -> ${res.status} in ${((Date.now() - got) / 1000).toFixed(1)} s`);
    seen.get(event.id)?.resolve?.(res.status === 200 ? status : null);
  } else {
    seen.get(event.id)?.resolve?.(null);
    note({ seq: event.seq, id: event.id, status: null, why, secs: (Date.now() - got) / 1000 });
    console.error(`event ${event.seq} (${event.id}): no result posted: ${why}.`);
  }
}

let cursor = '0';
while (true) {
  const page = await call('GET', `/events?after=${cursor}&job=${encodeURIComponent(JOB)}`);
  if (page.status === 200) {
    for (const event of page.body.events ?? []) {
      // Its seq names the event's file in night/inbox: a whole number only (security review 2026-11-16 #11).
      if (!Number.isInteger(event.seq) || event.seq < 0) {
        console.error(`event skipped: its seq is not a whole number (${JSON.stringify(event.seq)})`);
        continue;
      }
      // A redelivery (same id, delivery > 1) is the same event: applied once, never again. Acked again, and logged with
      // whether its data matches the first delivery (S04E04 night 1: evt_edef531f7ebd came back with 3 nights, not 2).
      // S04E04 run 6 hint: "If an event comes back with the same id but says something new, is it still a retry?" The
      // course keeps a result per delivery (API: results → "the result the course keeps for this delivery"). A true
      // retry (same data) gets the first delivery's result again. One that says something new is not a retry. Run 7
      // answered it `conflict` while the batch still paid the first delivery's change, and was refused. With the human's
      // call (2026-11-20): the desk does not choose between the two versions; it is `parked`, nothing is recorded, and
      // the batch flags the booking so the owner decides its payout.
      if (seen.has(event.id)) {
        const first = seen.get(event.id);
        const same = JSON.stringify(first.data) === JSON.stringify(event.data);
        note({ seq: event.seq, id: event.id, redelivery: event.delivery ?? null, same, event });
        console.log(`event ${event.seq}: redelivery of ${event.id}${same ? '' : ' with different data'}: not applied again`);
        const got = Date.now();
        const p = (async () => {
          const ack = await call('POST', '/events/ack', { ids: [event.id] });
          note({ seq: event.seq, id: event.id, ack: ack.status, reply: ack.body });
          // S04E04 run 8 hint: "How many times did your desk tell the course it applied that event?" A true retry is
          // acked only: the desk told the course its result once, with the first delivery, and did nothing new.
          if (same) { note({ seq: event.seq, id: event.id, redelivery: event.delivery ?? null, result: 'none (a retry: acked, its result was posted once)' }); return; }
          const status = 'parked';
          if (!status) { note({ seq: event.seq, id: event.id, status: null, why: 'the first delivery got no result' }); return; }
          let res;
          do {
            res = await call('POST', '/events/results', { id: event.id, result: { status } });
            if (res.status === 200) break;
            await sleep(1_000);
          } while (Date.now() < got + 118_000);
          note({ seq: event.seq, id: event.id, redelivery: event.delivery ?? null, status, posted: res.status, secs: (Date.now() - got) / 1000, reply: res.body });
          console.log(`event ${event.seq}: redelivery ${status} -> ${res.status} in ${((Date.now() - got) / 1000).toFixed(1)} s ${JSON.stringify(res.body)}`);
        })().catch((e) => console.error(`event ${event.seq}: ${e.message}`)).finally(() => inFlight.delete(p));
        inFlight.add(p);
        continue;
      }
      const entry = { data: event.data };
      entry.status = new Promise((r) => (entry.resolve = r));
      seen.set(event.id, entry);
      console.log(`event ${event.seq}: ${event.type} ${event.id}`);
      // Events for one booking run in arrival order (a cancel after a change must see the change); others in parallel.
      const key = String(event.data?.booking ?? event.data?.bookingId ?? event.data?.booking_id ?? event.id);
      const prev = chains.get(key) ?? Promise.resolve();
      const p = prev.then(() => handle(event)).catch((e) => { entry.resolve(null); console.error(`event ${event.seq}: ${e.message}`); }).finally(() => inFlight.delete(p));
      inFlight.add(p);
      chains.set(key, p);
    }
    cursor = page.body.cursor ?? cursor;
  }
  if (Date.now() > closesAt + AFTER_CLOSE_MS && !(page.body.events ?? []).length && !inFlight.size) break;
  await sleep(PULL_EVERY_MS);
}
clearInterval(beats);
console.log('The night is over. Changes: host-desk/night/changes.json');
if (!existsSync(join(desk, 'night', 'changes.json'))) console.log('(no changes recorded)');
