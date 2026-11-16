#!/usr/bin/env node
// run-job.mjs · routine work as a script, inside limits this program owns. Rule 2 of the clock pack.
//
//   node run-job.mjs --job job.mjs --items items.jsonl --budget 30s [--max-items n]
//                    [--hosts hosts.json] [--vars vars.json] [--dir folder] [--trace trace.jsonl]
//   node run-job.mjs --self-test
//
// items.jsonl holds one JSON object per line, each with an "id". For each item, in order, the runner
// runs the job's checks, then job.handle(item, ctx). handle returns { done: true }, or { park: "reason" }
// for a call your human makes (parked.mjs keeps the item's copy), or throws. No model runs here unless
// the person who wrote job.mjs put one in.
//
// The limits are this program's, not the job's: the time budget (--budget, required) and the item cap
// (--max-items). The job runs in a child process that this program ends when the budget is spent, even
// mid-item and even in a loop that never returns, with every process the job started under it. A process
// that leaves that tree (one the job hands to another program, or a double fork on POSIX) is not stopped.
// The child's environment holds no secret. ctx.send is egress.mjs's send with the run's hosts.json, run
// in this process: the job never gets a secret's value from the runner, and every secret goes only to
// its own hosts. The job's own code is not fenced in: it can read vars.json and use its own client.
//
// It always ends on one exit, and prints it with the items done, parked and left:
//   done           every item given ran                          exit code 0
//   failed:<id>    that item threw, or handle returned neither   exit code 1   (the run stops there)
//   budget_spent   the time budget ran out                       exit code 3
//   stopped        Ctrl-C or a stop signal                       exit code 4
// A refusal from ctx.send that handle throws on (the refusal itself, not another error) parks the item,
// with the refusal line as the reason (after a redirect: "the API may have acted"), and the run goes on.
// Any other throw is failed:<id>. Every refusal is traced on the item that sent it: "refused" while
// the item runs (its done or park follows), "refused-after-done" for a send it left running after it
// returned, also named in the exit line. A send still open when the run ends is cut: it is traced
// "send-cut" on its item and named in the exit line ("sends cut: <ids> (may have acted)").
// A job never writes in parked/ or finished/. At the end the runner reads parked/ again: a decision
// set during the run (by code or by your human), a file this run did not park, or a file not named
// exactly <its id>.json ends the run failed:job, and finish refuses it. finish also refuses every
// decision until the newest run has its exit line. A job that kills the runner, or a process it left
// behind, can still write a decision after the run: this is a speed bump; reading job.mjs is the guard.
// On an exit that leaves items never started, left.jsonl holds them, in order: run again with
// --items left.jsonl.
// A usage error is exit code 2. trace.jsonl gets a "run started" line first, with the runner's pid (the
// run's window starts there and ends at its exit line), a "started" line before each item, a line with its
// result (id, result, ms) and one exit line, with every secret value shown as {{NAME}}. An item cut by
// the budget or a stop is traced as "unfinished": what it sent before the cut may have arrived. A run
// killed hard leaves no exit line: its last item shows "started" and nothing after it.
// Plain Node.js 20 or newer, no dependencies.

import { fork, spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hider, hostLists, listedValues, MIN_SECRET, readJson, readVars, send, shown, tooShort } from './egress.mjs';
import { checkId, park, parkedFiles } from './parked.mjs';

const MAX_BUDGET_MS = 24 * 3600 * 1000;
export const EXIT_CODES = { done: 0, failed: 1, budget_spent: 3, stopped: 4 };

// "30s", "500ms", "5m", "1h" as milliseconds. Throws on anything else.
export function parseBudget(text) {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(String(text ?? '').trim());
  const ms = m ? Number(m[1]) * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[m[2]] : NaN;
  if (!(ms > 0) || ms > MAX_BUDGET_MS) throw new Error(`--budget ${JSON.stringify(text)}: give a time such as 30s, 5m or 1h (at most 24h)`);
  return Math.round(ms);
}

// items.jsonl as a list of objects, each with an id that is also a file name. Throws with the line.
export function readItems(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8').replace(/^\u{feff}/u, '');
  } catch (e) {
    throw new Error(`--items: cannot read ${path} (${e.code ?? e.message})`);
  }
  const items = [];
  const seen = new Set();
  text.split(/\r?\n/).forEach((line, at) => {
    if (!line.trim()) return;
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      throw new Error(`--items: line ${at + 1} is not JSON`);
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`--items: line ${at + 1} is not an object`);
    if (typeof item.id !== 'string' && typeof item.id !== 'number') throw new Error(`--items: line ${at + 1} has no "id"`);
    const id = checkId(String(item.id));
    // Pay1 and pay1 are one file on Windows and macOS, so they count as one id.
    if (seen.has(id.toLowerCase())) throw new Error(`--items: line ${at + 1}: id ${id} is there twice (ids that differ only in case count as one)`);
    seen.add(id.toLowerCase());
    items.push(item);
  });
  return items;
}

// ---------------------------------------------------------------------------------------------------
// The job in a process of its own.
//
// The child process gets no secret: its environment holds only the names below (no NODE_OPTIONS, no
// value from vars.json or hosts.json), and none of this process's flags. ctx.send comes back here over
// the IPC channel and goes out through egress with the vars this process holds. When the run ends, the
// child and every process it started are ended with it.

const SCRIPT = fileURLToPath(import.meta.url);
const CHILD = '--job-child';
const SAFE_ENV = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL', 'TZ']);
export const cleanEnv = (env = process.env) => Object.fromEntries(Object.entries(env).filter(([k, v]) => SAFE_ENV.has(k.toUpperCase()) && typeof v === 'string'));

const signal = (pid, sig) => {
  try {
    process.kill(pid, sig);
  } catch {}
};
// POSIX: every process under root, by its parent's pid.
function descendants(root) {
  const r = spawnSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout) return [];
  const kids = new Map();
  for (const line of r.stdout.split('\n')) {
    const [p, pp] = line.trim().split(/\s+/).map(Number);
    if (p > 0 && pp > 0) kids.set(pp, [...(kids.get(pp) ?? []), p]);
  }
  const out = [];
  const todo = [root];
  while (todo.length) {
    for (const k of kids.get(todo.pop()) ?? []) {
      if (!out.includes(k)) out.push(k), todo.push(k);
    }
  }
  return out;
}
// End pid and every process under it. Windows: taskkill /T. POSIX: the job leads its own process group;
// a process it moved to a session of its own is found by its parent, frozen first, then killed.
export function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    const exe = join(process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows', 'System32', 'taskkill.exe');
    spawnSync(exe, ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
    return;
  }
  signal(-pid, 'SIGSTOP');
  const seen = new Set();
  for (let round = 0; round < 3; round++) {
    const more = descendants(pid).filter((p) => !seen.has(p));
    if (!more.length) break;
    for (const p of more) seen.add(p), signal(p, 'SIGSTOP');
  }
  signal(-pid, 'SIGKILL');
  signal(pid, 'SIGKILL');
  for (const p of seen) signal(p, 'SIGKILL');
}

// Start the job. mode 'run' needs handle(item, ctx); mode 'finish' needs finish(copy, decision, ctx).
// Returns { next() (the child's next message, or { type: 'gone', message } once it is gone), post(m), stop() }.
// onRefused({ item, message, sent }) hears each refused send, with the id of the item that made it.
export function startJob(jobPath, { mode = 'run', lists = new Map(), vars = process.env, lookup, hide = String, onRefused } = {}) {
  const sends = new AbortController();
  const child = fork(SCRIPT, [CHILD, mode, pathToFileURL(resolve(jobPath)).href], {
    env: cleanEnv(),
    execArgv: [],
    serialization: 'advanced',
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    detached: process.platform !== 'win32',
    windowsHide: true,
  });
  child.stdout.on('data', (c) => process.stdout.write(hide(String(c))));
  child.stderr.on('data', (c) => process.stderr.write(hide(String(c))));
  let reply = null;
  let crash = null;
  let alive = true;
  // Sends still open, by the id of the item that made them: a stop cuts them.
  const open = new Map();
  const gone = new Promise((ok) => {
    child.on('error', (e) => {
      alive = false;
      ok({ type: 'gone', message: hide(`the job did not start: ${e.message}`) });
    });
    child.once('exit', () => {
      alive = false;
      setImmediate(() => ok({ type: 'gone', message: crash ?? (mode === 'finish' ? 'the job ended before finish returned' : 'the job ended the run itself') }));
    });
  });
  child.on('message', async (m) => {
    if (m?.type === 'send') {
      const item = String(m.item);
      open.set(item, (open.get(item) ?? 0) + 1);
      let answer;
      try {
        answer = { type: 'sent', n: m.n, ok: true, value: await send(m.request, { hosts: lists, vars, lookup, signal: sends.signal }) };
      } catch (e) {
        answer = { type: 'sent', n: m.n, ok: false, message: hide(e?.message ?? String(e)), refused: e?.refused === true, sent: e?.sent === true };
        if (e?.refused) onRefused?.({ item, message: answer.message, sent: answer.sent });
      } finally {
        if (open.get(item) > 1) open.set(item, open.get(item) - 1);
        else open.delete(item);
      }
      if (alive && child.connected) {
        try {
          child.send(answer, () => {});
        } catch {}
      }
      return;
    }
    if (m?.type === 'crash') {
      crash = hide(String(m.message));
      return;
    }
    const r = reply;
    reply = null;
    r?.(m);
  });
  let stopping = null;
  return {
    next: () => Promise.race([new Promise((ok) => (reply = ok)), gone]),
    open: () => [...open.keys()],
    post: (m) => {
      try {
        child.send(m, () => {});
      } catch {}
    },
    stop() {
      if (stopping) return stopping;
      sends.abort();
      if (alive) killTree(child.pid);
      if (alive) child.kill('SIGKILL');
      stopping = Promise.race([gone, new Promise((ok) => setTimeout(ok, 3000).unref())]);
      return stopping;
    },
  };
}

// ---------------------------------------------------------------------------------------------------
// The runner. Library: runJob(options) resolves with the exit; it never calls process.exit.
//
// options: { job (path to job.mjs), items (list), budgetMs, maxItems, hosts (hosts.json object or Map),
//   vars (default the environment), dir (where parked/ goes, default .), trace (path or null),
//   stop (an AbortSignal), lookup, print (a function for each output line, default console.log) }

export async function runJob(options) {
  const started = Date.now();
  const budgetMs = options.budgetMs;
  if (!(budgetMs > 0)) throw new Error('a run needs a budget');
  const dir = resolve(options.dir ?? '.');
  const lists = options.hosts instanceof Map ? options.hosts : hostLists(options.hosts ?? {});
  const vars = options.vars ?? process.env;
  const short = tooShort(vars, lists);
  if (short) throw new Error(`vars: ${short} is too short to be a secret (under ${MIN_SECRET} characters)`);
  const hide = hider(listedValues(vars, lists));
  const print = options.print ?? ((line) => console.log(line));
  const all = options.items;
  const cap = options.maxItems ?? all.length;
  const items = all.slice(0, cap);
  const tracePath = options.trace === undefined ? join(dir, 'trace.jsonl') : options.trace;
  // Each line starts on a line of its own, also after a half line someone else left in the file.
  const endsOpen = () => {
    let fd;
    try {
      fd = openSync(tracePath, 'r');
      const { size } = fstatSync(fd);
      const last = Buffer.alloc(1);
      return size > 0 && readSync(fd, last, 0, 1, size - 1) === 1 && last[0] !== 10;
    } catch {
      return false;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  };
  const trace = (line) => {
    if (!tracePath) return;
    mkdirSync(dirname(resolve(tracePath)), { recursive: true });
    appendFileSync(tracePath, `${endsOpen() ? '\n' : ''}${hide(JSON.stringify({ at: new Date().toISOString(), ...line }))}\n`);
  };

  const counts = { done: 0, parked: 0 };
  let job = null;
  let ended = null;
  let current = null;
  let begun = 0;
  const late = [];
  // Items whose handle returned, and the ones this run parked.
  const returned = new Set();
  const parkedHere = new Set();
  let cut = [];
  // parked/ as the run found it: a decision that appears in it during the run is no human's.
  const before = parkedFiles(dir);
  // The run's window starts here; finish refuses a decision recorded inside it, and every finish while
  // the newest run has no exit line. The pid tells your human which process is the runner.
  trace({ at: new Date(started).toISOString(), run: 'started', pid: process.pid });

  // One way out: the first of done, failed, budget spent or stopped wins.
  let finish;
  const end = new Promise((ok) => (finish = ok));
  const stopWith = (exit, extra = {}) => {
    if (ended) return;
    ended = { exit, ...extra };
    finish();
    cut = job?.open() ?? [];
    job?.stop();
  };
  const budget = setTimeout(() => stopWith('budget_spent'), Math.max(0, budgetMs - (Date.now() - started)));
  const onStop = () => stopWith('stopped');
  if (options.stop?.aborted) onStop();
  options.stop?.addEventListener('abort', onStop, { once: true });

  try {
    // Every refusal is traced on the item that sent it: "refused" while it runs (its done or park
    // follows), "refused-after-done" once it returned. Never on the item running now.
    const onRefused = (r) => {
      if (ended) return;
      const reason = `${r.message}: ${r.sent ? 'the API may have acted' : 'nothing was sent'}`;
      if (!returned.has(r.item)) return trace({ id: r.item, result: 'refused', reason });
      trace({ id: r.item, result: 'refused-after-done', reason });
      if (!late.includes(r.item)) late.push(r.item);
    };
    if (!ended) job = startJob(options.job, { mode: 'run', lists, vars, lookup: options.lookup, hide, onRefused });
    const ready = ended ? null : await Promise.race([job.next(), end.then(() => null)]);
    if (ready?.type === 'load-error') stopWith('failed:job', { error: hide(ready.message) });
    else if (ready?.type === 'gone') stopWith('failed:job', { error: ready.message });

    for (const item of items) {
      if (ended) break;
      const id = String(item.id);
      current = { id, t0: Date.now() };
      begun++;
      // Before the item, so a run killed hard still shows which item it was on.
      trace({ id, result: 'started' });
      job.post({ type: 'item', item });
      const r = await Promise.race([job.next(), end.then(() => null)]);
      if (!r || ended) break;
      returned.add(id);
      const ms = Date.now() - current.t0;
      const failed = (message) => {
        trace({ id, result: 'failed', ms, error: message });
        stopWith(`failed:${id}`, { error: hide(message) });
      };
      if (r.type === 'gone') {
        failed(r.message);
        break;
      }
      // handle threw the refusal itself: the item waits for your human, and the run goes on.
      if (r.kind === 'failed' && r.refused === true) {
        r.kind = 'park';
        r.reason = `${r.message}: ${r.sent ? 'the API may have acted' : 'nothing was sent'}`;
        r.copy = item;
      }
      if (r.kind === 'done') {
        counts.done++;
        trace({ id, result: 'done', ms });
      } else if (r.kind === 'park') {
        let kept;
        try {
          kept = park(dir, id, r.reason, r.copy);
        } catch (e) {
          failed(e.message);
          break;
        }
        counts.parked++;
        if (kept === 'parked') parkedHere.add(id);
        trace({ id, result: 'parked', ms, reason: r.reason, ...(kept === 'parked' ? {} : { kept }) });
        print(hide(`parked ${id}: ${shown(r.reason).replace(/\n/g, ' ')}${kept === 'parked' ? '' : ` (${kept} before; left as it was)`}`));
      } else {
        failed(r.message);
        break;
      }
      current = null;
    }
    if (!ended) stopWith('done');
    await end;
  } finally {
    clearTimeout(budget);
    options.stop?.removeEventListener('abort', onStop);
    await job?.stop();
  }

  const ranOut = ended.exit === 'budget_spent' || ended.exit === 'stopped';
  if (ranOut && current) trace({ id: current.id, result: 'unfinished', ms: Date.now() - current.t0 });
  // A send still open when the run ended was cut: the API may have got it. The unfinished item says so already.
  const sendsCut = cut.filter((id) => !(ranOut && current?.id === id));
  for (const id of sendsCut) trace({ id, result: 'send-cut' });

  // parked/ after the job is gone: a decision set during the run, or a file this run did not park,
  // was written by code, not by your human in their terminal. The run fails, and finish refuses it.
  // A file not named exactly <its id>.json the runner never writes: finish refuses it by its name.
  const byCode = [];
  for (const [name, { item: now, misnamed }] of parkedFiles(dir)) {
    if (misnamed) {
      byCode.push({ id: name, why: 'name' });
      trace({ id: typeof now?.id === 'string' ? now.id : name, result: 'not-by-human', why: 'name', file: `parked/${name}.json`, decidedAt: now?.decidedAt ?? null, copySha: now?.copySha ?? null });
      continue;
    }
    const was = before.get(name)?.misnamed ? null : before.get(name)?.item;
    const appeared = !was && !parkedHere.has(name);
    const decided = now.decision != null && (!was || was.decision !== now.decision || was.decidedAt !== now.decidedAt || !(Date.parse(now.decidedAt) < started));
    if (!appeared && !decided) continue;
    byCode.push({ id: name, why: decided ? 'decision' : 'appeared' });
    // finish refuses a file that appeared by its copySha, and a decision by its decidedAt.
    trace({ id: name, result: 'not-by-human', why: appeared ? 'appeared' : 'decision', decidedAt: now.decidedAt ?? null, copySha: now.copySha ?? null });
  }
  if (byCode.length) {
    const names = (why) => byCode.filter((b) => b.why === why).map((b) => `parked/${b.id}.json`).join(', ');
    const why = [
      ...(names('decision') ? [`${names('decision')}: decision set during the run, by code or by your human: your human decides it again after the run`] : []),
      ...(names('appeared') ? [`${names('appeared')} appeared during the run and the runner did not park it: ask your human`] : []),
      ...(names('name') ? [`${names('name')} is not named exactly for the id it holds, so the runner did not write it: ask your human`] : []),
    ].join('; ');
    ended = { exit: 'failed:job', error: why };
  }
  // Items never started, in order (the ones over --max-items too). An item that started is not among them.
  const leftItems = all.slice(begun);
  const left = leftItems.length;
  const leftPath = join(dir, 'left.jsonl');
  if (left) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(leftPath, leftItems.map((item) => `${JSON.stringify(item)}\n`).join(''));
  } else if (existsSync(leftPath)) unlinkSync(leftPath);
  const leftName = relative(process.cwd(), leftPath) || leftPath;
  const result = {
    exit: ended.exit,
    code: EXIT_CODES[ended.exit.split(':')[0]],
    done: counts.done,
    parked: counts.parked,
    left,
    ...(left ? { leftFile: leftPath } : {}),
    ...(ranOut && current ? { unfinished: current.id } : {}),
    ...(ended.error ? { error: ended.error } : {}),
    ...(all.length > items.length ? { capped: all.length - items.length } : {}),
    ...(late.length ? { refusedAfterDone: [...late] } : {}),
    ...(sendsCut.length ? { sendsCut } : {}),
  };
  trace({
    exit: result.exit,
    runStartedAt: new Date(started).toISOString(),
    done: result.done,
    parked: result.parked,
    left: result.left,
    ...(left ? { leftIn: leftName } : {}),
    ...(result.unfinished ? { unfinished: result.unfinished } : {}),
    ...(late.length ? { refusedAfterDone: late } : {}),
    ...(sendsCut.length ? { sendsCut } : {}),
    ...(result.error ? { error: result.error } : {}),
  });
  const parts = [`exit: ${result.exit}`];
  if (result.error) parts.push(shown(result.error).replace(/\n/g, ' '));
  parts.push(`${result.done} done`, `${result.parked} parked`, `${result.left} left${left ? ` (in ${leftName})` : ''}`);
  if (result.unfinished) parts.push(`unfinished: ${result.unfinished} (it may have sent part of its work)`);
  if (late.length) parts.push(`refused after done: ${late.join(', ')} (see trace.jsonl)`);
  if (sendsCut.length) parts.push(`sends cut: ${sendsCut.join(', ')} (may have acted)`);
  if (result.capped) parts.push(`${result.capped} over --max-items, not run`);
  print(hide(parts.join(' · ')));
  if (result.parked) print('parked items wait for your human: node parked.mjs list');
  return result;
}

// ---------------------------------------------------------------------------------------------------
// The child: loads job.mjs and runs what the runner asks, one at a time. It holds no secret and no limit.

const text = (e) => {
  try {
    return String(e?.message ?? e);
  } catch {
    return 'it threw something that cannot be read';
  }
};

async function childMain(mode, jobUrl) {
  const post = (m) => {
    try {
      process.send(m);
    } catch {
      process.send({ type: 'result', kind: 'failed', message: 'the job returned something that cannot be sent back' });
    }
  };
  // The runner owns stopping: a Ctrl-C in the console reaches this process too, and the runner ends it.
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(s, () => {});
  process.on('disconnect', () => process.exit(0));
  const crash = (e) => {
    try {
      process.send({ type: 'crash', message: text(e) }, () => process.exit(1));
    } catch {
      process.exit(1);
    }
  };
  process.on('uncaughtException', crash);
  // A refusal no one awaited is not a crash: the runner already traced it on the item that sent it.
  process.on('unhandledRejection', (e) => {
    if (e?.refused !== true) crash(e);
  });
  let job;
  try {
    job = await import(jobUrl);
  } catch (e) {
    return post({ type: 'load-error', message: `the job does not load: ${text(e)}` });
  }
  if (mode === 'finish' && typeof job.finish !== 'function') return post({ type: 'load-error', message: 'the job has no finish(copy, decision, ctx) to run' });
  if (mode !== 'finish' && typeof job.handle !== 'function') return post({ type: 'load-error', message: 'the job has no handle(item, ctx)' });
  const checks = job.checks ?? [];
  if (!Array.isArray(checks) || checks.some((c) => typeof c?.rule !== 'string' || typeof c?.check !== 'function')) {
    return post({ type: 'load-error', message: 'checks must be a list of { rule: "text", check(item) }' });
  }
  const waiting = new Map();
  let n = 0;
  // Each send carries the id of the item that made it, so a late refusal is never put on the next item.
  const sendFor = (item) => (request) =>
    new Promise((ok, fail) => {
      const at = ++n;
      waiting.set(at, { ok, fail });
      post({ type: 'send', n: at, item, request });
    });
  process.on('message', async (m) => {
    if (m?.type === 'sent') {
      const w = waiting.get(m.n);
      waiting.delete(m.n);
      if (m.ok) w?.ok(m.value);
      else w?.fail(Object.assign(new Error(m.message), { refused: m.refused, sent: m.sent }));
      return;
    }
    if (m?.type === 'finish') {
      const ctx = Object.freeze({ id: String(m.id), send: sendFor(String(m.id)) });
      try {
        post({ type: 'finished', ok: true, result: await job.finish(m.copy, m.decision, ctx) });
      } catch (e) {
        post({ type: 'finished', ok: false, message: text(e) });
      }
      return;
    }
    if (m?.type !== 'item') return;
    const item = m.item;
    const ctx = Object.freeze({ id: String(item.id), send: sendFor(String(item.id)) });
    try {
      for (const c of checks) {
        if (!(await c.check(item))) return post({ type: 'result', kind: 'park', reason: `check: ${c.rule}`, copy: item });
      }
      const r = await job.handle(item, ctx);
      if (r && typeof r.park === 'string' && r.park.trim()) return post({ type: 'result', kind: 'park', reason: r.park, copy: r.copy ?? item });
      if (r && r.done) return post({ type: 'result', kind: 'done' });
      post({ type: 'result', kind: 'failed', message: 'handle returned neither { done: true } nor { park: "reason" }' });
    } catch (e) {
      // refused: true only when the error thrown is ctx.send's refusal itself.
      post({ type: 'result', kind: 'failed', message: text(e), refused: e?.refused === true, sent: e?.sent === true });
    }
  });
  post({ type: 'ready' });
}

// ---------------------------------------------------------------------------------------------------
// The command line.

const USAGE =
  'usage: node run-job.mjs --job job.mjs --items items.jsonl --budget 30s [--max-items n] [--hosts hosts.json] [--vars vars.json] [--dir folder] [--trace trace.jsonl]';

async function main(argv) {
  if (argv[0] === '--self-test') {
    if (argv.length > 1) return usage('--self-test takes no other argument');
    const { selfTest } = await import(pathToFileURL(fileURLToPath(new URL('./run-job.selftest.mjs', import.meta.url))).href);
    await selfTest();
    console.log('self-test ok');
    return 0;
  }
  const flags = { job: null, items: null, budget: null, 'max-items': null, hosts: null, vars: null, dir: '.', trace: null };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].startsWith('--') ? argv[i].slice(2) : null;
    if (key === null || !(key in flags)) return usage(`cannot read ${argv[i]}`);
    if (i + 1 >= argv.length) return usage(`${argv[i]} needs a value`);
    flags[key] = argv[++i];
  }
  if (!flags.job || !flags.items) return usage('give --job and --items');
  if (!flags.budget) return usage('--budget is required: the time this run may take, such as 30s or 5m');
  const budgetMs = parseBudget(flags.budget);
  let maxItems;
  if (flags['max-items'] !== null) {
    maxItems = Number(flags['max-items']);
    if (!Number.isInteger(maxItems) || maxItems < 1) return usage('--max-items takes a whole number, 1 or more');
  }
  if (!existsSync(flags.job)) return usage(`--job: no file ${flags.job}`);
  const dir = resolve(flags.dir);
  const hostsPath = flags.hosts ?? (existsSync(join(dir, 'hosts.json')) ? join(dir, 'hosts.json') : null);
  const hosts = hostsPath ? hostLists(readJson(hostsPath, 'hosts')) : new Map();
  const vars = flags.vars ? readVars(flags.vars) : process.env;
  const items = readItems(flags.items);
  const stop = new AbortController();
  // SIGHUP: the terminal closed. SIGBREAK: Ctrl-Break in a Windows console.
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.once(s, () => stop.abort());
  const r = await runJob({ job: flags.job, items, budgetMs, maxItems, hosts, vars, dir, trace: flags.trace ?? join(dir, 'trace.jsonl'), stop: stop.signal });
  return r.code;
}

function usage(message) {
  console.error(`${message}\n${USAGE}`);
  return 2;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain && process.argv[2] === CHILD && process.send) {
  childMain(process.argv[3], process.argv[4]);
} else if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
      // The job's processes are gone and the sends are aborted; leave even if a handle is still open.
      setTimeout(() => process.exit(code), 50).unref();
    },
    (e) => {
      console.error(`error: ${shown(e?.message ?? String(e))}`);
      process.exitCode = 2;
    },
  );
}
