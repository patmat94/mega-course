// recheck-sources.mjs, run as the Stop hook runs it: a temp project with one lesson whose receipts.json
// watches pages on a local server, and the hook started twice (first stop remembers, second compares).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK = fileURLToPath(new URL('../recheck-sources.mjs', import.meta.url));

// Every answer differs, as a sign-in page with a fresh token does.
let n = 0;
const server = createServer((req, res) => {
  n++;
  if (req.url.startsWith('/challenges/locked')) {
    res.writeHead(302, { location: `/login?next=${encodeURIComponent(req.url)}` });
    return res.end();
  }
  if (req.url.startsWith('/login')) {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(`<p>Sign in</p><input name="csrf" value="${n}">`);
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<p>open page, version ${n}</p>`);
});

const runHook = (project) =>
  new Promise((ok, fail) => {
    const child = execFile(process.execPath, [HOOK], { env: { ...process.env, CLAUDE_PROJECT_DIR: project } }, (err, stdout) =>
      err ? fail(err) : ok(JSON.parse(stdout)),
    );
    child.stdin.end(JSON.stringify({ session_id: 't1' }));
  });

function project(watch) {
  const dir = mkdtempSync(join(tmpdir(), 'recheck-'));
  mkdirSync(join(dir, 'mega-s99e01'));
  writeFileSync(join(dir, 'mega-s99e01', 'log.txt'), 'x\n');
  writeFileSync(join(dir, 'mega-s99e01', 'receipts.json'), JSON.stringify({ watch }));
  return dir;
}

test('recheck-sources', async (t) => {
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => server.close());

  await t.test('a page that redirects to /login never blocks and is not remembered', async () => {
    const dir = project([`${base}/challenges/locked`]);
    try {
      assert.deepEqual(await runHook(dir), {});
      assert.deepEqual(await runHook(dir), {});
      const state = JSON.parse(readFileSync(join(dir, '.claude', 'state', 'recheck-mega-s99e01.json'), 'utf8'));
      assert.deepEqual(state.sources, {});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('an open page that changed still blocks', async () => {
    const dir = project([`${base}/challenges/open`]);
    try {
      assert.deepEqual(await runHook(dir), {});
      const second = await runHook(dir);
      assert.equal(second.decision, 'block');
      assert.match(second.reason, /127\.0\.0\.1:\d+\/challenges\/open\/…: new page \w+; gone page \w+/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
