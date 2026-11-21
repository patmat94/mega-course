// run-suites.mjs · called by .githooks/post-commit and .githooks/post-merge. Runs each test suite whose folder the
// commit (or merge) touched, and says so out loud when a suite could not run. It never blocks: the commit is already made.
//
//   node .githooks/run-suites.mjs commit          files of HEAD (post-commit)
//   node .githooks/run-suites.mjs merge           files between ORIG_HEAD and HEAD (post-merge)
//   node .githooks/run-suites.mjs all             every suite, touched or not (by hand)
//
// One line per run goes to .git/suite-runs.jsonl, so a later session can see what ran and what could not.
// Sealed Cases (agents/judge) run too when `git config hooks.judge true`: they start a model on your key, so they are off by default.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, globSync } from 'node:fs';
import { join } from 'node:path';

export const SUITES = [
  { name: 'wake', folders: ['lib/wake/'], tests: 'lib/wake/test/*.test.ts' },
  { name: 'hooks', folders: ['.claude/hooks/'], tests: '.claude/hooks/test/*.test.mjs' },
  {
    name: 'reviewer',
    folders: ['mega-s04e01/starter/host-desk/roles/reviewer/'],
    tests: 'mega-s04e01/starter/host-desk/roles/reviewer/test/*.test.mjs',
  },
  { name: 'heartbeat', folders: ['agents/heartbeat/'], tests: 'agents/heartbeat/test/*.test.mjs' },
];
// The sealed reviewer Cases: what touches the reviewer's behaviour (its role, the house notes it reads, the judge itself).
const JUDGE = {
  name: 'judge:reviewer',
  folders: ['mega-s04e01/starter/host-desk/roles/reviewer/', 'mega-s04e01/starter/host-desk/why/', 'agents/judge/'],
};
const TIMEOUT_MS = 180_000;
// Git hands a hook GIT_DIR, GIT_INDEX_FILE and more. A suite that runs git in a temp folder (config-stamp.test.mjs
// does git init + commit) would then write into THIS repo: on 2026-11-21 it set core.bare = true and committed an
// orphan "init" onto a test worktree's HEAD. Every child gets the environment without them.
export const cleanEnv = (env = process.env) => Object.fromEntries(Object.entries(env).filter(([k]) => !/^GIT_/i.test(k)));
const logPath = () => git('rev-parse', '--git-path', 'suite-runs.jsonl').stdout.trim() || join('.git', 'suite-runs.jsonl');

const git = (...args) => spawnSync('git', args, { encoding: 'utf8', windowsHide: true });

/** The files this commit or merge touched, or null when git cannot say. */
export function touchedFiles(mode) {
  if (mode === 'all') return null;
  const r =
    mode === 'merge'
      ? git('diff', '--name-only', 'ORIG_HEAD', 'HEAD')
      : git('diff-tree', '--no-commit-id', '--name-only', '-r', '--root', 'HEAD');
  if (r.status !== 0) return undefined;
  return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
}

export const touches = (files, folders) => files === null || files.some((f) => folders.some((d) => f.startsWith(d)));

function loud(lines) {
  const bar = '!'.repeat(72);
  console.error(['', bar, ...lines.map((l) => `!! ${l}`), bar, ''].join('\n'));
}

function runSuite(s) {
  const found = globSync(s.tests);
  if (found.length === 0) return { name: s.name, state: 'could-not-run', why: `no test files match ${s.tests}` };
  const r = spawnSync(process.execPath, ['--test', s.tests], { encoding: 'utf8', timeout: TIMEOUT_MS, windowsHide: true, env: cleanEnv() });
  if (r.error) return { name: s.name, state: 'could-not-run', why: r.error.code === 'ETIMEDOUT' ? `timed out after ${TIMEOUT_MS / 1000} s` : r.error.message };
  const count = (k) => Number((r.stdout.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) ?? [])[1] ?? NaN);
  const tests = count('tests');
  const fail = count('fail');
  if (Number.isNaN(tests)) return { name: s.name, state: 'could-not-run', why: `node --test printed no summary (exit ${r.status})`, out: (r.stdout + r.stderr).slice(-1500) };
  if (r.status !== 0 || fail > 0) return { name: s.name, state: 'fail', why: `${fail} of ${tests} failed`, out: r.stdout.slice(-2500) };
  return { name: s.name, state: 'pass', why: `${tests} tests` };
}

function runJudge() {
  const script = 'agents/judge/judge-reviewer.mjs';
  if (!existsSync(script)) return { name: JUDGE.name, state: 'could-not-run', why: `${script} missing` };
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 15 * 60_000, windowsHide: true, env: cleanEnv() });
  if (r.error) return { name: JUDGE.name, state: 'could-not-run', why: r.error.message };
  const out = r.stdout.trim();
  if (r.status === 0) return { name: JUDGE.name, state: 'pass', why: out.split('\n').length + ' cases', out };
  if (r.status === 1) return { name: JUDGE.name, state: 'fail', why: 'a sealed case failed', out };
  return { name: JUDGE.name, state: 'could-not-run', why: `judge exit ${r.status}`, out: (out + '\n' + r.stderr).trim().slice(-1500) };
}

function main() {
  const mode = process.argv[2] ?? 'commit';
  const files = touchedFiles(mode);
  const head = git('rev-parse', '--short', 'HEAD').stdout.trim();
  if (files === undefined) {
    loud([`post-${mode}: git could not list the touched files, so NO suite ran for ${head}.`, 'Run them by hand: node .githooks/run-suites.mjs all']);
    appendFileSync(logPath(), JSON.stringify({ at: new Date().toISOString(), head, mode, results: [{ name: '*', state: 'could-not-run', why: 'no file list' }] }) + '\n');
    return;
  }
  const due = SUITES.filter((s) => touches(files, s.folders));
  const judgeOn = git('config', '--bool', 'hooks.judge').stdout.trim() === 'true';
  const judgeTouched = touches(files, JUDGE.folders);
  if (due.length === 0 && !judgeTouched) return;

  const results = due.map((s) => {
    process.stdout.write(`suites: ${s.name} … `);
    const res = runSuite(s);
    console.log(`${res.state} (${res.why})`);
    return res;
  });
  if (judgeTouched && judgeOn) {
    process.stdout.write(`suites: ${JUDGE.name} (sealed cases, starts a model) … `);
    const res = runJudge();
    console.log(`${res.state} (${res.why})`);
    if (res.out) console.log(res.out);
    results.push(res);
  } else if (judgeTouched) {
    results.push({ name: JUDGE.name, state: 'skipped', why: 'hooks.judge is off' });
    console.log(`suites: ${JUDGE.name} skipped: the reviewer is in scope, but sealed cases are off (git config hooks.judge true to run them, or node agents/judge/judge-reviewer.mjs)`);
  }

  for (const r of results.filter((x) => x.state === 'fail' && x.out)) console.error(`\n--- ${r.name} ---\n${r.out}`);
  const bad = results.filter((r) => r.state === 'fail' || r.state === 'could-not-run');
  if (bad.length) {
    loud([
      `post-${mode} on ${head}: ${bad.length} suite(s) did not pass. The commit is made; it is NOT verified.`,
      ...bad.map((r) => `${r.state === 'could-not-run' ? 'COULD NOT RUN' : 'FAILED'}: ${r.name}: ${r.why}`),
    ]);
  }
  appendFileSync(
    logPath(),
    JSON.stringify({ at: new Date().toISOString(), head, mode, results: results.map(({ name, state, why }) => ({ name, state, why })) }) + '\n',
  );
}

if (process.argv[1]?.endsWith('run-suites.mjs')) {
  try {
    main();
  } catch (e) {
    loud([`the suite runner itself crashed, so NO suite ran: ${e?.message ?? e}`, 'Run them by hand: node .githooks/run-suites.mjs all']);
  }
}
