// vars: the agent's secret store. Values live in vars.json at the top of the Host Desk (one file for every role) and
// never reach the model:
// this tool lists names and hands back a reference, {{NAME}}. The http tool fills a reference in when it
// sends a request; the code tool passes the values to your script as environment variables.
// It also guards Pi's own read / edit / write: files inside this Host Desk only (or this job's worktree), never vars.json,
// and never a change to the role's tools (extensions, a role's scripts and run.mjs, hosts.json) or to .git.
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// host-desk/roles/<role>/extensions/vars.mjs → host-desk/
const DESK = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const WIN = process.platform === 'win32';

/** name → value, from vars.json. Missing file or bad JSON → no vars. */
export function loadVars() {
  try {
    const raw = JSON.parse(readFileSync(join(DESK, 'vars.json'), 'utf8'));
    return Object.fromEntries(Object.entries(raw).filter(([k, v]) => /^[A-Z][A-Z0-9_]*$/.test(k) && typeof v === 'string'));
  } catch {
    return {};
  }
}

/** Replaces every {{NAME}} with its value; an unknown name stays as written. */
export function fillVars(text, vars = loadVars()) {
  return String(text).replace(/\{\{([A-Z][A-Z0-9_]*)\}\}/g, (ref, name) => (name in vars ? vars[name] : ref));
}

const real = (p) => {
  try {
    return realpathSync.native(p);
  } catch {
    return null;
  }
};
const fold = (p) => (WIN ? p.toLowerCase() : p);

/**
 * The file a path names, as Pi opens it (its read / edit / write: Unicode spaces as spaces, a leading `@` dropped, Git
 * Bash `/c/…` on Windows, `~` = home, `file://` URLs; relative to `cwd`), then real: the file's real path when it
 * exists, else its nearest existing folder's real path + the rest.
 */
export function resolveLikePi(input, cwd = process.cwd()) {
  let p = String(input).replace(/[  -   　]/g, ' ');
  if (p.startsWith('@')) p = p.slice(1);
  if (WIN && p.startsWith('/') && !p.startsWith('//') && !p.includes('\\')) {
    const m = /^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i.exec(p);
    if (m) p = `${m[1].toUpperCase()}:\\${(m[2] ?? '').replaceAll('/', '\\')}`;
  }
  if (p === '~') p = homedir();
  else if (p.startsWith('~/') || (WIN && p.startsWith('~\\'))) p = join(homedir(), p.slice(2));
  if (/^file:\/\//.test(p)) p = fileURLToPath(p);
  const abs = isAbsolute(p) ? resolve(p) : resolve(cwd, p);
  const rest = [];
  for (let head = abs; ; ) {
    const r = real(head);
    if (r) return rest.length ? join(r, ...rest.reverse()) : r;
    const up = dirname(head);
    if (up === head) return abs;
    rest.push(basename(head));
    head = up;
  }
}

/** On Windows a path with a stream (`::$DATA`, any `:` past the drive) or a short name (`VARS~1.JSO`) is refused. */
const oddOnWindows = (p) => WIN && (/:/.test(String(p).replace(/^[a-z]:/i, '').replace(/^[\\/]{2}\?[\\/][a-z]:/i, '')) || /(^|[\\/])[^\\/]*~\d/.test(String(p)));

/** The Host Desk's own vars.json (its real path and file id), when it exists. */
function deskVars() {
  const file = real(join(DESK, 'vars.json'));
  if (!file) return null;
  try {
    const s = statSync(file, { bigint: true });
    return { file: fold(file), id: `${s.dev}:${s.ino}` };
  } catch {
    return { file: fold(file), id: null };
  }
}

/** true when `p` (as Pi opens it) is a vars.json: by name in any folder, or the Host Desk's own (a link, any spelling). */
export function namesVars(p, cwd = process.cwd()) {
  if (typeof p !== 'string' || !p.trim()) return false;
  const file = resolveLikePi(p.trim(), cwd);
  if (fold(basename(file)) === 'vars.json') return true;
  const own = deskVars();
  if (!own) return false;
  if (fold(file) === own.file) return true;
  try {
    const s = statSync(file, { bigint: true });
    return own.id !== null && `${s.dev}:${s.ino}` === own.id;
  } catch {
    return false;
  }
}

/** true when a tool call names vars.json: its `path` as Pi opens it, or any other text field that is a path to one. */
export const touchesVars = (input, cwd = process.cwd()) =>
  namesVars(input?.path, cwd) || Object.entries(input ?? {}).some(([k, v]) => k !== 'path' && typeof v === 'string' && /(^|[\\/])vars\.json$/i.test(v.trim()));

const within = (root, file) => {
  const rel = relative(fold(root), fold(file));
  return rel === '' || (!isAbsolute(rel) && rel.split(sep)[0] !== '..');
};

/** The team roles (S04E03): their scripts/ run with the vars through their own code tool. payout-runner's scripts stay open: they are the plan's files. */
const TEAM = new Set(['critic', 'planner', 'worker', 'integrator']);

/** Where a change may never go: .git, any hosts.json or vars.json, any role's extensions and run.mjs, a team role's scripts. */
function guarded(file, top) {
  const parts = relative(top, file).split(sep);
  const low = parts.map((x) => fold(x));
  if (low.includes('.git') || ['hosts.json', 'vars.json'].includes(low.at(-1))) return true;
  const at = low.indexOf('roles');
  if (at < 0 || parts.length < at + 3) return false;
  const what = low[at + 2];
  if (what === 'extensions' || (what === 'run.mjs' && parts.length === at + 3)) return true;
  return what === 'scripts' && TEAM.has(low[at + 1]);
}

export const OUTSIDE = 'Not done: read, edit and write work on files inside this Host Desk only.';
export const GUARDED = 'Not done: no role changes the roles’ tools (extensions/, run.mjs, the team roles’ scripts/), hosts.json, vars.json or .git.';
export const VARS = 'vars.json holds the secrets: use the vars tool, which gives references, never the values.';
export const ODD = 'Not done: write the path out in full (no `:` after the drive, no short `~1` name).';

/** Why Pi's read / edit / write may not take this call, or null. `cwd`: where Pi runs (this Host Desk or this job's worktree). */
export function fileRefusal(toolName, input, cwd = process.cwd()) {
  if (!['read', 'edit', 'write'].includes(toolName)) return null;
  const p = input?.path;
  if (typeof p === 'string' && oddOnWindows(p)) return ODD;
  if (touchesVars(input, cwd)) return VARS;
  if (typeof p !== 'string' || !p.trim()) return null;
  const top = real(DESK) ?? DESK;
  const file = resolveLikePi(p.trim(), cwd);
  if (!within(top, file)) return OUTSIDE;
  if (toolName !== 'read' && guarded(file, top)) return GUARDED;
  return null;
}

export default function (pi) {
  // The values stay out of the model, and Pi's file tools stay inside this Host Desk (security review 2026-11-16 #7, #8).
  pi.on('tool_call', async (event, ctx) => {
    const reason = fileRefusal(event.toolName, event.input, ctx?.cwd || process.cwd());
    if (reason) return { block: true, reason };
  });
  pi.registerTool({
    name: 'vars',
    label: 'vars',
    description: 'Lists the stored secrets by name. Returns a reference like {{PAYOUT_KEY}}, never the value. Put the reference in an http request; it is filled in when the request is sent.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    async execute() {
      const names = Object.keys(loadVars());
      const text = names.length ? names.map((n) => `{{${n}}}`).join('\n') : 'No vars yet. Your human adds them to vars.json.';
      return { content: [{ type: 'text', text }], details: { names } };
    },
  });
}
