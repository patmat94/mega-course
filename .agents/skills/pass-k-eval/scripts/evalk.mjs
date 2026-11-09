#!/usr/bin/env node
// evalk.mjs: runs a small eval k times and reports pass@1, pass@k and pass^k.
// Plain Node 18+, no packages. It runs only the subject command you give it, once per case per run,
// with the case as JSON on stdin; the subject prints its answer on stdout. It writes one results file.
//
//   node evalk.mjs --cases cases.jsonl [--k 3] [--out runs/x.json] [--timeout 300] [--shell] -- <subject command...>
//
// cases.jsonl: one JSON object per line. Fields the runner reads:
//   id        unique name of the case
//   expected  the accepted answer: a string, or an array of strings (any one passes)
//   match     "exact" (default; whitespace collapsed, case kept) or "contains"
// Every other field is for the subject (it receives the whole object). Lines that are empty or start
// with // are skipped.
//
// pass@1  share of all (case, run) attempts that passed
// pass@k  share of cases that passed in at least one of the k runs
// pass^k  share of cases that passed in every one of the k runs (the reliability number)
//
// Exit codes: 0 pass^k is 100%, 1 some case failed a run, 2 usage or file error.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';

const USAGE = `evalk: node evalk.mjs --cases cases.jsonl [--k 3] [--out file.json] [--timeout 300] [--shell] -- <subject command...>`;

function parseArgs(argv) {
  const sep = argv.indexOf('--');
  if (sep < 0 || sep === argv.length - 1) throw new Error('no subject command after --');
  const opts = { k: 3, timeout: 300, shell: false };
  const own = argv.slice(0, sep);
  for (let i = 0; i < own.length; i++) {
    const a = own[i];
    if (a === '--cases') opts.cases = own[++i];
    else if (a === '--k') opts.k = Number(own[++i]);
    else if (a === '--out') opts.out = own[++i];
    else if (a === '--timeout') opts.timeout = Number(own[++i]);
    else if (a === '--shell') opts.shell = true;
    else throw new Error(`unknown option ${a}`);
  }
  if (!opts.cases) throw new Error('--cases is required');
  if (!Number.isInteger(opts.k) || opts.k < 1) throw new Error('--k must be a whole number of 1 or more');
  opts.cmd = argv.slice(sep + 1);
  return opts;
}

function readCases(file) {
  const cases = [];
  readFileSync(file, 'utf8').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('//')) return;
    let c;
    try {
      c = JSON.parse(line);
    } catch {
      throw new Error(`${file}:${i + 1} is not JSON`);
    }
    if (!c.id) throw new Error(`${file}:${i + 1} has no id`);
    if (c.expected === undefined) throw new Error(`${file}:${i + 1} (${c.id}) has no expected`);
    cases.push(c);
  });
  const ids = new Set();
  for (const c of cases) {
    if (ids.has(c.id)) throw new Error(`id ${c.id} appears twice`);
    ids.add(c.id);
  }
  if (!cases.length) throw new Error(`${file} holds no cases`);
  return cases;
}

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

function passes(c, answer) {
  const accepted = Array.isArray(c.expected) ? c.expected : [c.expected];
  const a = norm(answer);
  return accepted.some((e) => (c.match === 'contains' ? a.includes(norm(e)) : a === norm(e)));
}

function runOnce(opts, c) {
  // `node` runs as this very Node, so it works the same in PowerShell, cmd and bash.
  const [head, ...rest] = opts.cmd;
  const exe = head === 'node' ? process.execPath : head;
  const started = Date.now();
  const r = spawnSync(exe, rest, {
    input: JSON.stringify(c),
    encoding: 'utf8',
    timeout: opts.timeout * 1000,
    shell: opts.shell,
    maxBuffer: 16 * 1024 * 1024,
  });
  const ms = Date.now() - started;
  if (r.error) return { answer: '', ok: false, ms, error: r.error.code === 'ETIMEDOUT' ? `timed out after ${opts.timeout}s` : r.error.message };
  const answer = (r.stdout ?? '').trim();
  const out = { answer, ok: passes(c, answer), ms, exit: r.status };
  if (r.stderr?.trim()) out.stderr = r.stderr.trim().slice(0, 2000);
  return out;
}

const pct = (n, d) => `${((100 * n) / d).toFixed(0)}%`;

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cases = readCases(opts.cases);
  const runs = [];
  for (let k = 1; k <= opts.k; k++) {
    const results = {};
    for (const c of cases) results[c.id] = runOnce(opts, c);
    runs.push(results);
  }

  const width = Math.max(...cases.map((c) => c.id.length));
  console.log(`evalk: ${cases.length} cases x ${opts.k} runs, subject: ${opts.cmd.join(' ')}`);
  let attemptsOk = 0;
  let anyOk = 0;
  let allOk = 0;
  const perCase = [];
  for (const c of cases) {
    const marks = runs.map((r) => r[c.id].ok);
    const okCount = marks.filter(Boolean).length;
    attemptsOk += okCount;
    if (okCount > 0) anyOk++;
    if (okCount === opts.k) allOk++;
    const answers = [...new Set(runs.map((r) => r[c.id].answer))];
    perCase.push({ id: c.id, passes: okCount, of: opts.k, answers, expected: c.expected });
    const line = `${c.id.padEnd(width)}  ${marks.map((m) => (m ? 'P' : 'F')).join('')}  ${answers.map((a) => JSON.stringify(a)).join(' | ')}`;
    console.log(okCount === opts.k ? line : `${line}   expected ${JSON.stringify(c.expected)}`);
  }
  const summary = {
    cases: cases.length,
    k: opts.k,
    pass_at_1: attemptsOk / (cases.length * opts.k),
    pass_at_k: anyOk / cases.length,
    pass_pow_k: allOk / cases.length,
  };
  console.log(
    `pass@1 ${pct(attemptsOk, cases.length * opts.k)} · pass@${opts.k} ${pct(anyOk, cases.length)} · pass^${opts.k} ${pct(allOk, cases.length)} (${allOk}/${cases.length} cases passed every run)`,
  );

  const out = resolve(opts.out ?? `${dirname(opts.cases)}/runs/${basename(opts.cases).replace(/\.\w+$/, '')}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ when: new Date().toISOString(), node: process.version, subject: opts.cmd, casesFile: opts.cases, summary, perCase, runs }, null, 2)}\n`);
  console.log(`results: ${out}`);
  process.exitCode = allOk === cases.length ? 0 : 1;
}

try {
  main();
} catch (e) {
  console.log(`evalk stopped: ${e.message}\n${USAGE}`);
  process.exitCode = 2;
}
