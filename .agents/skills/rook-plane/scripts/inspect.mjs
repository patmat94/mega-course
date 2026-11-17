#!/usr/bin/env node
// inspect.mjs · what each role is, what it reads at its start, and which of its settings has no why.
//
//   node inspect.mjs [roles/] [--json] [--strict]
//   node inspect.mjs --self-test
//
// Run it from the project's folder. It takes a folder of roles (roles/, the default) or one role folder,
// and lists, for each role: its purpose (first line), its startup reads (reads.json), its tools, its
// limits, its settings, its last run (runs.jsonl: when, the folder's version, each read's version, the
// harness) and every setting with no why.
//
// A setting is a choice in the role's own files: each item under "## Tools", "## Limits" and "## Settings"
// in ROLE.md (a model, an effort, a harness flag), and each secret its reads name as {{NAME}}, with its hosts
// from the project's hosts.json. A setting
// has a why when a line right under its item starts with "why:", or when a note in why/ (the project's
// or the role's own) names it in backticks: `model`. A setting's name is its first `code` part, else the
// words before its first ":", else the whole item.
//
// It only reads. It runs nothing from a role, follows no link, and changes no file. Each field is printed
// on its own line as text: a line break in a role's file shows as \u{a}, never as a new line.
// A role with no "## Tools", "## Limits" or "## Settings" section is listed as `no why: unknown: …`, never as
// an all-clear: its settings may sit in a plain list inspect does not read.
// Exit codes: 0 it listed (also when a setting has no why), 1 with --strict when one has none or is unknown, 2 a usage error.
// Plain Node.js 20 or newer, no dependencies.

import { closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { folderHash, hostShown, parseArgs, READ_NAME, SECRET_NAME, shown } from './startup.mjs';

const MAX_FILE = 256 * 1024;
const SETTING_SECTIONS = ['tools', 'limits', 'settings'];
// A role with none of the sections, or a ROLE.md not read, is never an all-clear: inspect cannot see its settings.
const NO_SECTIONS = 'no Tools / Limits / Settings section (see templates/role/ROLE.md)';
const NOT_READ = 'ROLE.md not read';

// A plain file's text, or null: a link, a folder, a missing file, a file with a second name (a hard link)
// or one over the size is not read. It is read through the handle whose stat was checked.
function plainText(path) {
  let fd;
  try {
    const st = lstatSync(path, { bigint: true });
    if (st.isSymbolicLink() || !st.isFile()) return null;
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const f = fstatSync(fd, { bigint: true });
    if (!f.isFile() || f.nlink > 1n || f.ino !== st.ino || f.dev !== st.dev || f.size > BigInt(MAX_FILE)) return null;
    const buf = readFileSync(fd);
    if (buf.length > MAX_FILE) return null;
    return buf.toString('utf8').replace(/^\u{feff}/u, '').replace(/\r\n/g, '\n');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
// A get read's URL as printed: never its query, and a part of its host or path that may be a value
// (over 24 characters, or digits mixed with letters) shows as …. A {{NAME}} stays a name.
const valueLike = (part) => part.length > 24 || (/[0-9]/.test(part) && /[A-Za-z]/.test(part));
const pathPart = (part) => {
  let d = part;
  try {
    d = decodeURIComponent(part);
  } catch {
    // shown as written
  }
  return /^\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}$/.test(d) ? d : valueLike(d) ? '…' : part;
};
export const urlShown = (u) => {
  try {
    const url = new URL(String(u));
    const host = url.hostname.startsWith('[') || /^[\d.]+$/.test(url.hostname) ? url.hostname : url.hostname.split('.').map((l) => (valueLike(l) ? '…' : l)).join('.');
    return `${url.protocol}//${host}${url.port ? `:${url.port}` : ''}${url.pathname.split('/').map(pathPart).join('/')}${url.search ? '?…' : ''}`;
  } catch {
    return '(not a URL)';
  }
};
// A field as it goes into one line: steering characters and line breaks show as \u{…}.
const flat = (s) => shown(s).replace(/[\n\t]/g, (c) => `\\u{${c.codePointAt(0).toString(16)}}`);

const isPlainDir = (path) => {
  try {
    const st = lstatSync(path);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
};

// ROLE.md as its sections: { title, sections: Map(lowercased heading → lines) }.
export function sectionsOf(text) {
  const sections = new Map();
  let title = '';
  let current = null;
  let fenced = false;
  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && /^#\s+/.test(line) && !title) {
      title = line.replace(/^#\s+/, '').trim();
      continue;
    }
    if (!fenced && /^##\s+/.test(line)) {
      current = line.replace(/^##\s+/, '').trim().toLowerCase();
      sections.set(current, []);
      continue;
    }
    if (current) sections.get(current).push(line);
  }
  return { title, sections };
}

const ITEM = /^(?:[-*+]|\d+[.)])\s+(.*)$/;

// The items of a section: each top-level list item, with the lines indented under it.
export function itemsOf(lines = []) {
  const items = [];
  let last = null;
  for (const line of lines) {
    const top = ITEM.exec(line);
    if (top) items.push((last = { text: top[1].trim(), under: [] }));
    else if (last && /^\s+\S/.test(line)) last.under.push(line.trim());
    else if (line.trim() !== '') last = null;
  }
  return items;
}

export function nameOf(text) {
  const code = /`([^`]+)`/.exec(text);
  if (code) return code[1].trim();
  const colon = text.indexOf(':');
  const words = (colon > 0 ? text.slice(0, colon) : text).trim();
  return words.length > 80 ? `${words.slice(0, 77)}...` : words;
}

const whyUnder = (item) =>
  item.under.some((l) => /^(?:[-*+]\s+)?why:\s*\S/i.test(l)) || /[\s(]why:\s*\S/i.test(item.text);

// The why-notes: every why/*.md of the project and of the role, as lowercased text.
function whyNotes(dirs) {
  const notes = [];
  for (const d of dirs) {
    if (!isPlainDir(d)) continue;
    for (const n of readdirSync(d).sort()) {
      if (!/\.md$/i.test(n) || n.startsWith('.')) continue;
      const t = plainText(join(d, n));
      if (t !== null) notes.push(t.toLowerCase());
    }
  }
  return notes;
}
const named = (notes, name) => notes.some((t) => t.includes(`\`${name.toLowerCase()}\``));

function lastRun(dir) {
  const t = plainText(join(dir, 'runs.jsonl'));
  if (t === null) return null;
  const lines = t.trim().split('\n').filter(Boolean);
  if (!lines.length) return null;
  try {
    const r = JSON.parse(lines.at(-1));
    return {
      at: String(r.at ?? '?'),
      launcher: String(r.launcher ?? '?'),
      folder: String(r.folder ?? '?'),
      reads: Array.isArray(r.reads) ? r.reads.map((x) => ({ name: String(x?.name ?? '?'), version: String(x?.version ?? '?') })) : [],
      runs: lines.length,
    };
  } catch {
    return { unreadable: true, runs: lines.length };
  }
}

/** One role, as inspect lists it. `project` is where the project's why/ is. */
export function inspectRole(dir, project) {
  const role = { name: dir.split(/[\\/]/).at(-1), path: relative(project, dir).split(sep).join('/') || '.', notes: [] };
  const text = plainText(join(dir, 'ROLE.md'));
  if (text === null) {
    role.notes.push('ROLE.md is missing, a link, has a second name (a hard link), or is over 256 KB: not read');
    return { ...role, purpose: '', reads: [], tools: [], limits: [], settings: [], lastRun: null, noWhy: [{ section: 'unknown', name: NOT_READ }] };
  }
  const { title, sections } = sectionsOf(text);
  const purposeLines = (sections.get('purpose') ?? text.split('\n').slice(1)).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  role.purpose = purposeLines[0] ?? title;

  const readsText = plainText(join(dir, 'reads.json'));
  role.reads = [];
  if (readsText === null) {
    role.notes.push(existsSync(join(dir, 'reads.json')) ? 'reads.json is a link, has a second name (a hard link), or is over 256 KB: not read; startup refuses it' : 'reads.json is missing: this role reads nothing at its start');
  }
  else {
    try {
      const list = JSON.parse(readsText);
      if (!Array.isArray(list)) throw new Error();
      role.reads = list.map((r) => {
        const name = String(r?.name ?? '?');
        const secrets = r?.get ? [r.get, ...Object.values(r?.headers ?? {})].flatMap((t) => [...String(t).matchAll(SECRET_NAME)].map((m) => m[1])) : [];
        return { name, nameOk: READ_NAME.test(name), source: r?.get ? urlShown(r.get) : String(r?.files ?? '?'), kind: r?.get ? 'get' : r?.files ? 'files' : '?', secrets };
      });
    } catch {
      role.notes.push('reads.json is not a list of reads');
    }
  }

  const notes = whyNotes([join(project, 'why'), join(dir, 'why')]);
  const settings = [];
  for (const section of SETTING_SECTIONS) {
    for (const item of itemsOf(sections.get(section))) {
      const name = nameOf(item.text);
      settings.push({ section, name, text: item.text, why: whyUnder(item) || named(notes, name) });
    }
  }
  // Each secret the reads name, with its hosts from the project's hosts.json (the one startup uses without --hosts).
  if (existsSync(join(dir, 'hosts.json'))) role.notes.push("hosts.json in the role folder: startup refuses it; the hosts go in the project's hosts.json");
  const secrets = [...new Set(role.reads.flatMap((r) => r.secrets))];
  if (secrets.length) {
    const hostsText = plainText(join(project, 'hosts.json'));
    let hosts = {};
    if (hostsText !== null) {
      try {
        hosts = JSON.parse(hostsText) ?? {};
      } catch {
        role.notes.push("the project's hosts.json is not JSON");
      }
    }
    for (const secret of secrets) {
      const list = Object.hasOwn(hosts, secret) ? hosts[secret] : undefined;
      let shownList;
      if (list === undefined) shownList = '(not in hosts.json)';
      // Host names only: an entry that is not a host shows as (not a host), never as written.
      else if (Array.isArray(list)) shownList = list.length ? list.map(hostShown).join(', ') : '(no host)';
      else {
        // Never the value: a secret pasted in the wrong file stays out of the output.
        shownList = '(not a list of hosts)';
        role.notes.push(`hosts.json: ${secret} is not a list of hosts`);
      }
      settings.push({ section: 'hosts.json', name: secret, text: `${secret} → ${shownList}`, why: named(notes, secret) });
    }
  }
  role.tools = settings.filter((s) => s.section === 'tools').map((s) => s.text);
  role.limits = settings.filter((s) => s.section === 'limits').map((s) => s.text);
  role.settings = settings.filter((s) => s.section === 'settings' || s.section === 'hosts.json').map((s) => s.text);
  role.noWhy = settings.filter((s) => !s.why).map((s) => ({ section: s.section, name: s.name }));
  if (!SETTING_SECTIONS.some((s) => sections.has(s))) role.noWhy.unshift({ section: 'unknown', name: NO_SECTIONS });

  const run = lastRun(dir);
  role.lastRun = run;
  if (run && !run.unreadable) {
    try {
      run.changedSince = folderHash(dir) !== run.folder;
    } catch {
      run.changedSince = null;
    }
  }
  return role;
}

/** Every role in `arg`: a folder of roles, or one role folder (it holds ROLE.md). */
export function inspectAll(arg = 'roles', project = process.cwd()) {
  const dir = resolve(project, arg);
  if (!isPlainDir(dir)) throw Object.assign(new Error(`no folder at ${arg}`), { usage: true });
  if (existsSync(join(dir, 'ROLE.md'))) return [inspectRole(dir, project)];
  return readdirSync(dir)
    .sort()
    .filter((n) => !n.startsWith('.') && isPlainDir(join(dir, n)) && existsSync(join(dir, n, 'ROLE.md')))
    .map((n) => inspectRole(join(dir, n), project));
}

const list = (xs) => (xs.length ? xs.map(flat).join(' · ') : '(none)');

export function asText(roles) {
  if (!roles.length) return 'no role folders here (a role folder holds ROLE.md)';
  return roles
    .map((r) => {
      const run = r.lastRun;
      const runLine = !run
        ? 'never'
        : run.unreadable
          ? `its last line in runs.jsonl is not JSON (${run.runs} lines)`
          : `${flat(run.at)} · ${flat(run.launcher)} · folder ${flat(run.folder)}${run.changedSince ? ' (the folder changed since)' : ''} · ${list(run.reads.map((x) => `${x.name} ${x.version}`))} · ${run.runs} starts`;
      const lines = [
        `${flat(r.name)} (${flat(r.path)})`,
        `  purpose: ${r.purpose ? flat(r.purpose) : '(none)'}`,
        `  startup reads: ${list(r.reads.map((x) => `${x.name}${x.nameOk === false ? ' (not a name startup takes)' : ''} ← ${x.source}`))}`,
        `  tools: ${list(r.tools)}`,
        `  limits: ${list(r.limits)}`,
        `  settings: ${list(r.settings)}`,
        `  last run: ${runLine}`,
        r.noWhy.length
          ? `  no why: ${r.noWhy.map((s) => (s.section === 'unknown' ? `unknown: ${flat(s.name)}` : `${s.section} \`${flat(s.name)}\``)).join(' · ')}`
          : '  no why: none: every setting has its why',
        ...r.notes.map((n) => `  note: ${flat(n)}`),
      ];
      return lines.join('\n');
    })
    .join('\n\n');
}

// ---------------------------------------------------------------------------------------------------
// The command line.

const USAGE = 'usage: node inspect.mjs [roles/] [--json] [--strict]';

function main(argv) {
  if (argv[0] === '--self-test') {
    if (argv.length > 1) return usage('--self-test takes no other argument');
    return import(pathToFileURL(fileURLToPath(new URL('./inspect.selftest.mjs', import.meta.url))).href)
      .then(({ selfTest }) => selfTest())
      .then(() => {
        console.log('self-test ok');
        return 0;
      });
  }
  let parsed;
  try {
    parsed = parseArgs(argv, ['json?', 'strict?']);
  } catch (e) {
    return usage(e.message);
  }
  if (parsed.rest.length > 1) return usage('name one folder');
  let roles;
  try {
    roles = inspectAll(parsed.rest[0] ?? 'roles');
  } catch (e) {
    if (e.usage) return usage(e.message);
    throw e;
  }
  console.log(parsed.opts.json ? shown(JSON.stringify(roles, null, 2)) : asText(roles));
  return parsed.opts.strict && roles.some((r) => r.noWhy.length) ? 1 : 0;
}

function usage(message) {
  console.error(`${shown(message)}\n${USAGE}`);
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  Promise.resolve()
    .then(() => main(process.argv.slice(2)))
    .then(
      (code) => {
        process.exitCode = code;
      },
      (e) => {
        console.error(`inspect failed: ${shown(e?.message ?? e)}`);
        process.exitCode = 2;
      },
    );
}
