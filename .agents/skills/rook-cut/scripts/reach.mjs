#!/usr/bin/env node
// reach.mjs · the reach list: every job with an id, an owner and a stop method. Rule 1 of the cut pack, in code.
//
//   node reach.mjs add <id> --owner <role> --stop pid:<n>|task:<name>|url:<https://…> [--start "<line>"] [--note "…"]
//   node reach.mjs seen <id> --owner <what it reports, or none> [--stop …] [--note "…"]
//   node reach.mjs list [--json] [--roles a,b]
//   node reach.mjs --self-test
//
// Run it from the project's folder. The list is .reach/jobs.jsonl, one line per event (added, seen, stopped);
// REACH.md is written from it after each change, for people. Nothing here stops or starts a job: the `start`
// line is kept as text, for your human, and never run.
//
// A job is yours only when you wrote it with `add` and its owner is one of your roles: the folders in roles/,
// or --roles, both now and when the line was written (its signed mine field). A `seen` job is never yours, whatever owner it reports. none, empty, null, - and — are no owner.
//
// Each line carries a MAC made with a key outside the project (~/.rook-cut/key, made on first use). A line
// without a valid MAC was not written by reach.mjs on this computer for this folder, and the whole list is
// refused until that line is gone: a line someone else wrote is never a stop order. The lines are one chain:
// each MAC covers the line's place (seq) and the MAC before it, and the head (line count and last MAC) is kept
// next to the key. A list with a line replayed, moved or deleted, or cut short, is refused whole. A pid: line
// also holds when that process started, so a pid the system gave to another process later is never stopped.
//
// .reach/, jobs.jsonl and REACH.md must be plain, in the project: a link, a second name (a hard link) or a
// path that leads out of the project is refused. Text from the list is printed with control and invisible
// characters shown as \u{…}, so a line cannot steer the terminal.
//
// Exit codes: 0 done, 1 refused (a file of .reach/ is not the project's), 2 a usage error.
// Plain Node.js 20 or newer, no dependencies.

import { execFile } from 'node:child_process';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// A list that cannot be used, or a usage error (code 2). The message is the one line to print.
export class Refused extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}
export const usageError = (message) => new Refused(message, 2);

// Text as it may be printed: control and invisible characters show as \u{…}.
const STEERING = /[\p{C}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/gu;
export const shown = (s) => String(s).replace(STEERING, (c) => `\\u{${c.codePointAt(0).toString(16)}}`);
export const oneLine = (s) => shown(String(s)).slice(0, 400);

// ---------------------------------------------------------------------------------------------------
// What a line may hold.

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9]|conin\$|conout\$)(\..*)?$/i;
export function checkId(id) {
  const s = String(id ?? '');
  if (!ID.test(s) || DEVICE.test(s) || s.endsWith('.')) throw usageError(`${JSON.stringify(oneLine(s).slice(0, 80))} is not a job id: letters, digits, . - _, at most 64`);
  return s;
}

const NO_OWNER = new Set(['', 'none', 'null', '-', '\u2014', '\u2013']);
const OWNER = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;
export const isNoOwner = (owner) => owner == null || NO_OWNER.has(String(owner).trim().toLowerCase());
export function checkOwner(owner) {
  if (owner === undefined) throw usageError('--owner is required: a role, or none');
  if (isNoOwner(owner)) return 'none';
  const s = String(owner).trim();
  if (!OWNER.test(s)) throw usageError(`--owner ${JSON.stringify(oneLine(s).slice(0, 80))}: a role name of letters, digits, . _ / -, or none`);
  return s;
}

const HIDDEN = /[\p{C}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;
const TASK = /^\\?[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}(\\[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}){0,3}$/;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
export const MAX_PID = 2 ** 31 - 1;

/** A stop method, checked: { kind: 'pid', pid } | { kind: 'task', name } | { kind: 'url', url }. */
export function parseStop(text) {
  const s = String(text ?? '');
  const m = /^(pid|task|url):(.+)$/s.exec(s);
  if (!m) throw usageError('--stop: pid:<n>, task:<name> or url:<https://…>');
  const [, kind, rest] = m;
  if (HIDDEN.test(rest)) throw usageError(`--stop ${kind}:<…>: no control or invisible characters`);
  if (kind === 'pid') {
    if (!/^[1-9][0-9]{0,9}$/.test(rest) || Number(rest) > MAX_PID) throw usageError('--stop pid:<n>: a process id, a whole number above 0');
    return { kind, pid: Number(rest) };
  }
  if (kind === 'task') {
    if (!TASK.test(rest) || rest.endsWith(' ') || rest.endsWith('.')) {
      throw usageError('--stop task:<name>: a scheduled task name of letters, digits, space . _ -, in at most 4 folders (\\Folder\\Task)');
    }
    return { kind, name: rest };
  }
  let url;
  try {
    url = new URL(rest);
  } catch {
    throw usageError('--stop url:<…>: not a URL');
  }
  if (url.username || url.password) throw usageError('--stop url:<…>: no user name or password in the URL; a secret goes in as {{NAME}} through rook-clock');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) {
    throw usageError('--stop url:<…>: https, or http to 127.0.0.1 / localhost only');
  }
  if (/\{\{|%7b%7b/i.test(url.host)) throw usageError('--stop url:<…>: a secret may not be in the host or port');
  return { kind, url: rest };
}
export const stopText = (stop) => (stop.kind === 'pid' ? `pid:${stop.pid}` : stop.kind === 'task' ? `task:${stop.name}` : `url:${stop.url}`);

// A secret written out in a url: stop or a --start line would sit in .reach/, REACH.md and every checkpoint.
// Refused: name=value where the name says secret (token, key, password …) and the value is not a name of
// one ({{NAME}}, $NAME, ${NAME}, %NAME%, $env:NAME); and the value of a secret this computer holds (an
// environment variable whose name says secret, or a name in the project's hosts.json), as it is,
// percent-encoded or base64. Returns the name, never the value.
const SECRET_NAME = /(?:^|[_.-])(?:api)?(?:key|token|secret|pass|passwd|password|pwd|auth|authorization|credentials?|cookie|session|sig|signature|bearer)(?:[_.-]|$)|(?:key|token|secret|password)$/i;
const NAMED = /^(?:\{\{\s*[A-Za-z_]\w*\s*\}\}|%7b%7b\s*[A-Za-z_]\w*\s*%7d%7d|\$\{?[A-Za-z_]\w*\}?|%[A-Za-z_]\w*%|\$env:[A-Za-z_]\w*)$/i;
export function writtenSecret(text, top) {
  const s = String(text ?? '');
  for (const [, name, raw] of s.matchAll(/([A-Za-z_][A-Za-z0-9_.-]*)=("[^"]*"|'[^']*'|[^\s&;"']+)/g)) {
    const value = raw.replace(/^(["'])(.*)\1$/, '$2');
    if (SECRET_NAME.test(name) && value.length >= 4 && !NAMED.test(value)) return name;
  }
  let listed = [];
  try {
    if (top) listed = Object.keys(JSON.parse(readFileSync(join(top, 'hosts.json'), 'utf8').replace(/^\u{feff}/u, '')) ?? {});
  } catch {}
  for (const [name, value] of Object.entries(process.env)) {
    if (typeof value !== 'string' || value.length < 8 || !(SECRET_NAME.test(name) || listed.includes(name))) continue;
    if ([value, encodeURIComponent(value), Buffer.from(value).toString('base64')].some((form) => s.includes(form))) return name;
  }
  return null;
}
function checkSecretFree(text, flag, top) {
  const name = text === undefined ? null : writtenSecret(text, top);
  if (name) throw usageError(`${flag}: a secret value is written out (${oneLine(name).slice(0, 60)}); write its name instead, {{NAME}} in a url: stop (it goes through rook-clock), $NAME in --start`);
}

function checkText(value, flag, max) {
  if (value === undefined) return undefined;
  const s = String(value);
  if (s.length > max || /[\p{C}\p{Zl}\p{Zp}]/u.test(s)) throw usageError(`${flag}: one line of text, at most ${max} characters`);
  return s;
}

// ---------------------------------------------------------------------------------------------------
// Paths: .reach/ and REACH.md, plain and inside the project, checked by their real paths.

const caseless = process.platform === 'win32' || process.platform === 'darwin';
export const netPath = (p) => /^[\\/]{2}/.test(String(p));
export function inside(root, path) {
  const rel = relative(caseless ? root.toLowerCase() : root, caseless ? path.toLowerCase() : path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

const lstatOrNull = (p) => {
  try {
    return lstatSync(p);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
};

const MARKS = ['.reach', '.git', '.claude'];
/**
 * The project's top folder, by its real path: the folder you run from, or the nearest folder above it that
 * holds .reach, .git or .claude. The search stops below your home folder (its own .claude is your harness's).
 * A run from a subfolder uses the same list, roles and hosts.json as one from the top.
 */
export function projectTop(project) {
  if (netPath(project)) throw new Refused(`${project} is a network or device path; run from a folder on this computer`);
  const start = realpathSync.native(resolve(project));
  if (netPath(start)) throw new Refused(`${project} is a network or device path; run from a folder on this computer`);
  const home = realOrNull(accountHome());
  for (let dir = start; ; dir = dirname(dir)) {
    if (home && same(dir, home)) return start;
    if (MARKS.some((m) => lstatOrNull(join(dir, m)))) return dir;
    if (same(dirname(dir), dir)) return start;
  }
}
export const same = (a, b) => (caseless ? a.toLowerCase() === b.toLowerCase() : a === b);

/**
 * The project's folders, by their real paths: its top, and each folder above it that holds .reach, .git or
 * .claude. A folder that holds your home folder is not one of them.
 */
export function projectFolders(root) {
  const home = realOrNull(accountHome());
  const out = [];
  for (let dir = realpathSync.native(root); ; dir = dirname(dir)) {
    if (home && inside(dir, home)) break;
    if (same(dir, root) || MARKS.some((m) => lstatOrNull(join(dir, m)))) out.push(dir);
    if (same(dirname(dir), dir)) break;
  }
  return out;
}

/** Refused when a file's real path is in one of the project's folders: a key or a program the project planted. */
export function checkOutside(root, path, label) {
  const real = realOrNull(path) ?? path;
  const f = projectFolders(root).find((d) => inside(d, real));
  if (f) throw new Refused(`${label} (${oneLine(real).slice(0, 160)}) is inside the project (${oneLine(f).slice(0, 120)}); not used`);
  return real;
}

/** The project's top folder and its .reach/ folder (made when `make`), refused when it is a link or leads out. */
export function reachDir(project, { make = false } = {}) {
  const root = projectTop(project);
  const dir = join(root, '.reach');
  let st = lstatOrNull(dir);
  if (!st && make) {
    mkdirSync(dir);
    st = lstatSync(dir);
    // The list holds this machine's pids: kept out of version control from its first line.
    writeFileSync(join(dir, '.gitignore'), '*\n', { flag: 'wx' });
  }
  if (st && (st.isSymbolicLink() || !st.isDirectory())) throw new Refused('.reach is a link or not a folder; the list is a plain folder of the project');
  if (st && !inside(root, realpathSync.native(dir))) throw new Refused('.reach leads out of the project');
  return { root, dir, exists: Boolean(st) };
}

/** A file of the project to write: none yet, or a plain file with one name. Returns its stat or null. */
export function plainFile(path, label) {
  const st = lstatOrNull(path);
  if (st && (st.isSymbolicLink() || !st.isFile() || st.nlink > 1)) throw new Refused(`${label} is a link or has a second name; the list writes only a plain file of the project's own`);
  return st;
}

/** One line added to a file of the project, through one handle that is checked again after it opens. */
export function appendLine(path, label, line) {
  const before = plainFile(path, label);
  const flags = constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (before ? 0 : constants.O_EXCL) | (constants.O_NOFOLLOW ?? 0);
  const fd = openSync(path, flags, 0o644);
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.nlink > 1 || (before && (st.ino !== before.ino || st.dev !== before.dev))) throw new Refused(`${label} changed while it was written; run it again`);
    writeSync(fd, line);
  } finally {
    closeSync(fd);
  }
}

/** A whole file of the project, written next to itself and renamed in place. */
export function writeWhole(path, label, text) {
  plainFile(path, label);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text, { flag: 'wx' });
  renameSync(tmp, path);
}

// ---------------------------------------------------------------------------------------------------
// The programs it runs: absolute paths, argument lists, no shell.

// On Windows, %SystemRoot% comes from the environment, which a project can set. It is used only when its
// real path is <drive>:\Windows on this computer, outside the project, and each tool's real path is the one
// in its System32; else that tool is refused ({ file, why }) and nothing runs.
const WINDOWS = /^[A-Za-z]:\\Windows$/i;
const realOrNull = (p) => {
  try {
    return realpathSync.native(p);
  } catch {
    return null;
  }
};
function windowsRefusal(root, file, top) {
  const real = netPath(root) ? null : realOrNull(root);
  if (!real || netPath(real) || !WINDOWS.test(real) || (top && inside(top, real))) return `%SystemRoot% (${oneLine(root).slice(0, 120)}) is not the Windows folder of this computer; not stopped`;
  const want = join(real, relative(root, file));
  const got = realOrNull(file);
  if (!got || (caseless ? got.toLowerCase() !== want.toLowerCase() : got !== want)) return `${oneLine(file).slice(0, 160)} is not there, or leads elsewhere; not stopped`;
  return null;
}

/** taskkill, schtasks and powershell, each [file, args before, environment] or { file, why } when refused. */
export function systemTools(env = process.env, { top, platform = process.platform } = {}) {
  const root = env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows';
  const sys = join(root, 'System32');
  const tool = (file, pre, toolEnv) => {
    const why = platform === 'win32' ? windowsRefusal(root, file, top) : null;
    return why ? { file, why } : [file, pre, toolEnv];
  };
  return {
    taskkill: tool(join(sys, 'taskkill.exe'), []),
    schtasks: tool(join(sys, 'schtasks.exe'), []),
    powershell: tool(join(sys, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-NoLogo', '-Command'], { SystemRoot: root, windir: root, PSModulePath: join(sys, 'WindowsPowerShell', 'v1.0', 'Modules') }),
  };
}
export const toolFile = (tool) => (Array.isArray(tool) ? tool[0] : tool.file);

const TOOL_TIMEOUT_MS = 30_000;
/** One program from its absolute path, with an argument list and no shell. A third item is its whole environment. */
export const runTool = (tool, args) =>
  !Array.isArray(tool)
    ? Promise.resolve({ code: 1, stdout: '', stderr: '', error: tool.why })
    : new Promise((ok) =>
        execFile(tool[0], [...tool[1], ...args], { shell: false, windowsHide: true, timeout: TOOL_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, ...(tool[2] ? { env: tool[2] } : {}) }, (e, stdout, stderr) =>
          ok({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, stdout: String(stdout), stderr: String(stderr), error: e && typeof e.code !== 'number' ? e.message : null }),
        ),
      );

// ---------------------------------------------------------------------------------------------------
// Processes, as the system tells them: a Map of pid → { ppid, pgid, born }. born is when the process
// started; the same pid with another born is another process. Windows: Win32_Process through the System32
// PowerShell. Linux: /proc. Other systems: /bin/ps.

const winTable = (pid) =>
  `Get-CimInstance Win32_Process${pid ? ` -Filter 'ProcessId=${pid}'` : ''} | ForEach-Object { '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, $(if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 }) }`;

/** The process list, or with `pid` (a whole number) that one process only: an empty Map when it is gone. */
export async function processTable({ platform = process.platform, tools, pid } = {}) {
  const table = new Map();
  if (pid !== undefined && !(Number.isInteger(pid) && pid > 0 && pid <= MAX_PID)) throw new Error('processTable: pid is a whole number');
  if (platform === 'win32') {
    const r = await runTool((tools ?? systemTools()).powershell, [winTable(pid)]);
    if (r.code !== 0) throw new Refused(`the process list cannot be read (powershell: ${oneLine(r.error ?? r.stderr.trim() ?? r.code).slice(0, 160)})`);
    for (const line of r.stdout.split(/\r?\n/)) {
      const m = /^(\d+) (\d+) (\d+)$/.exec(line.trim());
      if (m) table.set(Number(m[1]), { ppid: Number(m[2]), born: m[3] === '0' ? '' : `win:${m[3]}` });
    }
  } else if (platform === 'linux') {
    let boot = '';
    try {
      boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    } catch {}
    for (const name of pid ? [String(pid)] : readdirSync('/proc')) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
        const f = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        table.set(Number(name), { ppid: Number(f[1]), pgid: Number(f[2]), born: boot && /^\d+$/.test(f[19]) ? `linux:${boot}:${f[19]}` : '' });
      } catch {}
    }
  } else {
    const r = await runTool(['/bin/ps', [], { LC_ALL: 'C', TZ: 'UTC' }], pid ? ['-o', 'pid=,ppid=,pgid=,lstart=', '-p', String(pid)] : ['-axo', 'pid=,ppid=,pgid=,lstart=']);
    if (r.code !== 0 && !(pid && !r.error && !r.stdout.trim())) throw new Refused(`the process list cannot be read (/bin/ps: ${oneLine(r.error ?? r.stderr.trim() ?? r.code).slice(0, 160)})`);
    for (const line of r.stdout.split('\n')) {
      const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
      if (m) table.set(Number(m[1]), { ppid: Number(m[2]), pgid: Number(m[3]), born: `ps:${m[4].replace(/\s+/g, '_')}` });
    }
  }
  return table;
}

// ---------------------------------------------------------------------------------------------------
// The key. Outside the project, in your home folder, readable by you only; made the first time a line is written.
// Your home folder comes from your account (the system's user profile), never from HOME or USERPROFILE: a
// project can set those for every command its harness runs, and so ship its own key, lines and rook-clock.

export const keyHome = { dir: null }; // the self-tests set a temp folder here, in their own process only
export const accountHome = () => keyHome.dir ?? userInfo().homedir;
export const keyPath = () => join(accountHome(), '.rook-cut', 'key');

export function keyOf({ make = false, root } = {}) {
  const path = keyPath();
  if (netPath(path)) throw new Refused(`${path} is on a network path; the list's key stays on this computer`);
  if (root) checkOutside(root, dirname(path), "the list's key folder");
  let st = lstatOrNull(path);
  if (!st && make) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    try {
      writeFileSync(path, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    st = lstatSync(path);
  }
  if (!st) return null;
  if (root) checkOutside(root, path, "the list's key");
  const text = st.isSymbolicLink() || !st.isFile() || st.nlink > 1 ? '' : readFileSync(path, 'utf8').trim();
  if (!/^[0-9a-f]{64}$/.test(text)) throw new Refused(`${path} is not a key reach.mjs made (a link, a second name, or other text); ask your human`);
  return Buffer.from(text, 'hex');
}

const rootKey = (root) => (caseless ? root.toLowerCase() : root);
const macOf = (key, root, body) => createHmac('sha256', key).update(`${rootKey(root)}\n${body}`).digest();
/**
 * One line of the list: the event, then its MAC over this project's real path and the event. The event
 * holds its place: seq (1 for the first line) and prev (the MAC of the line before it, '' for the first).
 */
export const signedLine = (key, root, event) => {
  const body = JSON.stringify(event);
  return `${body.slice(0, -1)},"mac":"${macOf(key, root, body).toString('hex')}"}\n`;
};

// The head: how many lines the list has and the last one's MAC, kept next to the key, outside the project.
// A list that is shorter, longer or ends on another line was changed outside reach.mjs.
export const headPath = (root) => join(dirname(keyPath()), `${createHash('sha256').update(rootKey(root)).digest('hex').slice(0, 40)}.head`);
const changed = (root, why) =>
  new Refused(`the reach list was changed outside reach.mjs; nothing stopped: ${why}. Ask your human; to start a new list, they delete .reach/ and ${headPath(root)}`);

function readHead(root) {
  const path = headPath(root);
  checkOutside(root, dirname(path), "the list's key folder");
  const st = lstatOrNull(path);
  if (!st) return null;
  const m = st.isFile() && !st.isSymbolicLink() && st.nlink === 1 ? /^(\d{1,9}) ([0-9a-f]{64})$/.exec(readFileSync(path, 'utf8').trim()) : null;
  if (!m) throw changed(root, 'its head file is not one reach.mjs wrote');
  return { seq: Number(m[1]), mac: m[2] };
}

function writeHead(root, seq, mac) {
  const path = headPath(root);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${seq} ${mac}\n`, { flag: 'wx', mode: 0o600 });
  renameSync(tmp, path);
}

// One writer at a time: a second reach.mjs or cut.mjs waits for .reach/jobs.lock, so the chain never forks.
// cut.mjs holds it from before its first stop until the last stopped line is written (holdLock).
const LOCK_WAIT_MS = 5_000;
const held = new Set();
function takeLock(lock, refused) {
  for (const until = Date.now() + LOCK_WAIT_MS; ; ) {
    try {
      closeSync(openSync(lock, 'wx'));
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (Date.now() > until) throw new Refused(refused);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
}
function withLock(dir, fn) {
  const lock = join(dir, 'jobs.lock');
  if (held.has(lock)) return fn();
  takeLock(lock, '.reach/jobs.lock is held by another reach.mjs or cut.mjs; when none runs, delete it');
  try {
    return fn();
  } finally {
    rmSync(lock, { force: true });
  }
}

/**
 * Takes .reach/jobs.lock for a whole cut, so no stop runs that cannot be recorded. A lock held by another
 * run, or left behind, refuses before anything stops. Returns the release. No .reach/: nothing to hold.
 */
export function holdLock(project) {
  const { dir } = reachDir(project);
  if (!lstatOrNull(dir)) return () => {};
  const lock = join(dir, 'jobs.lock');
  takeLock(lock, `the reach list is locked by another run: ${lock}; nothing stopped. When no reach.mjs or cut.mjs runs, your human deletes it`);
  held.add(lock);
  return () => {
    held.delete(lock);
    rmSync(lock, { force: true });
  };
}

// ---------------------------------------------------------------------------------------------------
// The list.

const MAX_MB = 4;
const MAX_LIST = MAX_MB * 1024 * 1024;
export const jobsPath = (dir) => join(dir, 'jobs.jsonl');

/**
 * Every event of the list, oldest first, with the list's last seq and MAC. A line that cannot be read, has
 * no valid MAC or is out of its place is refused, and with it the whole list: the list is the script's. So
 * is a list that does not end where the head says (a line replayed, moved, deleted, or the list cut short).
 */
function readChain(dir, root) {
  const path = jobsPath(dir);
  const st = plainFile(path, '.reach/jobs.jsonl');
  if (st && st.size > MAX_LIST) throw new Refused(`.reach/jobs.jsonl is over ${MAX_MB} MB`);
  const lines = st ? readFileSync(path, 'utf8').split('\n') : [];
  const key = lines.some((l) => l.trim()) ? keyOf({ root }) : null;
  const events = [];
  let seq = 0;
  let prev = '';
  for (const [n, line] of lines.entries()) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      throw new Refused(`.reach/jobs.jsonl line ${n + 1} cannot be read; fix it by hand or ask your human`);
    }
    const { mac, ...event } = e ?? {};
    const want = key && macOf(key, root, JSON.stringify(event));
    if (!want || typeof mac !== 'string' || !/^[0-9a-f]{64}$/.test(mac) || !timingSafeEqual(Buffer.from(mac, 'hex'), want)) {
      throw new Refused(`.reach/jobs.jsonl line ${n + 1} was not written by reach.mjs on this computer for this folder; nothing on the list is used or stopped: delete that line, or ask your human`);
    }
    if (event.seq !== seq + 1 || event.prev !== prev) throw changed(root, `line ${n + 1} is not the line reach.mjs wrote after line ${seq} (copied, moved, or a line before it deleted)`);
    seq += 1;
    prev = mac;
    events.push(event);
  }
  const head = readHead(root);
  if ((head?.seq ?? 0) !== seq || (head && head.mac !== prev)) {
    throw changed(root, head && seq < head.seq ? `it has ${seq} lines, and reach.mjs left ${head.seq}` : 'it does not end on the line reach.mjs wrote last');
  }
  return { events, seq, prev };
}
export const readEvents = (dir, root) => readChain(dir, root).events;

const BORN = /^[A-Za-z0-9:_.-]{1,120}$/;

/**
 * The jobs as they stand now, in the order they were first written: a Map of id → { id, owner, stop, born,
 * start, note, state (running | found | stopped), added (true for a job written with add), since }.
 * An event with a field that does not check out is refused, and so is a second added or seen line for a job
 * that is on the list and not stopped: a seen job never becomes yours.
 */
export function jobsOf(events) {
  const jobs = new Map();
  for (const [n, e] of events.entries()) {
    const bad = (why) => new Refused(`.reach/jobs.jsonl line ${n + 1}: ${why}; fix it by hand or ask your human`);
    let id;
    let stop;
    let owner;
    try {
      id = checkId(e?.id);
      if (e.event !== 'stopped') {
        stop = parseStop(e.stop);
        owner = checkOwner(e.owner);
        checkText(e.start, 'start', 400);
        checkText(e.note, 'note', 200);
        if (stop.kind === 'pid' && !BORN.test(String(e.born ?? ''))) throw new Error(`pid ${stop.pid} has no start time`);
        if (e.mine !== undefined && typeof e.mine !== 'boolean') throw new Error('mine is not true or false');
        if (e.found !== undefined && e.found !== true) throw new Error('found is not true');
      }
    } catch (err) {
      throw bad(err.message);
    }
    if (e.event === 'added' || e.event === 'seen') {
      const there = jobs.get(id);
      if (there && there.state !== 'stopped') throw bad(`${id} is on the list already (${there.state}), and a second ${e.event} line is refused`);
      jobs.set(id, { id, owner, stop, born: stop.kind === 'pid' ? e.born : undefined, start: e.start, note: e.note, state: e.event === 'added' ? 'running' : 'found', added: e.event === 'added', mine: e.event === 'added' && e.mine === true, foundThenAdded: e.event === 'added' && e.found === true, since: String(e.at ?? '') });
    } else if (e.event === 'stopped') {
      const job = jobs.get(id);
      if (job) jobs.set(id, { ...job, state: 'stopped', since: String(e.at ?? '') });
    } else {
      throw bad(`event ${JSON.stringify(oneLine(e?.event ?? '').slice(0, 40))} is not added, seen or stopped`);
    }
  }
  return jobs;
}

// A missing .reach/ is read too: when the head says the list had lines, it was deleted, and that is refused.
export const loadJobs = (project) => {
  const { root, dir } = reachDir(project);
  return jobsOf(readEvents(dir, root));
};

// ---------------------------------------------------------------------------------------------------
// Roles.

const ROLE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;

/** Your roles: --roles a,b, else the plain folders in roles/, else none. */
export function rolesOf(project, given) {
  if (given !== undefined) {
    const list = String(given).split(',').map((r) => r.trim()).filter(Boolean);
    for (const r of list) if (!ROLE.test(r) || isNoOwner(r)) throw usageError(`--roles: ${JSON.stringify(oneLine(r).slice(0, 80))} is not a role name`);
    if (!list.length) throw usageError('--roles: name at least one role');
    return list;
  }
  const dir = join(projectTop(project), 'roles');
  const st = lstatOrNull(dir);
  if (!st || st.isSymbolicLink() || !st.isDirectory()) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.isSymbolicLink() && ROLE.test(d.name))
    .map((d) => d.name)
    .sort();
}

/**
 * A job is yours when you wrote it with add, its owner was one of the project's roles when the line was
 * written (the signed mine field), and it is one of your roles now, by its exact name.
 */
export const isMine = (job, roles) => job.added && job.mine && job.owner !== 'none' && roles.includes(job.owner);
/** An added job whose owner is one of your roles now, but was not when its line was written. */
export const becameMine = (job, roles) => job.added && !job.mine && job.owner !== 'none' && roles.includes(job.owner);

// ---------------------------------------------------------------------------------------------------
// Writing.

const cell = (s) => oneLine(s ?? '').replace(/\|/g, '\\|').replace(/`/g, "'");

/** REACH.md, the list for people. */
export function viewOf(jobs, roles, root) {
  const rows = [...jobs.values()].map((j) => `| ${cell(j.id)} | ${cell(j.owner)}${isMine(j, roles) ? ' (yours)' : ''} | ${j.state}${j.foundThenAdded ? ' (found then added)' : ''} | ${cell(stopText(j.stop))} | ${j.start ? `\`${cell(j.start)}\`` : ''} | ${cell(j.since)} | ${cell(j.note)} |`);
  return [
    '# Reach list',
    '',
    'Written by `reach.mjs` from `.reach/jobs.jsonl`. Do not edit by hand: change the list with `reach.mjs add`, `seen`, or a stop through `cut.mjs`.',
    '',
    '| id | owner | state | stop | start again | since | note |',
    '|---|---|---|---|---|---|---|',
    ...rows,
    '',
    `Stop one: \`node "${packShown(root)}/scripts/cut.mjs" --job <id>\`, first with \`--dry-run\`. Run it from the project's folder.`,
    '',
    `Your roles: ${roles.length ? roles.map(cell).join(', ') : 'none named'}. A job is yours only when it was added (not seen) and its owner is one of them, both now and when its line was written.`,
    '',
  ].join('\n');
}

/** This pack's folder as REACH.md shows it: relative to the project when it is inside, with / between names. */
function packShown(root) {
  const pack = realpathSync.native(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  return oneLine(root && inside(root, pack) ? relative(root, pack) || '.' : pack)
    .replace(/\\/g, '/')
    .replace(/[`"]/g, '');
}

/** One event added to the list, then REACH.md written again. Returns the jobs after it. */
export function record(project, event, roles) {
  const { root, dir } = reachDir(project, { make: true });
  const key = keyOf({ make: true, root });
  withLock(dir, () => {
    const { seq, prev } = readChain(dir, root);
    const line = signedLine(key, root, { at: new Date().toISOString(), ...event, seq: seq + 1, prev });
    appendLine(jobsPath(dir), '.reach/jobs.jsonl', line);
    writeHead(root, seq + 1, JSON.parse(line).mac);
  });
  const jobs = jobsOf(readEvents(dir, root));
  writeWhole(join(root, 'REACH.md'), 'REACH.md', viewOf(jobs, roles, root));
  return jobs;
}

/** When a pid: stop's process started, read now; refused when it is not running or the system does not say. */
async function bornOf(stop, opts) {
  if (stop.kind !== 'pid') return {};
  const table = opts.table ?? (await processTable());
  const p = table.get(stop.pid);
  if (!p?.born) throw usageError(`pid ${stop.pid} is not running here, or the system does not say when it started; write the line while it runs`);
  return { born: p.born, table };
}

/**
 * Was pid started under this session: below this script, its parent (the shell) or that one's parent (the
 * harness)? A label, not a wall: a job whose parent is gone reads as not started here.
 */
function underSession(pid, table) {
  const roots = new Set([process.pid, process.ppid, table.get(process.ppid)?.ppid].filter((p) => p > 4));
  for (let p = pid, n = 0; table.has(p) && n < 64; p = table.get(p).ppid, n++) if (roots.has(table.get(p).ppid)) return true;
  return false;
}

export async function add(project, id, opts, roles) {
  checkId(id);
  const owner = checkOwner(opts.owner);
  if (opts.stop === undefined) throw usageError('--stop is required: pid:<n>, task:<name> or url:<https://…>');
  const stop = parseStop(opts.stop);
  const start = checkText(opts.start, '--start', 400);
  const note = checkText(opts.note, '--note', 200);
  const top = projectTop(project);
  if (stop.kind === 'url') checkSecretFree(stop.url, '--stop', top);
  checkSecretFree(start, '--start', top);
  const there = loadJobs(project).get(id);
  if (there && there.state !== 'stopped') throw usageError(`${id} is already on the list (${there.state}); stop it first, or use another id`);
  const { table, ...born } = await bornOf(stop, opts);
  // A pid this session did not start is a found job: added only on your human's word, named in --note.
  const found = stop.kind === 'pid' && !underSession(stop.pid, table);
  if (found && !note) throw usageError(`pid ${stop.pid} was not started under this session: found then added needs --note with your human's word (for example --note "my human: it is the writer's"); else write it with seen`);
  // Signed into the line: was the owner one of the project's roles (roles/, else the roles given) right now?
  // A folder made in roles/ later does not make the job yours (cut.mjs asks for --yes).
  const own = rolesOf(project);
  const mine = owner !== 'none' && (own.length ? own : roles ?? []).includes(owner);
  return record(project, { event: 'added', id, owner, mine, ...(found ? { found } : {}), stop: stopText(stop), ...born, ...(start ? { start } : {}), ...(note ? { note } : {}) }, roles);
}

export async function seen(project, id, opts, roles) {
  checkId(id);
  const owner = checkOwner(opts.owner);
  const stop = parseStop(opts.stop ?? (/^[1-9][0-9]{0,9}$/.test(id) ? `pid:${id}` : undefined));
  const note = checkText(opts.note, '--note', 200);
  if (stop.kind === 'url') checkSecretFree(stop.url, '--stop', projectTop(project));
  const there = loadJobs(project).get(id);
  if (there && there.state !== 'stopped') throw usageError(`${id} is already on the list (${there.state}); a seen line never changes a job's owner`);
  const { born } = await bornOf(stop, opts);
  return record(project, { event: 'seen', id, owner, stop: stopText(stop), ...(born ? { born } : {}), ...(note ? { note } : {}) }, roles);
}

// ---------------------------------------------------------------------------------------------------
// The command line.

const USAGE = [
  'usage: node reach.mjs add <id> --owner <role> --stop pid:<n>|task:<name>|url:<https://…> [--start "<line>"] [--note "…"] [--roles a,b]',
  '       node reach.mjs seen <id> --owner <role|none> [--stop …] [--note "…"] [--roles a,b]',
  '       node reach.mjs list [--json] [--roles a,b]',
].join('\n');

export function parseArgs(argv, flags) {
  const opts = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const m = /^--([a-z-]+)$/.exec(a);
    if (m && flags.includes(m[1])) {
      if (i + 1 >= argv.length) throw usageError(`${a} needs a value`);
      opts[m[1]] = argv[++i];
    } else if (m && flags.includes(`${m[1]}?`)) {
      opts[m[1]] = true;
    } else if (a.startsWith('--')) {
      throw usageError(`${oneLine(a).slice(0, 80)} is not a flag this script knows`);
    } else {
      rest.push(a);
    }
  }
  return { opts, rest };
}

export const jobLine = (j, roles) =>
  `${oneLine(j.id)} · ${oneLine(j.owner)}${isMine(j, roles) ? ' (yours)' : ''} · ${j.state}${j.foundThenAdded ? ' · found then added' : ''} · ${oneLine(stopText(j.stop))}${j.note ? ` · note ${JSON.stringify(oneLine(j.note))}` : ''}`;

export async function main(argv, { project = process.cwd(), out = (l) => console.log(l) } = {}) {
  const [command, ...args] = argv;
  if (command === 'add' || command === 'seen') {
    const { opts, rest } = parseArgs(args, ['owner', 'stop', 'start', 'note', 'roles']);
    if (rest.length !== 1) throw usageError(`${command} takes one job id`);
    if (command === 'seen' && opts.start !== undefined) throw usageError('seen takes no --start: a job you found is not yours to start');
    const roles = rolesOf(project, opts.roles);
    const jobs = await (command === 'add' ? add : seen)(project, rest[0], opts, roles);
    out(`${command === 'add' ? 'added' : 'seen'}: ${jobLine(jobs.get(rest[0]), roles)}`);
    return 0;
  }
  if (command === 'list') {
    const { opts, rest } = parseArgs(args, ['json?', 'roles']);
    if (rest.length) throw usageError('list takes no other argument');
    const roles = rolesOf(project, opts.roles);
    const jobs = [...loadJobs(project).values()];
    if (opts.json) {
      out(JSON.stringify({ roles, jobs: jobs.map((j) => ({ id: j.id, owner: j.owner, yours: isMine(j, roles), state: j.state, stop: stopText(j.stop), start: j.start ?? null, note: j.note ?? null, since: j.since })) }, null, 2));
      return 0;
    }
    if (!jobs.length) out('the list is empty: add each job when it starts');
    for (const j of jobs) out(jobLine(j, roles));
    out(`your roles: ${roles.length ? roles.map(oneLine).join(', ') : 'none named (roles/ has no folders; pass --roles a,b)'}`);
    return 0;
  }
  throw usageError(command ? `${oneLine(command).slice(0, 40)} is not a command: add, seen or list` : 'give a command: add, seen or list');
}

async function cli(argv) {
  if (argv[0] === '--self-test') {
    if (argv.length > 1) return usage('--self-test takes no other argument');
    const { selfTest } = await import(pathToFileURL(fileURLToPath(new URL('./reach.selftest.mjs', import.meta.url))).href);
    await selfTest();
    console.log('self-test ok');
    return 0;
  }
  try {
    return await main(argv);
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
  cli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(`reach failed: ${oneLine(e?.message ?? e)}`);
      process.exitCode = 1;
    },
  );
}
