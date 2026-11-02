// Stop hook: before the agent stops, look again at the sources the work relied on.
// Finds the lesson folder worked on last (newest log.txt, changed in the last 12 hours).
// Its receipts.json may list sources under "watch": URLs that return a file list (JSON with
// files[].name) or any page, and local folders. Each stop compares them with the last stop's
// snapshot, kept in .claude/state/. A new, gone or changed source blocks the stop with the
// list as the reason, so the agent reads it before it claims or hands off.
// Guard: at most 3 blocks per session, and a source that cannot be fetched never blocks.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const stateDir = join(root, '.claude', 'state');
const MAX_BLOCKS = 3;
const RECENT_MS = 12 * 3600 * 1000;

// Results return instead of calling process.exit: on Windows, exiting right after fetch() trips a libuv assertion (exit 127).
const PASS = '{}';
const block = (reason) => JSON.stringify({ decision: 'block', reason });
const readJson = (p, dflt) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, ''));
  } catch {
    return dflt;
  }
};

function activeLesson() {
  let best = null;
  for (const dir of readdirSync(root)) {
    if (!/^mega-s\d\de\d\d$/.test(dir)) continue;
    const log = join(root, dir, 'log.txt');
    if (!existsSync(log)) continue;
    const t = statSync(log).mtimeMs;
    if (Date.now() - t < RECENT_MS && (!best || t > best.t)) best = { dir, t };
  }
  return best?.dir ?? null;
}

// A source's view: a sorted list of items. For a file list, its names; for a page, one hash; for a folder, path+size.
async function view(src, lessonDir) {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    try {
      const files = JSON.parse(text).files;
      if (Array.isArray(files)) return files.map((f) => f.name ?? JSON.stringify(f)).sort();
    } catch {}
    return [`page ${createHash('sha256').update(text).digest('hex').slice(0, 16)}`];
  }
  const dir = join(lessonDir, src);
  const walk = (d) =>
    readdirSync(d).flatMap((n) => {
      const p = join(d, n);
      const s = statSync(p);
      return s.isDirectory() ? walk(p) : [`${relative(dir, p)} ${s.size}`];
    });
  return walk(dir).sort();
}

// A label that never shows a signed link: host + first path part, or the folder name.
const label = (src) => {
  try {
    const u = new URL(src);
    return `${u.host}/${u.pathname.split('/').filter(Boolean).slice(0, 2).join('/')}/…`;
  } catch {
    return src;
  }
};

async function check() {
  const input = readJson(0, {});
  const lesson = activeLesson();
  if (!lesson) return PASS;
  const watch = readJson(join(root, lesson, 'receipts.json'), {}).watch;
  if (!Array.isArray(watch) || !watch.length) return PASS;

  mkdirSync(stateDir, { recursive: true });
  const stateFile = join(stateDir, `recheck-${lesson}.json`);
  const state = readJson(stateFile, { sources: {}, blocks: {} });
  const session = input.session_id || 'unknown';
  const blocksSoFar = state.blocks[session] ?? 0;

  const changes = [];
  for (const src of watch) {
    let now;
    try {
      now = await view(src, join(root, lesson));
    } catch {
      continue;
    }
    const before = state.sources[src];
    state.sources[src] = now;
    if (!before) continue; // first look: remember it, nothing to compare yet
    const added = now.filter((x) => !before.includes(x));
    const gone = before.filter((x) => !now.includes(x));
    if (added.length || gone.length)
      changes.push(
        `${label(src)}: ${added.map((x) => `new ${x}`).concat(gone.map((x) => `gone ${x}`)).slice(0, 8).join('; ')}`,
      );
  }

  if (changes.length && blocksSoFar < MAX_BLOCKS) {
    state.blocks[session] = blocksSoFar + 1;
    writeFileSync(stateFile, JSON.stringify(state, null, 2));
    return block(
      `Sources for ${lesson} changed since the last stop. Read what changed, update the work it bears on (plan, ticket, build), ` +
        `and tell your human before you stop:\n- ${changes.join('\n- ')}`,
    );
  }
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
  return PASS;
}

let out = PASS;
try {
  out = await check();
} catch {}
process.stdout.write(out);
process.exitCode = 0;
