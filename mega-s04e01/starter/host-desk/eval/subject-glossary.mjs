#!/usr/bin/env node
// Eval subject for evalk.mjs (pass-k-eval): takes one case {question} as JSON on stdin, asks a small model
// that knows only the Host Desk's house notes (why/*.md, glossary included), and prints the
// last number of its answer, or "unparsed: <answer>".
// The model gets no tools, no hooks, no MCP servers and no CLAUDE.md (it runs from the temp folder), so the
// answer can only come from the notes. Model: HOST_DESK_EVAL_MODEL, default haiku.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// HOST_DESK_WHY points at another copy of the notes (to check that a changed definition fails).
const why = process.env.HOST_DESK_WHY || resolve(dirname(fileURLToPath(import.meta.url)), '..', 'why');
const notes = readdirSync(why)
  // HOST_DESK_ONLY=glossary.md gives the model that file alone, so a changed definition cannot hide behind
  // a why-note that still says the old meaning (the full folder passed with a watered-down glossary).
  .filter((f) => f.endsWith('.md') && (!process.env.HOST_DESK_ONLY || f === process.env.HOST_DESK_ONLY))
  .sort()
  .map((f) => `--- why/${f}\n${readFileSync(join(why, f), 'utf8')}`)
  .join('\n');

const c = JSON.parse(readFileSync(0, 'utf8'));
const system =
  'You answer questions about the Host Desk, a holiday-rental payout desk. Use only its house notes below; ' +
  'they override any general habit. Answer with one number only, no words, no units.\n\n' + notes;

const r = spawnSync(
  'claude',
  ['-p', c.question, '--model', process.env.HOST_DESK_EVAL_MODEL || 'haiku', '--system-prompt', system, '--tools', '',
    '--settings', '{"disableAllHooks":true}', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'text'],
  { cwd: tmpdir(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
);
const out = (r.stdout ?? '').trim();
// The last number: a model that shows its working ("6 - 3 = 3") ends on its answer. Taking the first
// number read that as 6 once in three glossary-only runs (eval/runs/cases-glossary-only-2026-11-18.json).
const n = out.match(/-?\d+(?:[.,]\d+)?/g);
console.log(n ? n.at(-1) : `unparsed: ${out.slice(0, 120) || (r.stderr ?? '').trim().slice(0, 120)}`);
