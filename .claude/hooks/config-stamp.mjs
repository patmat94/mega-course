// Config stamp: every session records which config it started under.
// SessionStart: append one JSON line to runs.jsonl at the repo root:
//   {"session":..., "at": ISO UTC, "source": startup|resume|clear|compact, "harness": "claude-code",
//    "head": git HEAD sha, "dirty": true when the work tree has changes, "config": sha256 of AGENTS.md then KEEP.md}
// "config" hashes the raw bytes of AGENTS.md followed directly by the raw bytes of KEEP.md (a missing file counts as empty).
// To find the config a solve ran under: look up its session id in runs.jsonl, then `git show <head>:AGENTS.md`.
// `node .claude/hooks/config-stamp.mjs --print` prints the line for the current state and appends nothing.
// The hook never blocks a session: any failure writes nothing and exits 0. It prints nothing to the agent's context.
import { readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const runsFile = join(root, 'runs.jsonl');

const readBytes = (p) => {
  try {
    return readFileSync(p);
  } catch {
    return Buffer.alloc(0);
  }
};
const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};

export function configHash(dir = root) {
  return createHash('sha256')
    .update(readBytes(join(dir, 'AGENTS.md')))
    .update(readBytes(join(dir, 'KEEP.md')))
    .digest('hex');
}

function stamp(input) {
  const status = git('status', '--porcelain', '--', '.', ':!runs.jsonl');
  return {
    session: input.session_id ?? null,
    at: new Date().toISOString(),
    source: input.source ?? null,
    harness: 'claude-code',
    head: git('rev-parse', 'HEAD'),
    dirty: status === null ? null : status.length > 0,
    config: configHash(),
  };
}

try {
  if (process.argv.includes('--print')) {
    process.stdout.write(JSON.stringify(stamp({})) + '\n');
  } else {
    let input = {};
    try {
      input = JSON.parse(readFileSync(0, 'utf8').replace(/^﻿/, '') || '{}');
    } catch {}
    if (!input.hook_event_name || input.hook_event_name === 'SessionStart') {
      appendFileSync(runsFile, JSON.stringify(stamp(input)) + '\n');
    }
  }
} catch {}
