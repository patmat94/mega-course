#!/usr/bin/env node
// cut.mjs · stop jobs by id, from the reach list only. Rules 2 and 3 of the cut pack, in code.
//
//   node cut.mjs --job <id> [--dry-run]                 that one job
//   node cut.mjs --orphans [--roles a,b] [--dry-run]    each job you added that is not yours; prints the ones kept
//                                                       and the found ones (seen), which stop only by --job <id>.
//                                                       Asks for --yes when it would keep none of your jobs,
//                                                       stop a job of a role in roles/ that --roles leaves out,
//                                                       or one whose owner became a role after its line, and
//                                                       for every stop when the project has no roles/.
//   node cut.mjs --lane [--yes] [--dry-run]             every job on the list, yours too (asks for --yes)
//   options: [--wait <seconds, default 10>] [--hosts hosts.json] [--vars vars.json] [--egress <one of the home egress.mjs>]
//   node cut.mjs --self-test
//
// Run it from the project's folder or a subfolder. It reads .reach/jobs.jsonl (reach.mjs; a line without a
// valid MAC refuses the whole list) and stops only jobs on it, each by its own stop method. Never a process
// by its name, never one that is not on the list.
//   pid:<n>   that process and the processes it started: taskkill /T /F on Windows; on other systems
//             SIGTERM to its process group (else the process), then SIGKILL if it is still there.
//             Refused: a pid that started at another time than the listed one (another process now),
//             and a tree that holds this script, any process above it, pids 0 to 4, or a pid: job kept
//             here (a kept url: or task: job is not checked). The start time is read again just before
//             each signal.
//   task:<n>  Windows Task Scheduler: schtasks /End, then /Change /DISABLE. Elsewhere refused (README).
//   url:<u>   one HTTP POST, no redirect followed; 2xx is stopped. A URL with {{NAME}} goes only through
//             rook-clock's egress.mjs from a home skills folder (--egress picks one), else it is refused and nothing
//             is sent; a redirect rook-clock followed does not count as stopped.
// taskkill, schtasks and powershell (the process list) come from %SystemRoot%\System32 only, and only when
// that is the Windows folder of this computer: never from PATH or the project. Every program is started
// with an argument list, never through a shell.
//
// After the stops it checks each one again (pid gone, task disabled, url answered 2xx), prints
// `still running: …` for any that did not stop and `quiet in <n> s`, marks the stopped ones on the list,
// and writes .reach/cut-<when>.json: what stopped, how to start each again (its `start` line), what still runs.
// --dry-run prints what it would stop and how (the program's full path; for a secret, its name and the
// hosts hosts.json lets it go to), what it would refuse and why, and stops nothing.
//
// Exit codes: 0 every stop is quiet, or a dry run; 1 a stop was refused or failed, or a job still runs;
// 2 a usage error (no mode, an id not on the list, --lane or an --orphans that asks for --yes, with none).
// Plain Node.js 20 or newer, no dependencies.

import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { accountHome, becameMine, holdLock, inside, isMine, loadJobs, netPath, projectFolders, oneLine, parseArgs, processTable, reachDir, record, Refused, rolesOf, runTool, same, stopText, systemTools, toolFile, usageError, writeWhole } from './reach.mjs';

export { systemTools };
const SECRET = /\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}|%7b%7b/i;
const URL_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------------------------------
// Pids this script never stops.

function linuxParent(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]) || 0;
  } catch {
    return 0;
  }
}

/** This process, its parent, and on Linux every ancestor, plus 0 to 4 (system processes). */
export function protectedPids(platform = process.platform) {
  const out = new Set([0, 1, 2, 3, 4, process.pid, process.ppid]);
  if (platform === 'linux') {
    for (let p = process.ppid, n = 0; p > 1 && n < 64; n++) out.add((p = linuxParent(p)));
  }
  return out;
}

/** A pid and every process above it, as the process list tells them. */
export function ancestorsOf(pid, table) {
  const out = new Set();
  for (let p = pid; table.has(p) && !out.has(p) && out.size < 256; p = table.get(p).ppid) out.add(p);
  return out;
}

/** What a stop of pid reaches: it, every process below it, and (outside Windows) its process group. */
export function reachOf(pid, table, platform) {
  const below = new Map();
  for (const [p, v] of table) below.set(v.ppid, [...(below.get(v.ppid) ?? []), p]);
  const out = new Set([pid]);
  for (const queue = [pid]; queue.length; ) for (const k of below.get(queue.pop()) ?? []) if (!out.has(k)) out.add(k) && queue.push(k);
  if (platform !== 'win32') for (const [p, v] of table) if (v.pgid === pid) out.add(p);
  return out;
}

export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

// ---------------------------------------------------------------------------------------------------
// rook-clock's egress.mjs, for a url stop with a secret: a home skills folder, or --egress. Never one inside
// the project (its top folder, from any subfolder, or a folder above it with .reach, .git or .claude) or on a
// network path. The home is your account's (reach.mjs accountHome), never HOME or USERPROFILE.

export function egressPlaces(home = accountHome()) {
  return [
    join(home, '.claude', 'skills', 'rook-clock', 'scripts', 'egress.mjs'),
    join(home, '.codex', 'skills', 'rook-clock', 'scripts', 'egress.mjs'),
    join(home, '.pi', 'agent', 'skills', 'rook-clock', 'scripts', 'egress.mjs'),
    join(home, '.agents', 'skills', 'rook-clock', 'scripts', 'egress.mjs'),
  ];
}

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

// rook-clock's own file: <folder>/rook-clock/scripts/egress.mjs, with rook-clock/SKILL.md. Checked before
// anything of it runs: importing a file runs its top level.
const shapedAsClock = (real) => {
  const scripts = dirname(real);
  const clock = dirname(scripts);
  return basename(real) === 'egress.mjs' && basename(scripts) === 'scripts' && basename(clock) === 'rook-clock' && isFile(join(clock, 'SKILL.md'));
};

export function findEgress(given, places, root) {
  const folders = projectFolders(root);
  const out = (p) => !netPath(p) && !netPath(realpathSync.native(p)) && !folders.some((f) => inside(f, realpathSync.native(p)));
  if (given) {
    if (netPath(given) || !isFile(resolve(given))) throw usageError(`--egress: no file at ${oneLine(given)} on this computer`);
    if (!out(resolve(given))) throw usageError('--egress: it is inside the project or on a network path; use rook-clock as installed in your home skills folder');
    const real = realpathSync.native(resolve(given));
    // Only rook-clock as installed in a home skills folder: a file the agent wrote elsewhere never runs.
    const home = places.filter(isFile).map((x) => realpathSync.native(x));
    if (!home.some((x) => same(x, real))) {
      throw usageError(`--egress: ${oneLine(real)} is not rook-clock in a home skills folder (~/.claude/skills, ~/.codex/skills, ~/.pi/agent/skills, ~/.agents/skills); nothing of it ran`);
    }
    if (!shapedAsClock(real)) throw usageError(`--egress: ${oneLine(real)} is not rook-clock's egress.mjs (rook-clock/scripts/egress.mjs, with rook-clock/SKILL.md); nothing of it ran`);
    return real;
  }
  const p = places.find((x) => isFile(x) && out(x) && shapedAsClock(realpathSync.native(x)));
  return p ? realpathSync.native(p) : null;
}

const secretNames = (url) => [...new Set([...url.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g)].map((m) => m[1]))];

async function loadEgress(path) {
  const mod = await import(pathToFileURL(path).href);
  if (typeof mod.send !== 'function' || typeof mod.hostLists !== 'function') throw usageError(`${path} is not rook-clock's egress.mjs`);
  return mod;
}

const readJson = (path, what) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^\u{feff}/u, ''));
  } catch {
    throw usageError(`${what}: cannot read ${oneLine(path)} as JSON`);
  }
};

// ---------------------------------------------------------------------------------------------------
// One stop. Returns { ok, how, check } where check() says true once the job is quiet; or { ok: false, why }.

/** Why a stop may not run now, or null. The same check for the dry run and the stop. */
export function refusalOf(job, ctx) {
  const s = job.stop;
  if (s.kind === 'task') {
    if (ctx.platform !== 'win32') return 'task: stops are Windows Task Scheduler only; stop cron, launchd or systemd jobs by hand (README)';
    return ctx.tools.schtasks.why ? `schtasks: ${ctx.tools.schtasks.why}` : null;
  }
  if (s.kind === 'url') return SECRET.test(s.url) && !ctx.egressPath ? 'this stop needs a secret: install rook-clock, or stop it without one; nothing was sent' : null;
  if (ctx.guarded.has(s.pid)) return `pid ${s.pid} is this script, its harness or a system process; not stopped`;
  const now = ctx.table.get(s.pid);
  if (now && !now.born) return `the system does not say when pid ${s.pid} started, so it cannot tell it is the listed process; not stopped`;
  if (now && now.born !== job.born) return `pid ${s.pid} is another process now (it started after the line was written); not stopped`;
  if (!now) return null;
  // The stop takes the whole tree: never one that holds this script, its harness or a job kept here.
  const reach = reachOf(s.pid, ctx.table, ctx.platform);
  const guarded = [...reach].find((p) => ctx.guarded.has(p));
  if (guarded !== undefined) return `its tree holds pid ${guarded}, this script, its harness or a system process; not stopped`;
  const kept = ctx.kept.find((k) => reach.has(k.stop.pid) && ctx.table.get(k.stop.pid)?.born === k.born);
  if (kept) return `its tree holds ${jobShown(kept, ctx.roles)}, which is not stopped here; not stopped`;
  if (ctx.platform === 'win32' && ctx.tools.taskkill.why) return `taskkill: ${ctx.tools.taskkill.why}`;
  return null;
}

/** How a stop runs, for the dry run: the program by its full path. */
const howShown = (job, ctx) =>
  job.stop.kind === 'task'
    ? `schtasks /End + /DISABLE · ${toolFile(ctx.tools.schtasks)}`
    : job.stop.kind === 'url'
      ? SECRET.test(job.stop.url)
        ? `POST through rook-clock · ${oneLine(ctx.egressPath)} · ${secretNames(job.stop.url)
            .map((n) => `${n} may go to ${(Array.isArray(ctx.hosts[n]) ? ctx.hosts[n].map(oneLine).join(', ') : '') || 'no host'}`)
            .join('; ')} (${oneLine(ctx.hostsPath)})`
        : 'POST, no redirect followed'
      : !ctx.table.has(job.stop.pid)
        ? 'already gone'
        : ctx.platform === 'win32'
          ? `taskkill /T /F · ${toolFile(ctx.tools.taskkill)}`
          : 'SIGTERM, then SIGKILL';

// When the listed pid's process started, read again just before a signal: the list read before the stops
// can be old by then. { gone }, { other, why } (the pid is another process now), { why } (unreadable) or {}.
async function stillListed(job, ctx) {
  let now;
  try {
    now = (await processTable({ platform: ctx.platform, tools: ctx.tools, pid: job.stop.pid })).get(job.stop.pid);
  } catch (e) {
    return { why: `${oneLine(e.message)}; not stopped` };
  }
  return !now ? { gone: true } : now.born && now.born === job.born ? {} : { other: true, why: `pid ${job.stop.pid} is another process now (it started after the line was written); not stopped` };
}

async function stopOne(job, ctx) {
  const s = job.stop;
  const why = refusalOf(job, ctx);
  if (why) return { ok: false, why };
  if (s.kind === 'pid') {
    if (!ctx.table.has(s.pid) || !alive(s.pid)) return { ok: true, how: 'already gone', check: () => true };
    const before = await stillListed(job, ctx);
    if (before.why) return { ok: false, why: before.why };
    if (before.gone) return { ok: true, how: 'already gone', check: () => true };
    if (ctx.platform === 'win32') {
      const r = await runTool(ctx.tools.taskkill, ['/T', '/F', '/PID', String(s.pid)]);
      if (r.code !== 0 && alive(s.pid)) return { ok: false, why: `taskkill: ${oneLine(r.error ?? r.stderr.trim() ?? r.code)}` };
      return { ok: true, how: 'taskkill /T /F', check: () => !alive(s.pid) };
    }
    let how = 'SIGTERM to its process group';
    try {
      process.kill(-s.pid, 'SIGTERM');
    } catch {
      how = 'SIGTERM';
      try {
        process.kill(s.pid, 'SIGTERM');
      } catch (e) {
        if (alive(s.pid)) return { ok: false, why: `kill: ${oneLine(e.code ?? e.message)}` };
      }
    }
    let killed = false;
    return {
      ok: true,
      how,
      check: async (half) => {
        if (!alive(s.pid)) return true;
        if (half && !killed) {
          killed = true;
          const now = await stillListed(job, ctx);
          if (now.gone || now.other) return true; // the listed process ended; the pid is not sent SIGKILL
          if (now.why) return false;
          for (const target of [-s.pid, s.pid]) {
            try {
              process.kill(target, 'SIGKILL');
            } catch {}
          }
        }
        return false;
      },
    };
  }
  if (s.kind === 'task') {
    const end = await runTool(ctx.tools.schtasks, ['/End', '/TN', s.name]);
    const off = await runTool(ctx.tools.schtasks, ['/Change', '/TN', s.name, '/DISABLE']);
    if (off.code !== 0) return { ok: false, why: `schtasks /Change /DISABLE: ${oneLine(off.error ?? off.stderr.trim() ?? off.code)}` };
    const q = await runTool(ctx.tools.schtasks, ['/Query', '/TN', s.name, '/FO', 'CSV', '/NH']);
    const disabled = q.code === 0 && /"Disabled"/i.test(q.stdout);
    return { ok: true, how: `schtasks /End${end.code === 0 ? '' : ' (not running)'} + /DISABLE`, check: () => disabled };
  }
  // url
  if (SECRET.test(s.url)) {
    try {
      const res = await ctx.egress.mod.send({ method: 'POST', url: s.url, headers: {} }, { hosts: ctx.egress.hosts, vars: ctx.egress.vars, timeoutMs: URL_TIMEOUT_MS });
      // rook-clock follows a redirect (as GET after a POST); a stop follows none, so it does not count.
      if (Array.isArray(res.hops) && res.hops.length > 1) return { ok: false, why: `POST through rook-clock: hop 1 answered ${res.hops[0]?.status}, a redirect, and rook-clock followed it; not counted as stopped` };
      const ok = res.status >= 200 && res.status < 300;
      return ok ? { ok: true, how: `POST through rook-clock: ${res.status}`, check: () => true } : { ok: false, why: `POST through rook-clock: HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, why: oneLine(e?.message ?? e) };
    }
  }
  try {
    const res = await (ctx.fetch ?? fetch)(s.url, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(URL_TIMEOUT_MS) });
    const ok = res.status >= 200 && res.status < 300;
    return ok ? { ok: true, how: `POST: ${res.status}`, check: () => true } : { ok: false, why: `POST: HTTP ${res.status}${res.status >= 300 && res.status < 400 ? ' (a redirect is not followed)' : ''}` };
  } catch (e) {
    return { ok: false, why: `POST: ${oneLine(e?.cause?.code ?? e?.message ?? e)}` };
  }
}

// ---------------------------------------------------------------------------------------------------
// The cut.

const MODES = ['job', 'orphans', 'lane'];
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const jobShown = (j, roles) => `${oneLine(j.id)} · ${oneLine(j.owner)}${isMine(j, roles) ? ' (yours)' : ''} · ${oneLine(stopText(j.stop))}`;

/**
 * Runs one cut. options: the command line's flags, plus project, out (a line printer), platform, tools,
 * egressPlaces, fetch, now. Returns the exit code.
 */
export async function cut(options = {}) {
  // The lock first: a list that cannot take a stopped line stops nothing (a dry run stops nothing anyway).
  const release = options['dry-run'] ? () => {} : holdLock(resolve(options.project ?? process.cwd()));
  try {
    return await cutHeld(options);
  } finally {
    release();
  }
}

async function cutHeld(options) {
  const project = resolve(options.project ?? process.cwd());
  const out = options.out ?? ((l) => console.log(l));
  const platform = options.platform ?? process.platform;
  const modes = MODES.filter((m) => options[m] !== undefined);
  if (modes.length !== 1) throw usageError('name one of --job <id>, --orphans or --lane');
  const mode = modes[0];
  const waitS = options.wait === undefined ? 10 : Number(options.wait);
  if (!Number.isInteger(waitS) || waitS < 1 || waitS > 120) throw usageError('--wait: whole seconds, 1 to 120');
  const roles = rolesOf(project, options.roles);
  const jobs = [...loadJobs(project).values()].filter((j) => j.state !== 'stopped');

  let chosen;
  if (mode === 'job') {
    const id = String(options.job);
    chosen = jobs.filter((j) => j.id === id);
    if (!chosen.length) throw usageError(`not on the list: ${oneLine(id).slice(0, 80)} (or already stopped); add it with reach.mjs seen first`);
  } else if (mode === 'orphans') {
    if (!roles.length) throw usageError('--orphans needs your roles: folders in roles/, or --roles a,b');
    // Only jobs written with add: a job you found (seen) is stopped by its id alone, on your human's word.
    chosen = jobs.filter((j) => j.added && !isMine(j, roles));
    const keep = jobs.filter((x) => isMine(x, roles));
    for (const j of keep) out(`keep: ${jobShown(j, roles)}`);
    if (!keep.length) out('keep: none');
    for (const j of jobs.filter((x) => !x.added)) out(`found: ${jobShown(j, roles)} · not stopped by --orphans; your human decides, then --job ${oneLine(j.id)}`);
    // Your human's call, whatever --roles says: a run that keeps none of your jobs; any stop when the project
    // has no roles/ (then --roles is the only word on whose jobs are whose); a job whose owner became one of
    // your roles after its line was written; a job of a role in roles/ that --roles leaves out.
    const own = rolesOf(project);
    const keepsNone = !keep.length && chosen.length > 0;
    const askOf = (j) =>
      keepsNone ? 'this run keeps none of your jobs'
      : !own.length ? 'the project has no roles/, so only --roles says whose job this is'
      : becameMine(j, roles) || becameMine(j, own) ? 'its owner became one of your roles after the line was written'
      : own.includes(j.owner) ? 'its owner is a role in roles/'
      : null;
    const asks = chosen.map((j) => ({ j, why: askOf(j) })).filter((a) => a.why);
    if (!options.yes) for (const a of asks) out(`asks --yes: ${jobShown(a.j, roles)} · ${a.why}`);
    if (asks.length && !options.yes && !options['dry-run']) {
      if (keepsNone) throw usageError(`--orphans with roles ${roles.map(oneLine).join(', ')} keeps none of your jobs, so it stops every job you added: your human adds --yes`);
      if (!own.length) throw usageError(`--orphans --roles ${roles.map(oneLine).join(',')} would stop ${asks.length} job(s) you added, and the project has no roles/ to check --roles against: your human adds --yes`);
      if (asks.some((a) => a.why.startsWith('its owner became'))) throw usageError(`--orphans would stop jobs of ${[...new Set(asks.map((a) => oneLine(a.j.owner)))].join(', ')}, whose owner became one of your roles after the line was written: your human adds --yes`);
      throw usageError(`--orphans --roles ${roles.map(oneLine).join(',')} would stop jobs of ${[...new Set(asks.map((a) => oneLine(a.j.owner)))].join(', ')}, a role in roles/: your human adds --yes`);
    }
  } else {
    chosen = jobs;
    if (!options.yes && !options['dry-run']) {
      for (const j of chosen) out(`on the list: ${jobShown(j, roles)}`);
      throw usageError('--lane stops every job on the list, yours too: your human adds --yes');
    }
  }
  if (!chosen.length) {
    out('nothing to stop');
    return 0;
  }
  const top = reachDir(project).root;
  const tools = options.tools ?? systemTools(process.env, { top });
  const needsTable = chosen.some((j) => j.stop.kind === 'pid');
  const table = needsTable ? (options.table ?? (await processTable({ platform, tools }))) : new Map();
  const guarded = new Set([...(options.guarded ?? protectedPids(platform)), ...ancestorsOf(process.pid, table)]);
  const kept = jobs.filter((j) => !chosen.includes(j) && j.stop.kind === 'pid');
  const ctx = { platform, tools, table, guarded, kept, roles, fetch: options.fetch, egressPath: null, hosts: {}, hostsPath: null };
  // A url stop with a secret needs rook-clock: found before the dry run, so it prints the path and hosts.
  if (chosen.some((j) => j.stop.kind === 'url' && SECRET.test(j.stop.url))) {
    ctx.egressPath = findEgress(options.egress, options.egressPlaces ?? egressPlaces(), top);
    ctx.hostsPath = options.hosts ? resolve(project, options.hosts) : join(top, 'hosts.json');
    ctx.hosts = existsSync(ctx.hostsPath) ? readJson(ctx.hostsPath, 'hosts') : {};
  }
  if (options['dry-run']) {
    for (const j of chosen) {
      const why = refusalOf(j, ctx);
      out(why ? `would not stop: ${jobShown(j, roles)} · ${why}` : `would stop: ${jobShown(j, roles)} · ${howShown(j, ctx)}`);
    }
    out('dry run: nothing stopped');
    return 0;
  }

  if (ctx.egressPath) {
    ctx.egress = { mod: await loadEgress(ctx.egressPath), hosts: ctx.hosts, vars: options.vars ? readJson(resolve(project, options.vars), 'vars') : process.env };
    out(`egress: ${oneLine(ctx.egressPath)}`);
  }

  const started = Date.now();
  const tried = [];
  for (const j of chosen) tried.push({ job: j, r: await stopOne(j, ctx) });
  const pending = tried.filter((t) => t.r.ok);
  const deadline = started + waitS * 1000;
  const quietNow = async (half) => {
    const q = [];
    for (const t of pending) if (await t.r.check(half)) q.push(t);
    return q;
  };
  let quiet = await quietNow(false);
  while (quiet.length < pending.length && Date.now() < deadline) {
    await sleep(100);
    quiet = await quietNow(Date.now() - started > (waitS * 1000) / 2);
  }
  const quietIn = Math.round((Date.now() - started) / 100) / 10;

  const stopped = [];
  const still = [];
  for (const t of tried) {
    if (!t.r.ok) {
      out(`not stopped: ${jobShown(t.job, roles)} · ${t.r.why}`);
      still.push(t.job);
    } else if (quiet.includes(t)) {
      out(`stopped: ${jobShown(t.job, roles)} · ${t.r.how}`);
      stopped.push(t.job);
    } else {
      still.push(t.job);
    }
  }
  for (const j of stopped) record(project, { event: 'stopped', id: j.id, by: `cut --${mode}` }, roles);
  if (still.length) out(`still running: ${still.map((j) => oneLine(j.id)).join(', ')}`);
  else out(`quiet in ${quietIn} s`);

  const { dir } = reachDir(project);
  const at = (options.now ?? new Date()).toISOString();
  const checkpoint = join(dir, `cut-${at.replace(/[:.]/g, '-')}.json`);
  writeWhole(
    checkpoint,
    '.reach checkpoint',
    `${JSON.stringify(
      {
        at,
        mode,
        stopped: stopped.map((j) => ({ id: j.id, owner: j.owner, stop: stopText(j.stop), startAgain: j.start ?? null })),
        stillRunning: still.map((j) => ({ id: j.id, owner: j.owner, stop: stopText(j.stop) })),
        kept: mode === 'orphans' ? jobs.filter((j) => isMine(j, roles)).map((j) => j.id) : [],
      },
      null,
      2,
    )}\n`,
  );
  out(`checkpoint: .reach/${checkpoint.slice(dir.length + 1)}`);
  return still.length ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------------
// The command line.

const USAGE = 'usage: node cut.mjs --job <id> | --orphans [--roles a,b] | --lane [--yes]   [--dry-run] [--wait 10] [--hosts hosts.json] [--vars vars.json] [--egress <path>]';

async function main(argv) {
  if (argv[0] === '--self-test') {
    if (argv.length > 1) return usage('--self-test takes no other argument');
    const { selfTest } = await import(pathToFileURL(fileURLToPath(new URL('./cut.selftest.mjs', import.meta.url))).href);
    await selfTest();
    console.log('self-test ok');
    return 0;
  }
  try {
    const { opts, rest } = parseArgs(argv, ['job', 'orphans?', 'lane?', 'roles', 'dry-run?', 'yes?', 'wait', 'hosts', 'vars', 'egress']);
    if (rest.length) throw usageError(`${oneLine(rest[0]).slice(0, 80)}: cut takes flags only`);
    return await cut(opts);
  } catch (e) {
    if (e instanceof Refused) {
      if (e.code === 2) return usage(e.message);
      console.error(`refused: ${oneLine(e.message)}`);
      return 1;
    }
    throw e;
  }
}

function usage(message) {
  console.error(`${oneLine(message)}\n${USAGE}`);
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(`cut failed: ${oneLine(e?.message ?? e)}`);
      process.exitCode = 1;
    },
  );
}
