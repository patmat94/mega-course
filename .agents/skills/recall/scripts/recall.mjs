#!/usr/bin/env node
// recall.mjs — read agent session files from any harness, subagent threads included.
//
//   node recall.mjs index  [root ...]            one row per session file: harness, session, parent, cwd, first/last time, first ask
//   node recall.mjs show   <file> [--max N] [--talk]  readable transcript, UTC times, repeats collapsed, tool output cut to N chars;
//                                                --talk keeps only what people and agents said
//   node recall.mjs grep   <regex> [root ...]    matching messages (not tool noise) with file, line and time
//   node recall.mjs orphans [root ...]           subagent threads whose parent session file is not on disk
//
// Roots default to ~/.claude/projects and ~/.codex/sessions (those that exist).
// Knows Claude Code (.claude/projects/**.jsonl, subagents/agent-*.jsonl) and Codex CLI (rollout-*.jsonl).
// Any other .jsonl is read as best it can. Read-only: it never writes.
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, basename, dirname, sep } from 'node:path';
import { homedir } from 'node:os';

const [cmd, ...rest] = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = rest.indexOf(name);
  if (i < 0) return dflt;
  const v = rest[i + 1];
  rest.splice(i, 2);
  return v;
};
const max = Number(opt('--max', 300));
const talk = rest.includes('--talk') && rest.splice(rest.indexOf('--talk'), 1);

const defaultRoots = () =>
  [join(homedir(), '.claude', 'projects'), join(homedir(), '.codex', 'sessions')].filter(existsSync);

const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    try {
      return statSync(p).isDirectory() ? walk(p) : [p];
    } catch {
      return [];
    }
  });

const jsonlFiles = (roots) => roots.flatMap((r) => (statSync(r).isDirectory() ? walk(r) : [r])).filter((p) => p.endsWith('.jsonl'));

const lines = (file) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l, i) => {
      try {
        return { n: i + 1, o: JSON.parse(l) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

const cut = (s) => {
  s = String(s ?? '');
  return s.length > max ? `${s.slice(0, max)} …[+${s.length - max}]` : s;
};

// One shape for every harness: { ts, kind, text } where kind is user | assistant | tool-call | tool-result | thinking | system
function entries(o) {
  const ts = o.timestamp ?? o.payload?.timestamp ?? '';
  const out = [];
  if (o.message) {
    const c = o.message.content;
    const parts = typeof c === 'string' ? [{ type: 'text', text: c }] : c ?? [];
    for (const p of parts) {
      if (p.type === 'text') out.push({ ts, kind: o.type === 'user' ? 'user' : 'assistant', text: p.text });
      else if (p.type === 'thinking') out.push({ ts, kind: 'thinking', text: p.thinking });
      else if (p.type === 'tool_use') out.push({ ts, kind: 'tool-call', text: `${p.name} ${JSON.stringify(p.input)}` });
      else if (p.type === 'tool_result')
        out.push({ ts, kind: 'tool-result', text: typeof p.content === 'string' ? p.content : JSON.stringify(p.content) });
    }
  } else if (o.type === 'system') out.push({ ts, kind: 'system', text: o.content ?? o.subtype ?? '' });
  else if (o.payload) {
    const p = o.payload;
    if (p.type === 'user_message') out.push({ ts, kind: 'user', text: p.message });
    else if (p.type === 'agent_message') out.push({ ts, kind: 'assistant', text: p.message });
    else if (p.type === 'reasoning') out.push({ ts, kind: 'thinking', text: (p.summary ?? []).map((x) => x.text).join(' ') });
    else if (p.type === 'function_call') out.push({ ts, kind: 'tool-call', text: `${p.name} ${p.arguments}` });
    else if (p.type === 'function_call_output') {
      let t = p.output;
      try {
        t = JSON.parse(t).output ?? t;
      } catch {}
      out.push({ ts, kind: 'tool-result', text: typeof t === 'string' ? t : JSON.stringify(t) });
    }
    // Codex also writes response_item/message for the same user and agent text; event_msg already has it.
  }
  return out;
}

// A user turn that is really a tool result, a compaction summary or a reminder is not a human ask.
const isHumanAsk = (e) => e.kind === 'user' && !/^This session is being continued/.test(e.text);

function describe(file) {
  const ls = lines(file);
  const first = ls[0]?.o ?? {};
  const meta = ls.find((l) => l.o.type === 'session_meta')?.o.payload;
  const harness = meta ? 'codex' : first.sessionId || first.message ? 'claude-code' : 'unknown';
  const sub = basename(file).startsWith('agent-');
  const session = meta?.id ?? first.sessionId ?? basename(file, '.jsonl');
  let parent = '';
  if (sub) {
    // Claude Code files a subagent under <session>/subagents/; the parent is <session>.jsonl next to that folder.
    const sessDir = dirname(dirname(file));
    parent = `${sessDir}.jsonl`;
  }
  const all = ls.flatMap((l) => entries(l.o));
  const times = ls.map((l) => l.o.timestamp).filter(Boolean).sort();
  const ask = all.find(isHumanAsk)?.text ?? '';
  const metaFile = file.replace(/\.jsonl$/, '.meta.json');
  const desc = sub && existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')).description ?? '' : '';
  const compacted = ls.some((l) => l.o.subtype === 'compact_boundary' || /Conversation compacted/.test(l.o.content ?? ''));
  return {
    file,
    harness,
    session,
    agent: sub ? basename(file, '.jsonl') : '',
    parent: sub ? (existsSync(parent) ? basename(parent, '.jsonl') : `MISSING ${basename(parent, '.jsonl')}`) : '',
    cwd: first.cwd ?? meta?.cwd ?? '',
    first: times[0] ?? '',
    last: times.at(-1) ?? '',
    lines: ls.length,
    compacted,
    ask: (desc ? `[${desc}] ` : '') + ask.replace(/\s+/g, ' ').slice(0, 140),
  };
}

const roots = () => (rest.length ? rest : defaultRoots());

if (cmd === 'index') {
  const rows = jsonlFiles(roots()).map(describe).sort((a, b) => a.first.localeCompare(b.first));
  for (const r of rows)
    console.log(
      [r.first, r.last, r.harness, r.session, r.agent && `sub:${r.agent} parent:${r.parent}`, r.compacted && 'COMPACTED', r.cwd, `"${r.ask}"`]
        .filter(Boolean)
        .join(' | '),
    );
  console.log(`${rows.length} files`);
} else if (cmd === 'show') {
  const file = rest[0];
  let prev = '';
  let repeat = 0;
  const flush = () => {
    if (repeat) console.log(`   … same line ${repeat} more time(s)`);
    repeat = 0;
  };
  for (const { n, o } of lines(file))
    for (const e of entries(o)) {
      if (talk && !['user', 'assistant', 'system'].includes(e.kind)) continue;
      const body = e.kind === 'tool-result' || e.kind === 'tool-call' || e.kind === 'thinking' ? cut(e.text) : e.text;
      const key = `${e.kind}:${body.replace(/\d+/g, '#')}`;
      if (key === prev) {
        repeat++;
        continue;
      }
      flush();
      prev = key;
      console.log(`L${n} ${e.ts} [${e.kind}] ${body}`);
    }
  flush();
} else if (cmd === 'grep') {
  const re = new RegExp(rest.shift(), 'i');
  for (const f of jsonlFiles(roots()))
    for (const { n, o } of lines(f))
      for (const e of entries(o))
        if (e.kind !== 'tool-result' && re.test(e.text)) console.log(`${f}:L${n} ${e.ts} [${e.kind}] ${cut(e.text)}`);
} else if (cmd === 'orphans') {
  const rows = jsonlFiles(roots()).map(describe).filter((r) => r.parent.startsWith('MISSING'));
  for (const r of rows) console.log(`${r.agent} | session ${r.session} | since ${r.first} | ${r.file}`);
  console.log(`${rows.length} orphan thread(s)`);
} else {
  console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 11).join('\n'));
  process.exit(cmd ? 2 : 0);
}
