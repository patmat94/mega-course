import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../watch.mjs';

const here = join(import.meta.dirname, '..');
const row = (worker, at, ok, why = '') => JSON.stringify({ at, worker, url: `https://${worker}.example/`, status: ok ? 200 : 503, ms: 100, ok, why });
const NOW = new Date('2026-11-19T09:00:00Z');

function folder(lines) {
  const dir = mkdtempSync(join(tmpdir(), 'watch-'));
  cpSync(join(here, 'hooks.json'), join(dir, 'hooks.json'));
  writeFileSync(join(dir, 'heartbeat.jsonl'), lines.join('\n') + '\n');
  return dir;
}
const tasks = (dir) => (existsSync(join(dir, 'tasks.jsonl')) ? readFileSync(join(dir, 'tasks.jsonl'), 'utf8').trim().split('\n').map(JSON.parse) : []);

test('up rows open no task', () => {
  const dir = folder([row('a', '2026-11-19T08:00:00Z', true), row('b', '2026-11-19T08:00:01Z', true)]);
  assert.equal(run(dir, { apply: true, now: NOW }).tasks.length, 0);
  assert.deepEqual(tasks(dir), []);
});

test('report only writes nothing', () => {
  const dir = folder([row('a', '2026-11-19T08:00:00Z', false, 'status 503, want 200')]);
  const r = run(dir, { now: NOW });
  assert.equal(r.tasks.length, 1);
  assert.equal(existsSync(join(dir, 'tasks.jsonl')), false);
  assert.equal(existsSync(join(dir, 'watch-state.json')), false);
});

test('two down rows for one Worker on one day open one task; the hook fires once', () => {
  const dir = folder([row('a', '2026-11-19T08:00:00Z', false, 'status 503'), row('a', '2026-11-19T20:00:00Z', false, 'fetch failed')]);
  const r = run(dir, { apply: true, now: NOW });
  assert.equal(r.tasks.length, 1);
  assert.deepEqual(r.skipped.map((s) => s.line), [2]);
  const [t] = tasks(dir);
  assert.equal(t.id, 'worker-down-task:a:2026-11-19');
  assert.equal(t.owner, 'human');
  assert.equal(t.source, 'heartbeat.jsonl:1');
});

test('the same down row read again (a second run) fires no second time', () => {
  const dir = folder([row('a', '2026-11-19T08:00:00Z', false)]);
  run(dir, { apply: true, now: NOW });
  writeFileSync(join(dir, 'watch-state.json'), JSON.stringify({ read: 0 })); // a lost bookmark: the row is read again
  const again = run(dir, { apply: true, now: NOW });
  assert.equal(again.tasks.length, 0);
  assert.equal(again.skipped.length, 1);
  assert.equal(tasks(dir).length, 1);
});

test('a new day or another Worker is a new task', () => {
  const dir = folder([row('a', '2026-11-19T08:00:00Z', false), row('a', '2026-11-20T08:00:00Z', false), row('b', '2026-11-19T08:00:00Z', false)]);
  run(dir, { apply: true, now: NOW });
  assert.deepEqual(tasks(dir).map((t) => t.id), ['worker-down-task:a:2026-11-19', 'worker-down-task:a:2026-11-20', 'worker-down-task:b:2026-11-19']);
});

test('the bookmark skips rows already read', () => {
  const dir = folder([row('a', '2026-11-19T08:00:00Z', true)]);
  run(dir, { apply: true, now: NOW });
  writeFileSync(join(dir, 'heartbeat.jsonl'), readFileSync(join(dir, 'heartbeat.jsonl'), 'utf8') + row('c', '2026-11-19T09:00:00Z', false) + '\n');
  const r = run(dir, { apply: true, now: NOW });
  assert.equal(r.read, 1);
  assert.equal(r.from, 2);
  assert.equal(r.tasks[0].worker, 'c');
});

test('an expired hook does not fire', () => {
  const dir = folder([row('a', '2027-03-01T08:00:00Z', false)]);
  assert.equal(run(dir, { apply: true, now: new Date('2027-03-01T09:00:00Z') }).tasks.length, 0);
});
