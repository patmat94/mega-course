#!/usr/bin/env node
// parked.mjs · your human's calls, parked by the job and finished once. Rule 3 of the clock pack, in code.
//
//   node parked.mjs list [--dir folder]
//   node parked.mjs show <id> [--dir folder]
//   node parked.mjs decide <id> yes|no [--dir folder]       your human types this one, in their terminal
//   node parked.mjs finish <id> --job job.mjs [--hosts hosts.json] [--vars vars.json] [--budget 5m] [--dir folder] [--trace trace.jsonl]
//   node parked.mjs --self-test
//
// A job parks an item it may not decide: run-job.mjs writes the item's own copy to parked/<id>.json,
// with its sha256, so the job keeps the data it needs to finish, not a server. Your human reads it and
// decides yes or no. `finish` then runs the job's finish(copy, decision, ctx) once, in a child process
// with no secret in its environment, and writes finished/<id>.json. It claims that file before it runs
// and adds a line to finished/ledger.jsonl, a file that only grows, so a second finish says
// `already finished <id>` and sends nothing, also when the first one failed half way or its file was
// deleted: your human looks first and decides what happens next. A copy edited by hand without its
// copySha is refused, and so is a decision with no decidedAt after its parkedAt, one not later than the
// last line of the newest run in trace.jsonl (or later than now), a file not named exactly <id>.json,
// and a file a run found written by code. finish also refuses while trace.jsonl has a line it cannot
// read, is missing, or ends in a run with no exit line (a run going, or killed). --budget (default 5m) counts
// from the start: a job that does not load in it is refused with nothing sent, and a finish that runs
// past it is stopped and recorded "unfinished": it may have sent part of its work.
//
// `decide` reads the answer from a terminal, with no NODE_OPTIONS, no Node flag and no wrapper script, so
// a plain command that an agent starts
// cannot run it. That is a speed bump, not a wall: see the README for the harness rules that are one.
//
// Scope: parked items only, by their id. Exit codes: 0 done, 1 refused or failed, 2 a usage error.
// Plain Node.js 20 or newer, no dependencies.

import { createHash } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { isatty } from 'node:tty';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hider, hostLists, listedValues, MIN_SECRET, readJson, readVars, shown, tooShort } from './egress.mjs';

// An id is a file name on every system: letters, digits, dot, dash, underscore, and no device name of
// Windows (con, nul, com1, …).
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9]|conin\$|conout\$)(\..*)?$/i;
export function checkId(id) {
  const s = String(id ?? '');
  if (!ID.test(s) || DEVICE.test(s) || s.endsWith('.')) {
    throw new Error(`${JSON.stringify(s).slice(0, 120)} is not an id: use letters, digits, dot, dash or underscore, at most 100`);
  }
  return s;
}

const parkedPath = (dir, id) => join(dir, 'parked', `${checkId(id)}.json`);
const finishedPath = (dir, id) => join(dir, 'finished', `${checkId(id)}.json`);
const ledgerPath = (dir) => join(dir, 'finished', 'ledger.jsonl');
const refuse = (message) => Object.assign(new Error(message), { refused: true });
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// Write a file whole or not at all: a temporary file next to it, then a rename.
function writeWhole(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, path);
}

function readItem(path, id) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Error(`${id}: ${path} cannot be read (${e.code ?? 'not JSON'})`);
  }
}

// The item's own file, or null. Pay1 and pay1 are one file on Windows and macOS: a file that holds
// another id is refused, never used.
function readOwn(path, id, where) {
  const item = readItem(path, id);
  if (item && item.id !== id) throw refuse(`${where}/${id}.json holds ${JSON.stringify(item.id)}: ids that differ only in case share one file here`);
  return item;
}

// Has a finish of this id started, by the ledger? The ledger only grows, so a deleted
// finished/<id>.json does not make the item new.
function inLedger(dir, id) {
  let text;
  try {
    text = readFileSync(ledgerPath(dir), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
  return text.split('\n').some((line) => {
    try {
      return JSON.parse(line).id === id;
    } catch {
      return false;
    }
  });
}

// Refused once a finish has started: by its file, or by its ledger line when the file is gone.
function refuseFinished(dir, id) {
  const done = readOwn(finishedPath(dir, id), id, 'finished');
  if (done) throw refuse(`already finished ${id}`);
  if (inLedger(dir, id)) throw refuse(`finished/${id}.json is missing: ask your human`);
}

// The parked file, checked: its name is exactly <id>.json, and the copy is the one the job parked.
function checkedItem(dir, id) {
  const item = show(dir, id);
  if (!readdirSync(join(dir, 'parked')).includes(`${id}.json`)) {
    throw refuse(`parked/ holds no file named exactly ${id}.json (one in another case is not the runner's): ask your human; do not finish it`);
  }
  if (item.copySha !== sha256(JSON.stringify(item.copy))) throw refuse(`parked/${id}.json was changed after it was parked: ask your human`);
  return item;
}

// Park one item. Keeps a parked file that is already there and still waits for your human, refuses one
// that already holds a decision (only your human decides, in their terminal, after the park), and never
// parks an item that was finished. Returns 'parked', 'kept' or 'finished'.
export function park(dir, id, reason, copy) {
  checkId(id);
  if (typeof reason !== 'string' || reason.trim() === '') throw new Error(`${id}: a park needs a reason`);
  if (readOwn(finishedPath(dir, id), id, 'finished') || inLedger(dir, id)) return 'finished';
  const path = parkedPath(dir, id);
  const there = readOwn(path, id, 'parked');
  if (there) {
    if (there.decision != null) throw refuse(`parked/${id}.json already holds a decision no human recorded in this run: ask your human; do not finish it`);
    return 'kept';
  }
  const json = JSON.stringify(copy ?? null);
  writeWhole(path, { id, reason, copy: JSON.parse(json), copySha: sha256(json), parkedAt: new Date().toISOString(), decision: null, decidedAt: null });
  return 'parked';
}

// Every parked item: id, reason, decision, and whether it was finished.
export function list(dir) {
  const folder = join(dir, 'parked');
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((f) => f.endsWith('.json') && ID.test(f.slice(0, -5)) && !DEVICE.test(f.slice(0, -5)))
    .sort()
    .map((f) => {
      const id = f.slice(0, -5);
      const item = readItem(join(folder, f), id) ?? {};
      const done = readItem(finishedPath(dir, id), id);
      const finished = done?.id === id ? done.state : inLedger(dir, id) ? 'its file is missing' : null;
      return { id, reason: item.reason ?? '', decision: item.decision ?? null, finished };
    });
}

// Every .json file in parked/, as a Map of its name (without .json) to { item }, or to
// { item, misnamed: true } when it cannot be read or holds another id. The runner names each file
// exactly <its id>.json: P1.json holding p1 (it opens as p1.json on Windows and macOS) is code's.
export function parkedFiles(dir) {
  const out = new Map();
  const folder = join(dir, 'parked');
  if (!existsSync(folder)) return out;
  for (const f of readdirSync(folder)) {
    if (!f.endsWith('.json')) continue;
    const name = f.slice(0, -5);
    let item = null;
    try {
      item = JSON.parse(readFileSync(join(folder, f), 'utf8'));
    } catch {}
    out.set(name, item?.id === name ? { item } : { item, misnamed: true });
  }
  return out;
}

// What trace.jsonl says about decisions: each run's window (from its "started" line to its exit line,
// or its last line when it was killed hard), the decisions a run found written by code, and the newest
// run (its last line, and whether it has an exit line). A line that cannot be read is refused: code
// wrote in the trace, or a write was cut. null when there is no trace or no run in it.
function traceRecord(tracePath) {
  let text;
  try {
    text = readFileSync(tracePath, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw refuse(`${tracePath} cannot be read (${e.code}): ask your human; do not finish it`);
  }
  const windows = [];
  const byCode = [];
  let open = null;
  let newest = null;
  text.split('\n').forEach((line, n) => {
    if (!line.trim()) return;
    let l;
    try {
      l = JSON.parse(line);
    } catch {
      throw refuse(`trace.jsonl line ${n + 1} cannot be read: code wrote in the trace, or a write was cut; ask your human, and do not finish it`);
    }
    const at = Date.parse(l?.at);
    if (l?.run === 'started') {
      if (open) windows.push(open);
      open = Number.isNaN(at) ? null : [at, at];
      newest = { last: Number.isNaN(at) ? Infinity : at, exited: false };
      return;
    }
    if (newest) newest.last = Math.max(newest.last, Number.isNaN(at) ? Infinity : at);
    if (open && !Number.isNaN(at)) open[1] = Math.max(open[1], at);
    if (l?.exit) {
      if (open) windows.push(open), (open = null);
      if (newest) newest.exited = true;
    }
    if (l?.result === 'not-by-human' && typeof l.id === 'string') byCode.push(l);
  });
  if (open) windows.push(open);
  return newest ? { windows, byCode, newest } : null;
}

export function show(dir, id) {
  const item = readOwn(parkedPath(dir, id), id, 'parked');
  if (!item) throw refuse(`not parked ${id}`);
  return item;
}

// Record your human's yes or no. Not exported: only the command line, from a terminal, records one.
function record(dir, id, decision) {
  if (decision !== 'yes' && decision !== 'no') throw new Error(`decide takes yes or no, not ${JSON.stringify(decision)}`);
  const item = checkedItem(dir, id);
  refuseFinished(dir, id);
  const was = item.decision;
  writeWhole(parkedPath(dir, id), { ...item, decision, decidedAt: new Date().toISOString() });
  return was;
}

// Run the job's finish once for a decided item, in a child process with no secret in its environment.
// ctx.send comes back to this process and goes through egress with the job's hosts.
export async function finish(dir, id, jobPath, { hosts = {}, vars = process.env, lookup, budgetMs = 5 * 60_000, signal, trace = join(dir, 'trace.jsonl') } = {}) {
  const item = checkedItem(dir, id);
  refuseFinished(dir, id);
  if (item.decision !== 'yes' && item.decision !== 'no') {
    throw refuse(`not decided ${id}: your human runs node parked.mjs decide ${id} yes|no in their own terminal`);
  }
  // decide records when; a decision with no time, or one from before the park, no human recorded here.
  if (!item.decidedAt || !(Date.parse(item.decidedAt) >= Date.parse(item.parkedAt))) {
    throw refuse(`parked/${id}.json holds a decision with no time your human recorded it after the park: ask your human; do not finish it`);
  }
  // A job's code can write a decision while it runs. Refused: a decision inside a run's window, one a
  // run found set, one not later than the newest run's last line, and one later than now. Your human
  // decides it again after the run.
  const decidedAt = Date.parse(item.decidedAt);
  const record = traceRecord(trace);
  if (!record) throw refuse(`${trace} is missing or holds no run, and parked/ is not empty: finish reads the run's trace (give the run's --trace); ask your human`);
  const { windows, byCode, newest } = record;
  if (!newest.exited) throw refuse('a run is going, or was killed before it read parked/: ask your human');
  const flagged = byCode.some((b) => b.id === id && (b.why === 'appeared' ? b.copySha === item.copySha : b.decidedAt === item.decidedAt));
  if (flagged || windows.some(([from, to]) => decidedAt >= from && decidedAt <= to)) {
    throw refuse(`parked/${id}.json got its decision during a run (see trace.jsonl), set by code or by your human: your human decides it again after the run; do not finish it`);
  }
  if (!(decidedAt > newest.last)) throw refuse(`parked/${id}.json was decided before the last run ended (see trace.jsonl): your human decides it again after the run; do not finish it`);
  if (decidedAt > Date.now()) throw refuse(`parked/${id}.json holds a decidedAt later than now: ask your human; do not finish it`);
  const lists = hosts instanceof Map ? hosts : hostLists(hosts);
  const short = tooShort(vars, lists);
  if (short) throw new Error(`vars: ${short} is too short to be a secret (under ${MIN_SECRET} characters)`);
  const hide = hider(listedValues(vars, lists));
  const { startJob } = await import('./run-job.mjs');
  // Every refused send goes in finished/<id>.json, also one the job caught or never awaited.
  const refusals = [];
  const onRefused = (r) => refusals.push(`${r.message}: ${r.sent ? 'the API may have acted' : 'nothing was sent'}`);
  const withRefusals = (o) => (refusals.length ? { ...o, refusals: [...refusals] } : o);
  const job = startJob(jobPath, { mode: 'finish', lists, vars, lookup, hide, onRefused });
  // One budget from the start: loading the job counts too.
  const secs = `${Math.round(budgetMs / 1000)}s`;
  let timer;
  const outOfTime = new Promise((ok) => (timer = setTimeout(() => ok({ type: 'cut', why: `the runner stopped it when its budget (${secs}) ran out` }), budgetMs)));
  try {
    const ready = await Promise.race([job.next(), outOfTime]);
    if (ready.type === 'cut') throw refuse(`the job did not load within ${secs}; nothing was sent`);
    if (ready.type !== 'ready') throw new Error(hide(ready.message));
    // The claim: only one finish creates this file, and its ledger line stays when the file is deleted.
    const path = finishedPath(dir, id);
    mkdirSync(dirname(path), { recursive: true });
    refuseFinished(dir, id);
    let fd;
    try {
      fd = openSync(path, 'wx');
    } catch (e) {
      if (e.code === 'EEXIST') throw refuse(`already finished ${id}`);
      throw e;
    }
    const started = { id, decision: item.decision, copySha: item.copySha, state: 'started', startedAt: new Date().toISOString() };
    writeSync(fd, `${JSON.stringify(started, null, 2)}\n`);
    closeSync(fd);
    appendFileSync(ledgerPath(dir), `${JSON.stringify({ id, copySha: item.copySha, startedAt: started.startedAt })}\n`);
    job.post({ type: 'finish', id, copy: item.copy, decision: item.decision });
    const stopped = new Promise((ok) => {
      if (signal?.aborted) ok({ type: 'cut', why: 'it was stopped' });
      signal?.addEventListener('abort', () => ok({ type: 'cut', why: 'it was stopped' }), { once: true });
    });
    const r = await Promise.race([job.next(), outOfTime, stopped]);
    if (r.type === 'cut') {
      await job.stop();
      const error = `${r.why}; it may have sent part of its work`;
      writeWhole(path, withRefusals({ ...started, state: 'unfinished', error, finishedAt: new Date().toISOString() }));
      return withRefusals({ state: 'unfinished', decision: item.decision, error });
    }
    if (r.type === 'finished' && r.ok) {
      const kept = r.result === undefined ? null : JSON.parse(hide(JSON.stringify(r.result)));
      writeWhole(path, withRefusals({ ...started, state: 'done', result: kept, finishedAt: new Date().toISOString() }));
      return withRefusals({ state: 'done', decision: item.decision, result: kept });
    }
    const error = hide(r.message ?? 'the job ended without an answer');
    writeWhole(path, withRefusals({ ...started, state: 'failed', error, finishedAt: new Date().toISOString() }));
    return withRefusals({ state: 'failed', decision: item.decision, error });
  } finally {
    clearTimeout(timer);
    await job.stop();
  }
}

// ---------------------------------------------------------------------------------------------------
// The command line.

const USAGE = [
  'usage: node parked.mjs list [--dir folder]',
  '       node parked.mjs show <id> [--dir folder]',
  '       node parked.mjs decide <id> yes|no [--dir folder]',
  '       node parked.mjs finish <id> --job job.mjs [--hosts hosts.json] [--vars vars.json] [--budget 5m] [--dir folder] [--trace trace.jsonl]',
].join('\n');

// A preload, a Node flag or a script that imports this one can fake a terminal, so decide runs with none:
// NODE_OPTIONS empty, no flag, and this file the entry script (import.meta.main where Node has it; no
// CommonJS entry). A wrapper on a Node with no import.meta.main still gets past it: a speed bump.
const notPlain = () =>
  (process.env.NODE_OPTIONS ?? '') !== '' || process.execArgv.length > 0 || import.meta.main === false || Boolean(process.mainModule) || process.argv[1] !== fileURLToPath(import.meta.url);

// Ask in the terminal; resolves with the line typed.
function ask(question) {
  return new Promise((ok) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      ok(answer.trim());
    });
  });
}

async function main(argv) {
  if (argv[0] === '--self-test') {
    if (argv.length > 1) return usage('--self-test takes no other argument');
    const { selfTest } = await import(pathToFileURL(fileURLToPath(new URL('./parked.selftest.mjs', import.meta.url))).href);
    await selfTest();
    console.log('self-test ok');
    return 0;
  }
  const flags = { dir: '.', job: null, hosts: null, vars: null, budget: '5m', trace: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const key = a.startsWith('--') ? a.slice(2) : null;
    if (key === null) rest.push(a);
    else if (key in flags) {
      if (i + 1 >= argv.length) return usage(`${a} needs a value`);
      flags[key] = argv[++i];
    } else return usage(`unknown flag ${a}`);
  }
  const [command, id, decision, ...extra] = rest;
  const dir = resolve(flags.dir);
  if (command === 'list' && !id) {
    const items = list(dir);
    if (!items.length) console.log('nothing parked');
    for (const it of items) {
      const state = it.finished ? `finished (${it.finished})` : it.decision ? `decided ${it.decision}` : 'waiting for your human';
      console.log(`${it.id} · ${state} · ${shown(it.reason).replace(/\n/g, ' ')}`);
    }
    return 0;
  }
  if (command === 'show' && id && !decision) {
    console.log(shown(JSON.stringify(show(dir, checkId(id)), null, 2)));
    return 0;
  }
  if (command === 'decide' && id && decision && !extra.length) {
    if (decision !== 'yes' && decision !== 'no') return usage('decide takes yes or no');
    checkId(id);
    const item = show(dir, id);
    const theirs = `They run it in their own terminal:\n  node parked.mjs decide ${id} ${decision}`;
    if (notPlain()) {
      console.error(`refused: decide runs as a plain node command (NODE_OPTIONS empty, no Node flag, no wrapper script). ${theirs}`);
      return 1;
    }
    // Your human decides, in a terminal. An agent's plain command has no terminal, so it stops here.
    if (!isatty(0) || !isatty(1)) {
      console.error(`refused: decide is your human's call. ${theirs}`);
      return 1;
    }
    console.log(shown(JSON.stringify(item, null, 2)));
    const typed = await ask(`Record "${decision}" for ${id}? Type the id to confirm: `);
    if (typed !== id) {
      console.error('not recorded: the id did not match');
      return 1;
    }
    const was = record(dir, id, decision);
    console.log(was && was !== decision ? `decided ${id}: ${decision} (was ${was})` : `decided ${id}: ${decision}`);
    return 0;
  }
  if (command === 'finish' && id && !decision) {
    checkId(id);
    if (!flags.job) return usage('finish needs --job job.mjs');
    if (!existsSync(flags.job)) return usage(`--job: no file ${flags.job}`);
    const hosts = flags.hosts ? hostLists(readJson(flags.hosts, 'hosts')) : new Map();
    const vars = flags.vars ? readVars(flags.vars) : process.env;
    const { parseBudget } = await import('./run-job.mjs');
    const budgetMs = parseBudget(flags.budget);
    const stop = new AbortController();
    for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.once(s, () => stop.abort());
    const out = await finish(dir, id, flags.job, { hosts, vars, budgetMs, signal: stop.signal, trace: flags.trace ? resolve(flags.trace) : join(dir, 'trace.jsonl') });
    // A refused send is printed in every state: the API may have acted on it.
    for (const r of out.refusals ?? []) console.error(`refused send in finish ${id}: ${shown(r)}`);
    if (out.state === 'done') {
      console.log(`finished ${id}: ${out.decision}`);
      return 0;
    }
    if (out.state === 'unfinished') {
      console.error(`unfinished ${id}: ${shown(out.error)}. It is not run again; see finished/${id}.json and ask your human.`);
      return 1;
    }
    console.error(`failed ${id}: ${shown(out.error)}. It is not run again; see finished/${id}.json and ask your human.`);
    return 1;
  }
  return usage(command ? `cannot read: ${rest.join(' ')}` : 'give a command');
}

function usage(message) {
  console.error(`${message}\n${USAGE}`);
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(e?.refused ? shown(e.message) : `error: ${shown(e?.message ?? String(e))}`);
      process.exitCode = e?.refused ? 1 : 2;
    },
  );
}
