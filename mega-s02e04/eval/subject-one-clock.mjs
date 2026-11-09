#!/usr/bin/env node
// Eval subject for evalk.mjs: takes one case {time, clock, into?} as JSON on stdin, runs crew's
// one-clock.mjs on it (as a piped list line, never on a command line) and prints one normalised answer:
//   one UTC time         2026-11-01T02:50:00Z
//   a time seen twice    <first>Z or <second>Z
//   a skipped time       none
//   any other refusal    refused
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const oneClock = process.env.ONE_CLOCK ?? resolve(here, '../../.claude/skills/crew/skills/join-results/one-clock.mjs');

const c = JSON.parse(readFileSync(0, 'utf8'));
const line = ['case', c.time, c.clock, c.into].filter((f) => f !== undefined && f !== '').join(' | ');
const r = spawnSync(process.execPath, [oneClock], { input: `${line}\n`, encoding: 'utf8' });
const first = (r.stdout ?? '').split(/\r?\n/)[0] ?? '';

if (/error: .*no such time/.test(first)) console.log('none');
else if (/error: /.test(first) || r.status === 2) console.log('refused');
else {
  const after = first.slice(first.indexOf('->') + 2);
  const times = after.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g) ?? [];
  console.log(times.length ? times.join(' or ') : `unparsed: ${first}`);
}
