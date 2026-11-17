// Run: node --test ".claude/hooks/test/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const hook = join(import.meta.dirname, '..', 'config-stamp.mjs');

function project({ withGit }) {
  const dir = mkdtempSync(join(tmpdir(), 'stamp-'));
  writeFileSync(join(dir, 'AGENTS.md'), '# rules\n');
  writeFileSync(join(dir, 'KEEP.md'), '- a finding\n');
  if (withGit) {
    const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
    g('init', '-q');
    g('add', '.');
    g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  }
  return dir;
}
const run = (dir, input) =>
  spawnSync(process.execPath, [hook], { cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, input: JSON.stringify(input), encoding: 'utf8' });
const lines = (dir) => (existsSync(join(dir, 'runs.jsonl')) ? readFileSync(join(dir, 'runs.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);

test('SessionStart appends one line with session, HEAD and the config hash, and prints nothing', () => {
  const dir = project({ withGit: true });
  const r = run(dir, { hook_event_name: 'SessionStart', session_id: 's-1', source: 'startup' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  const [row] = lines(dir);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  const want = createHash('sha256').update('# rules\n- a finding\n').digest('hex');
  assert.equal(row.session, 's-1');
  assert.equal(row.source, 'startup');
  assert.equal(row.harness, 'claude-code');
  assert.equal(row.head, head);
  assert.equal(row.dirty, false, 'runs.jsonl itself does not count as a change');
  assert.equal(row.config, want);
  assert.ok(!Number.isNaN(Date.parse(row.at)));
  rmSync(dir, { recursive: true, force: true });
});

test('a second session appends, and an edit to KEEP.md changes the hash and marks the tree dirty', () => {
  const dir = project({ withGit: true });
  run(dir, { hook_event_name: 'SessionStart', session_id: 'a' });
  writeFileSync(join(dir, 'KEEP.md'), '- a finding\n- another\n');
  run(dir, { hook_event_name: 'SessionStart', session_id: 'b' });
  const [a, b] = lines(dir);
  assert.equal(lines(dir).length, 2);
  assert.notEqual(a.config, b.config);
  assert.equal(b.dirty, true);
  rmSync(dir, { recursive: true, force: true });
});

test('outside git it still writes a line, with head null, and exits 0', () => {
  const dir = project({ withGit: false });
  const r = run(dir, { hook_event_name: 'SessionStart', session_id: 'x' });
  assert.equal(r.status, 0);
  const [row] = lines(dir);
  assert.equal(row.head, null);
  assert.equal(row.dirty, null);
  rmSync(dir, { recursive: true, force: true });
});

test('another event writes nothing; --print writes nothing', () => {
  const dir = project({ withGit: true });
  run(dir, { hook_event_name: 'PostToolUse', session_id: 'x' });
  const p = spawnSync(process.execPath, [hook, '--print'], { cwd: dir, env: { ...process.env, CLAUDE_PROJECT_DIR: dir }, encoding: 'utf8' });
  assert.equal(JSON.parse(p.stdout).config.length, 64);
  assert.equal(lines(dir).length, 0);
  rmSync(dir, { recursive: true, force: true });
});
