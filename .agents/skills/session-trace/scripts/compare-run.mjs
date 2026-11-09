#!/usr/bin/env node
// compare-run.mjs: reads Claude Code session transcripts (and, optionally, the JSON that `claude -p
// --output-format json` printed) and prints their tool calls, turns, tokens, time and cost side by side,
// so a replayed step can be compared with the original. Plain Node 18+, no packages, reads only.
//
//   node compare-run.mjs <run> [<run> ...]
//   <run> = label=<session id | transcript.jsonl path>[,<claude -p output.json>]
//
//   node compare-run.mjs original=25e684bf-4ff5-4335-a4d0-5ef6789c396b,job1-worker.json replay=<id>,replay.json
//
// A session id is looked up under ~/.claude/projects/*/<id>.jsonl. Cost comes only from the -p JSON
// (total_cost_usd); a transcript holds tokens, not prices, so without the JSON cost prints as "-".
// Exit codes: 0 printed, 2 a run could not be read.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function findTranscript(ref) {
  if (ref.endsWith('.jsonl')) return ref;
  const root = join(homedir(), '.claude', 'projects');
  for (const dir of readdirSync(root)) {
    const p = join(root, dir, `${ref}.jsonl`);
    if (existsSync(p)) return p;
  }
  throw new Error(`no transcript for session ${ref} under ${root}`);
}

function readRun(spec) {
  const eq = spec.indexOf('=');
  if (eq < 1) throw new Error(`"${spec}" is not label=<session>[,<json>]`);
  const label = spec.slice(0, eq);
  const [ref, jsonPath] = spec.slice(eq + 1).split(',');
  const path = findTranscript(ref);
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(Boolean);

  const usageById = new Map(); // one assistant message is written as several lines: keep its last usage
  const tools = [];
  const models = new Set();
  const times = [];
  for (const l of lines) {
    if (l.timestamp) times.push(Date.parse(l.timestamp));
    if (l.type !== 'assistant' || !l.message) continue;
    const m = l.message;
    if (m.model) models.add(m.model);
    if (m.id && m.usage) usageById.set(m.id, m.usage);
    for (const block of m.content ?? []) if (block.type === 'tool_use') tools.push(block.name);
  }
  const sum = (k) => [...usageById.values()].reduce((s, u) => s + (u[k] ?? 0), 0);
  const run = {
    label,
    transcript: path,
    model: [...models].join(', ') || '-',
    turns: usageById.size,
    tools,
    input: sum('input_tokens'),
    output: sum('output_tokens'),
    cacheRead: sum('cache_read_input_tokens'),
    cacheWrite: sum('cache_creation_input_tokens'),
    seconds: times.length > 1 ? (Math.max(...times) - Math.min(...times)) / 1000 : null,
    cost: null,
    apiSeconds: null,
    numTurns: null,
  };
  if (jsonPath) {
    const j = JSON.parse(readFileSync(jsonPath, 'utf8').replace(/^﻿/, ''));
    run.cost = j.total_cost_usd ?? null;
    run.apiSeconds = j.duration_api_ms != null ? j.duration_api_ms / 1000 : null;
    run.numTurns = j.num_turns ?? null;
  }
  return run;
}

function count(names) {
  const c = {};
  for (const n of names) c[n] = (c[n] ?? 0) + 1;
  return c;
}

function main() {
  const specs = process.argv.slice(2);
  if (!specs.length) throw new Error('usage: node compare-run.mjs label=<session id|transcript.jsonl>[,<claude -p output.json>] ...');
  const runs = specs.map(readRun);
  const allTools = [...new Set(runs.flatMap((r) => r.tools))];
  const rows = [
    ['model', (r) => r.model],
    ['cost USD (-p JSON)', (r) => (r.cost == null ? '-' : r.cost.toFixed(4))],
    ['assistant messages', (r) => r.turns],
    ['num_turns (-p JSON)', (r) => r.numTurns ?? '-'],
    ['tool calls, total', (r) => r.tools.length],
    ...allTools.map((t) => [`  ${t}`, (r) => count(r.tools)[t] ?? 0]),
    ['input tokens', (r) => r.input],
    ['output tokens', (r) => r.output],
    ['cache read tokens', (r) => r.cacheRead],
    ['cache write tokens', (r) => r.cacheWrite],
    ['wall seconds (transcript)', (r) => (r.seconds == null ? '-' : r.seconds.toFixed(1))],
    ['API seconds (-p JSON)', (r) => (r.apiSeconds == null ? '-' : r.apiSeconds.toFixed(1))],
  ];
  const head = ['', ...runs.map((r) => r.label)];
  const body = rows.map(([name, f]) => [name, ...runs.map((r) => String(f(r)))]);
  console.log(`| ${head.join(' | ')} |`);
  console.log(`|${head.map(() => '---').join('|')}|`);
  for (const row of body) console.log(`| ${row.join(' | ')} |`);
  console.log('');
  for (const r of runs) console.log(`${r.label}: tool order ${r.tools.join(' > ') || '(none)'}; transcript ${r.transcript}`);
}

try {
  main();
} catch (e) {
  console.log(`compare-run stopped: ${e.message}`);
  process.exitCode = 2;
}
