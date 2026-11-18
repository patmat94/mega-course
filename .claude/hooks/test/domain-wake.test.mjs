// Run: node --test ".claude/hooks/test/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { globToRegExp, relPath, buildPrompt } from '../domain-wake.mjs';

const hook = join(import.meta.dirname, '..', 'domain-wake.mjs');

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'dwake-'));
  mkdirSync(join(dir, 'agents', 'wake'), { recursive: true });
  writeFileSync(join(dir, 'agents', 'wake', 'domain.json'), JSON.stringify({ name: 'wake', agent: 'wake-domain', model: 'haiku', globs: ['lib/wake/**'] }));
  return dir;
}
const run = (dir, input, env = {}) =>
  spawnSync(process.execPath, [hook], {
    cwd: dir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir, DOMAIN_WAKE_FAKE: '- trap one · source: x', DOMAIN_WAKE_CHILD: '', ...env },
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
const ctx = (r) => JSON.parse(r.stdout).hookSpecificOutput?.additionalContext;

test('globs: ** spans folders, * stays in one', () => {
  assert.ok(globToRegExp('lib/wake/**').test('lib/wake/verify.ts'));
  assert.ok(globToRegExp('lib/wake/**').test('lib/wake/demo/src/index.ts'));
  assert.ok(!globToRegExp('lib/wake/**').test('lib/wakeup/x.ts'));
  assert.ok(globToRegExp('lib/*/x.ts').test('lib/wake/x.ts'));
  assert.ok(!globToRegExp('lib/*/x.ts').test('lib/a/b/x.ts'));
});

test('relPath: absolute Windows-style path inside the project, outside gives null', () => {
  const dir = project();
  assert.equal(relPath(dir, join(dir, 'lib', 'wake', 'log.ts')), 'lib/wake/log.ts');
  assert.equal(relPath(dir, join(dir, '..', 'elsewhere.ts')), null);
});

test('a Read under lib/wake wakes the agent once per session; the second Read is quiet', () => {
  const dir = project();
  const input = { session_id: 's1', tool_name: 'Read', tool_input: { file_path: join(dir, 'lib', 'wake', 'ingress.ts') } };
  const first = run(dir, input);
  assert.equal(first.status, 0);
  assert.match(ctx(first), /wake-domain .*woke for Read on lib\/wake\/ingress\.ts:\n- trap one/);
  assert.equal(JSON.parse(first.stdout).hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(run(dir, { ...input, tool_input: { file_path: join(dir, 'lib', 'wake', 'log.ts') } }).stdout, '{}');
});

test('an Edit wakes it again, once per file, even after a Read', () => {
  const dir = project();
  const f = join(dir, 'lib', 'wake', 'ingress.ts');
  run(dir, { session_id: 's2', tool_name: 'Read', tool_input: { file_path: f } });
  const edit = { session_id: 's2', tool_name: 'Edit', tool_input: { file_path: f, old_string: 'a', new_string: 'b' } };
  assert.match(ctx(run(dir, edit)), /woke for Edit on lib\/wake\/ingress\.ts/);
  assert.equal(run(dir, edit).stdout, '{}');
  assert.match(ctx(run(dir, { ...edit, tool_input: { ...edit.tool_input, file_path: join(dir, 'lib', 'wake', 'log.ts') } })), /log\.ts/);
});

test('files outside every domain, other tools and the agent\'s own run stay quiet', () => {
  const dir = project();
  assert.equal(run(dir, { session_id: 's3', tool_name: 'Read', tool_input: { file_path: join(dir, 'README.md') } }).stdout, '{}');
  assert.equal(run(dir, { session_id: 's3', tool_name: 'Bash', tool_input: { command: 'cat lib/wake/x' } }).stdout, '{}');
  assert.equal(run(dir, { session_id: 's3', tool_name: 'Read', tool_input: { file_path: join(dir, 'lib', 'wake', 'x.ts') } }, { DOMAIN_WAKE_CHILD: '1' }).stdout, '{}');
});

test('when the agent cannot run, Main is told to read the memories, and the tool is never blocked', () => {
  const dir = project();
  const r = spawnSync(process.execPath, [hook], {
    cwd: dir,
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DOMAIN_WAKE'))), CLAUDE_PROJECT_DIR: dir, DOMAIN_WAKE_CLAUDE: join(dir, 'no-such-claude') },
    input: JSON.stringify({ session_id: 's5', tool_name: 'Read', tool_input: { file_path: join(dir, 'lib', 'wake', 'x.ts') } }),
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.permissionDecision, undefined);
  assert.match(out.additionalContext, /could not run .*Read agents\/wake\/memories\.md before you change lib\/wake\/x\.ts/s);
});

test('the prompt carries the edit text, cut at 2000 characters', () => {
  const p = buildPrompt({ name: 'wake' }, 'Edit', 'lib/wake/ingress.ts', { old_string: 'x'.repeat(3000), new_string: 'await kv.put(seen)' });
  assert.match(p, /Main is about to run Edit on lib\/wake\/ingress\.ts/);
  assert.match(p, /…\(cut\)/);
  assert.match(p, /await kv\.put\(seen\)/);
  assert.match(p, /Read agents\/wake\/memories\.md/);
});
