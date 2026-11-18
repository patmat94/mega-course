// Domain wake: when Main reads or edits a file that a domain agent owns, that agent wakes,
// reads its memories and hands Main the traps that apply, as context, before the tool runs.
// PreToolUse on Read|Edit|MultiEdit|Write. Never blocks the tool: on any failure it only adds a note.
//
// A domain is agents/<name>/domain.json: { name, agent, model, globs, memories }. `agent` names a
// subagent in .claude/agents/ (read-only tools, small model). The agent runs as `claude -p --agent`
// with hooks off, no MCP servers and Read/Grep/Glob only.
//
// How often: once per session per domain for reads; once per session per file for edits.
// State lives in .claude/state/domain-wake/<session>.json (git-ignored).
// DOMAIN_WAKE_CHILD=1 (set for the agent's own run) turns the hook off, so it cannot wake itself.
// DOMAIN_WAKE_FAKE=<text> skips claude and answers <text> (tests).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const PASS = '{}';
const TIMEOUT_MS = 80_000; // the hook's own timeout in settings.json is 90 s
const MAX_EDIT = 2000;

export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; } else { re += '.*'; i += 1; }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, process.platform === 'win32' ? 'i' : '');
}

export function relPath(root, file) {
  if (!file) return null;
  const abs = isAbsolute(file) ? file : join(root, file);
  const rel = relative(root, abs).replace(/\\/g, '/');
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel;
}

export function loadDomains(root) {
  const dir = join(root, 'agents');
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const f = join(dir, name, 'domain.json');
    if (!existsSync(f)) continue;
    try {
      const d = JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, ''));
      if (d.agent && Array.isArray(d.globs)) out.push({ name, model: 'haiku', ...d });
    } catch {}
  }
  return out;
}

export const owners = (domains, rel) => domains.filter((d) => d.globs.some((g) => globToRegExp(g).test(rel)));

export function wakeKey(domain, tool, rel) {
  return tool === 'Read' ? `${domain.name}:read` : `${domain.name}:edit:${rel}`;
}

const cut = (s) => (typeof s === 'string' && s.length > MAX_EDIT ? `${s.slice(0, MAX_EDIT)}\n…(cut)` : s);

export function buildPrompt(domain, tool, rel, input) {
  const lines = [`Main is about to run ${tool} on ${rel}.`];
  if (tool === 'Edit') lines.push('', 'Text being replaced:', '```', cut(input.old_string ?? ''), '```', 'New text:', '```', cut(input.new_string ?? ''), '```');
  if (tool === 'MultiEdit') for (const e of input.edits ?? []) lines.push('', 'Replace:', '```', cut(e.old_string ?? ''), '```', 'With:', '```', cut(e.new_string ?? ''), '```');
  if (tool === 'Write') lines.push('', 'New file content:', '```', cut(input.content ?? ''), '```');
  lines.push('', `Read ${domain.memories ?? `agents/${domain.name}/memories.md`} and answer as your instructions say.`);
  return lines.join('\n');
}

function ask(root, domain, prompt) {
  if (process.env.DOMAIN_WAKE_FAKE !== undefined) return { ok: true, text: process.env.DOMAIN_WAKE_FAKE };
  const args = [
    '-p', prompt,
    '--agent', domain.agent,
    '--model', domain.model,
    '--tools', 'Read,Grep,Glob',
    '--settings', '{"disableAllHooks":true}',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--output-format', 'text',
  ];
  const r = spawnSync(process.env.DOMAIN_WAKE_CLAUDE || 'claude', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'], // claude -p reads stdin otherwise (KEEP.md)
    env: { ...process.env, DOMAIN_WAKE_CHILD: '1' },
    windowsHide: true,
  });
  if (r.error) return { ok: false, text: r.error.code === 'ETIMEDOUT' ? `timed out after ${TIMEOUT_MS / 1000} s` : r.error.message };
  if (r.status !== 0) return { ok: false, text: `exit ${r.status}: ${(r.stderr || r.stdout || '').trim().slice(0, 200)}` };
  return { ok: true, text: r.stdout.trim() };
}

export function run(input, root) {
  if (process.env.DOMAIN_WAKE_CHILD) return PASS;
  const tool = input.tool_name;
  if (!['Read', 'Edit', 'MultiEdit', 'Write'].includes(tool)) return PASS;
  const ti = input.tool_input ?? {};
  const rel = relPath(root, ti.file_path);
  if (!rel) return PASS;
  const hit = owners(loadDomains(root), rel);
  if (!hit.length) return PASS;

  const stateDir = join(root, '.claude', 'state', 'domain-wake');
  const stateFile = join(stateDir, `${String(input.session_id || 'none').replace(/[^\w.-]/g, '_')}.json`);
  let state = {};
  try { state = JSON.parse(readFileSync(stateFile, 'utf8')); } catch {}

  const notes = [];
  for (const d of hit) {
    const key = wakeKey(d, tool, rel);
    if (state[key]) continue;
    const r = ask(root, d, buildPrompt(d, tool, rel, ti));
    state[key] = new Date().toISOString();
    notes.push(r.ok
      ? `Domain agent ${d.agent} (agents/${d.name}, ${d.model}) woke for ${tool} on ${rel}:\n${r.text}`
      : `Domain agent ${d.agent} could not run (${r.text}). Read ${d.memories ?? `agents/${d.name}/memories.md`} before you change ${rel}.`);
  }
  if (!notes.length) return PASS;
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFile, JSON.stringify(state, null, 1));
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: notes.join('\n\n') } });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let out = PASS;
  try {
    const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    out = run(JSON.parse(readFileSync(0, 'utf8') || '{}'), root);
  } catch {}
  process.stdout.write(out);
}
