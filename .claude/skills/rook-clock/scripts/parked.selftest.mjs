// parked.selftest.mjs · the checks behind `node parked.mjs --self-test`. Your agent does not run this file.
// Offline: a temporary folder and one HTTP server on 127.0.0.1. Leaves no file behind.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as parked from './parked.mjs';

const { checkId, finish, list, park } = parked;
const KEY = `wk_FAKE_${'park777ZZ'}`;
const SCRIPT = fileURLToPath(new URL('./parked.mjs', import.meta.url));

export async function selfTest() {
  const seen = [];
  const srv = http.createServer((req, res) => {
    if (req.url.startsWith('/go')) {
      seen.push({ url: req.url, key: req.headers['x-key'] });
      res.writeHead(307, { location: 'http://127.0.0.1:9/x' });
      return res.end();
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ url: req.url, key: req.headers['x-key'], body });
      res.end(`ok ${req.headers['x-key']}`);
    });
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const A = `http://127.0.0.1:${srv.address().port}`;
  const hosts = { WEATHER_KEY: [A] };
  const vars = { WEATHER_KEY: KEY };
  const tmp = mkdtempSync(join(tmpdir(), 'clock-parked-'));
  const dir = join(tmp, 'work');
  const file = (name, source) => {
    const path = join(tmp, name);
    writeFileSync(path, source);
    return path;
  };
  const readParked = (id) => JSON.parse(readFileSync(join(dir, 'parked', `${id}.json`), 'utf8'));
  // Your human's decision, as the file holds it. The script itself records one only from a terminal.
  const decided = (id, decision, decidedAt = new Date().toISOString()) =>
    writeFileSync(join(dir, 'parked', `${id}.json`), JSON.stringify({ ...readParked(id), decision, decidedAt }));
  // The job's finish sends once, from the copy it kept. It runs in a process of its own.
  const job = file(
    'job.mjs',
    `export async function finish(copy, decision, ctx) {
       if (process.env.WEATHER_KEY !== undefined) throw new Error('the job holds the key');
       if (decision !== 'yes') return { skipped: true };
       const res = await ctx.send({ method: 'POST', url: '${A}/finish', headers: { 'x-key': '{{WEATHER_KEY}}' }, body: JSON.stringify(copy) });
       return { status: res.status, body: res.body };
     }\n`,
  );
  // A run that ended a minute ago, as run-job.mjs traces one: finish reads it.
  const line = (o) => `${JSON.stringify(o)}\n`;
  const ranAt = Date.now() - 60_000;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'trace.jsonl'), line({ at: new Date(ranAt).toISOString(), run: 'started', pid: 1 }) + line({ at: new Date(ranAt + 10).toISOString(), exit: 'done' }));
  try {
    // 1. Park keeps the item's own copy and its sha256; a second park leaves the first one as it was.
    assert.equal(park(dir, 'a1', 'over the limit', { id: 'a1', amount: 900 }), 'parked');
    const first = readParked('a1');
    assert.deepEqual([first.reason, first.copy.amount, first.decision], ['over the limit', 900, null]);
    assert.match(first.copySha, /^[0-9a-f]{64}$/);
    assert.equal(park(dir, 'a1', 'again', { id: 'a1', amount: 1 }), 'kept');
    assert.equal(readParked('a1').copy.amount, 900);
    assert.deepEqual(list(dir), [{ id: 'a1', reason: 'over the limit', decision: null, finished: null }]);
    // The command line is the only way to record a decision: the library does not export one.
    assert.equal(typeof parked.decide, 'undefined');

    // 2. No finish before your human decides.
    await assert.rejects(finish(dir, 'a1', job, { hosts, vars }), (e) => e.refused && /^not decided a1/.test(e.message));
    await assert.rejects(finish(dir, 'zz', job, { hosts, vars }), (e) => e.refused && /^not parked zz/.test(e.message));
    assert.equal(seen.length, 0);

    // 3. Decided yes: finish runs once and sends once. A second finish sends nothing.
    decided('a1', 'yes');
    const done = await finish(dir, 'a1', job, { hosts, vars });
    assert.equal(done.state, 'done', done.error);
    assert.deepEqual(done.result, { status: 200, body: 'ok {{WEATHER_KEY}}' });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].key, KEY);
    assert.deepEqual(JSON.parse(seen[0].body), { id: 'a1', amount: 900 });
    const record = readFileSync(join(dir, 'finished', 'a1.json'), 'utf8');
    assert.equal(JSON.parse(record).state, 'done');
    assert.ok(!record.includes(KEY));
    await assert.rejects(finish(dir, 'a1', job, { hosts, vars }), (e) => e.refused && e.message === 'already finished a1');
    assert.equal(seen.length, 1);
    assert.equal(park(dir, 'a1', 'once more', {}), 'finished');
    assert.deepEqual(list(dir)[0].finished, 'done');

    // 3b. Its file deleted: the ledger still knows, and nothing is sent again.
    unlinkSync(join(dir, 'finished', 'a1.json'));
    await assert.rejects(finish(dir, 'a1', job, { hosts, vars }), (e) => e.refused && e.message === 'finished/a1.json is missing: ask your human');
    assert.equal(seen.length, 1);
    assert.equal(list(dir)[0].finished, 'its file is missing');

    // 4. Two finishes at the same moment: one runs, the other is refused.
    park(dir, 'b2', 'needs a yes', { id: 'b2' });
    decided('b2', 'yes');
    const both = await Promise.allSettled([finish(dir, 'b2', job, { hosts, vars }), finish(dir, 'b2', job, { hosts, vars })]);
    assert.equal(both.filter((s) => s.status === 'fulfilled').length, 1);
    assert.equal(both.filter((s) => s.status === 'rejected' && s.reason.message === 'already finished b2').length, 1);
    assert.equal(seen.length, 2);

    // 5. A finish that fails half way is not run again: your human looks first.
    park(dir, 'c3', 'needs a yes', { id: 'c3' });
    decided('c3', 'yes');
    const broken = file('broken.mjs', `export async function finish() { throw new Error('${KEY} was rejected'); }\n`);
    const failed = await finish(dir, 'c3', broken, { hosts, vars });
    assert.deepEqual(failed, { state: 'failed', decision: 'yes', error: '{{WEATHER_KEY}} was rejected' });
    await assert.rejects(finish(dir, 'c3', job, { hosts, vars }), /already finished c3/);
    assert.ok(!readFileSync(join(dir, 'finished', 'c3.json'), 'utf8').includes(KEY));

    // 6. A no is passed to finish too; the job decides what a no does.
    park(dir, 'd4', 'needs a call', { id: 'd4' });
    decided('d4', 'no');
    assert.deepEqual((await finish(dir, 'd4', job, { hosts, vars })).result, { skipped: true });
    assert.equal(seen.length, 2);

    // 6b. A copy changed after the park is refused; a decision written before the park is refused.
    park(dir, 'g7', 'needs a yes', { id: 'g7', amount: 1 });
    writeFileSync(join(dir, 'parked', 'g7.json'), JSON.stringify({ ...readParked('g7'), decision: 'yes', copy: { id: 'g7', amount: 999 } }));
    await assert.rejects(finish(dir, 'g7', job, { hosts, vars }), (e) => e.refused && e.message === 'parked/g7.json was changed after it was parked: ask your human');
    writeFileSync(join(dir, 'parked', 'h8.json'), JSON.stringify({ id: 'h8', reason: 'x', copy: { id: 'h8' }, decision: 'yes' }));
    assert.throws(
      () => park(dir, 'h8', 'needs a yes', { id: 'h8' }),
      (e) => e.refused && e.message === 'parked/h8.json already holds a decision no human recorded in this run: ask your human; do not finish it',
    );
    // A decision with no decidedAt, or one from before the park, is not finished.
    park(dir, 'j1', 'needs a yes', { id: 'j1' });
    decided('j1', 'yes', null);
    await assert.rejects(finish(dir, 'j1', job, { hosts, vars }), (e) => e.refused && /no time your human recorded it after the park/.test(e.message));
    decided('j1', 'yes', '2000-01-01T00:00:00.000Z');
    await assert.rejects(finish(dir, 'j1', job, { hosts, vars }), (e) => e.refused && /do not finish it$/.test(e.message));
    assert.equal(seen.length, 2);
    // A file that holds another id (Pay1 and pay1 share one file on Windows and macOS) is refused.
    writeFileSync(join(dir, 'parked', 'k9.json'), JSON.stringify({ id: 'K9', reason: 'x', copy: {}, decision: null }));
    assert.throws(() => park(dir, 'k9', 'needs a yes', {}), /differ only in case/);

    // 6c. A finish that runs past its budget is stopped and recorded unfinished, and not run again.
    {
      park(dir, 'l2', 'needs a yes', { id: 'l2' });
      decided('l2', 'yes');
      const hangs = file('hangs.mjs', 'export async function finish() { await new Promise(() => {}); }\n');
      const t0 = Date.now();
      const out = await finish(dir, 'l2', hangs, { hosts, vars, budgetMs: 1500 });
      assert.ok(Date.now() - t0 < 10_000, 'the budget did not hold');
      assert.equal(out.state, 'unfinished');
      assert.match(out.error, /^the runner stopped it when its budget \(2s\) ran out; it may have sent part of its work$/);
      assert.equal(JSON.parse(readFileSync(join(dir, 'finished', 'l2.json'), 'utf8')).state, 'unfinished');
      await assert.rejects(finish(dir, 'l2', job, { hosts, vars }), /already finished l2/);
      // A job that never loads counts against the same budget: refused, nothing claimed, nothing sent.
      park(dir, 'l3', 'needs a yes', { id: 'l3' });
      decided('l3', 'yes');
      const stuck = file('stuck.mjs', 'await new Promise(() => {});\nexport async function finish() {}\n');
      const t1 = Date.now();
      await assert.rejects(finish(dir, 'l3', stuck, { hosts, vars, budgetMs: 1500 }), (e) => e.refused && e.message === 'the job did not load within 2s; nothing was sent');
      assert.ok(Date.now() - t1 < 10_000, 'the budget did not hold at load');
      assert.ok(!existsSync(join(dir, 'finished', 'l3.json')), 'a job that did not load claimed the item');
    }

    // 6d. A refused send in finish, never awaited, is kept in finished/<id>.json: the API may have acted.
    {
      park(dir, 'n1', 'needs a yes', { id: 'n1' });
      decided('n1', 'yes');
      const loose = file(
        'loose.mjs',
        `export async function finish(copy, decision, ctx) {
           ctx.send({ method: 'POST', url: '${A}/go', headers: { 'x-key': '{{WEATHER_KEY}}' }, body: 'fin' });
           await new Promise((ok) => setTimeout(ok, 800));
           return { ok: true };
         }\n`,
      );
      const out = await finish(dir, 'n1', loose, { hosts, vars });
      assert.equal(out.state, 'done', out.error);
      assert.equal(out.refusals?.length, 1);
      assert.match(out.refusals[0], /^refused: WEATHER_KEY may not go to .*: the API may have acted$/);
      assert.deepEqual(JSON.parse(readFileSync(join(dir, 'finished', 'n1.json'), 'utf8')).refusals, out.refusals);
    }

    // 6e. finish reads the runs' trace: a file not named exactly <id>.json, a trace line it cannot
    // read, a missing trace, a run with no exit line, and a decision from before the newest run ended
    // or later than now are each refused. Nothing is sent.
    {
      const sent = seen.length;
      const trace = join(dir, 'trace.jsonl');
      const keep = readFileSync(trace, 'utf8');
      park(dir, 'm1', 'needs a yes', { id: 'm1' });
      decided('m1', 'yes');
      renameSync(join(dir, 'parked', 'm1.json'), join(dir, 'parked', 'M1.json'));
      await assert.rejects(finish(dir, 'm1', job, { hosts, vars }), (e) => e.refused, 'a file in another case');
      renameSync(join(dir, 'parked', 'M1.json'), join(dir, 'parked', 'm1.json'));
      const refusedWith = (re) => assert.rejects(finish(dir, 'm1', job, { hosts, vars }), (e) => e.refused && re.test(e.message));
      appendFileSync(trace, 'x\n');
      await refusedWith(/^trace\.jsonl line 3 cannot be read/);
      unlinkSync(trace);
      await refusedWith(/is missing or holds no run, and parked\/ is not empty/);
      writeFileSync(trace, keep + line({ at: new Date().toISOString(), run: 'started', pid: 1 }));
      await refusedWith(/^a run is going, or was killed before it read parked\/: ask your human$/);
      appendFileSync(trace, line({ at: new Date(Date.now() + 1000).toISOString(), exit: 'done' }));
      await refusedWith(/was decided before the last run ended/);
      writeFileSync(trace, keep);
      decided('m1', 'yes', new Date(Date.now() + 60_000).toISOString());
      await refusedWith(/later than now/);
      assert.equal(seen.length, sent);
      decided('m1', 'yes');
      assert.equal((await finish(dir, 'm1', job, { hosts, vars })).state, 'done');
    }

    // 7. Ids are file names, never paths or device names.
    for (const bad of ['../x', 'a/b', 'a\\b', '', '.hidden', 'x.', 'con', 'NUL.txt', 'com1', 'a b', 'x'.repeat(101)]) {
      assert.throws(() => checkId(bad), /not an id/, bad);
    }
    assert.equal(checkId('row-12.v2_b'), 'row-12.v2_b');
    assert.throws(() => park(dir, 'e5', '', {}), /needs a reason/);

    // 8. The command line. decide needs a terminal and no preload; an agent's plain command has neither.
    {
      const plain = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'NODE_OPTIONS'));
      const cli = (args, env = plain) =>
        new Promise((ok) => execFile(process.execPath, [SCRIPT, ...args], { cwd: tmp, env, timeout: 30_000 }, (e, stdout, stderr) => ok({ code: e ? e.code : 0, stdout, stderr })));
      park(dir, 'f6', 'ask first', { id: 'f6' });
      const no = await cli(['decide', 'f6', 'yes', '--dir', dir]);
      assert.equal(no.code, 1);
      assert.match(no.stderr, /^refused: decide is your human's call/);
      const shim = file('tty-shim.mjs', 'process.stdin.isTTY = true; process.stdout.isTTY = true;\n');
      const faked = await cli(['decide', 'f6', 'yes', '--dir', dir], { ...process.env, NODE_OPTIONS: `--import=${pathToFileURL(shim).href}` });
      assert.equal(faked.code, 1);
      assert.match(faked.stderr, /^refused: decide runs as a plain node command/);
      // Any NODE_OPTIONS, quoted or not, and any Node flag, are refused too.
      const quoted = await cli(['decide', 'f6', 'yes', '--dir', dir], { ...plain, NODE_OPTIONS: `"--import=${pathToFileURL(shim).href}"` });
      assert.match(quoted.stderr, /^refused: decide runs as a plain node command/);
      const flagged = await new Promise((ok) =>
        execFile(process.execPath, ['--no-warnings', SCRIPT, 'decide', 'f6', 'yes', '--dir', dir], { env: plain, timeout: 30_000 }, (e, stdout, stderr) => ok({ code: e ? e.code : 0, stderr })),
      );
      assert.match(flagged.stderr, /^refused: decide runs as a plain node command/);
      // A wrapper that sets process.argv and imports this script is refused where Node has import.meta.main.
      if (typeof import.meta.main === 'boolean') {
        const wrapper = file('go.mjs', `process.argv[1] = ${JSON.stringify(SCRIPT)}; await import(${JSON.stringify(pathToFileURL(SCRIPT).href)});\n`);
        const wrapped = await new Promise((ok) =>
          execFile(process.execPath, [wrapper, 'decide', 'f6', 'yes', '--dir', dir], { env: plain, timeout: 30_000 }, (e, stdout, stderr) => ok({ code: e ? e.code : 0, stderr })),
        );
        assert.match(wrapped.stderr, /^refused: decide runs as a plain node command/);
      }
      assert.equal(readParked('f6').decision, null);
      const listed = await cli(['list', '--dir', dir]);
      assert.equal(listed.code, 0);
      assert.match(listed.stdout, /^b2 · finished \(done\) · needs a yes$/m);
      assert.match(listed.stdout, /^f6 · waiting for your human · ask first$/m);
      const jobFile = file('job-cli.mjs', `export async function finish(copy, decision) { return { decision }; }\n`);
      const notYet = await cli(['finish', 'f6', '--job', jobFile, '--dir', dir]);
      assert.equal(notYet.code, 1);
      assert.match(notYet.stderr, /^not decided f6/);
      decided('f6', 'yes');
      const once = await cli(['finish', 'f6', '--job', jobFile, '--dir', dir]);
      assert.equal(once.code, 0, once.stderr);
      assert.equal(once.stdout.trim(), 'finished f6: yes');
      const twice = await cli(['finish', 'f6', '--job', jobFile, '--dir', dir]);
      assert.equal(twice.code, 1);
      assert.equal(twice.stderr.trim(), 'already finished f6');
      // A refused send in finish is printed, also one the job caught.
      park(dir, 'o1', 'ask first', { id: 'o1' });
      decided('o1', 'yes');
      const caught = file('job-caught.mjs', `export async function finish(copy, decision, ctx) { try { await ctx.send({ url: '${A}/x', headers: { 'x-key': '{{NO_SUCH_KEY_X}}' } }); } catch {} return {}; }\n`);
      const printed = await cli(['finish', 'o1', '--job', caught, '--dir', dir]);
      assert.equal(printed.code, 0, printed.stderr);
      assert.match(printed.stderr, /^refused send in finish o1: refused: NO_SUCH_KEY_X .*: nothing was sent$/m);
      const bad = await cli(['decide', '../f6', 'yes', '--dir', dir]);
      assert.equal(bad.code, 2);
      assert.ok(!existsSync(join(tmp, 'f6.json')));
      assert.equal((await cli(['decide', 'f6', 'maybe', '--dir', dir])).code, 2);
    }
  } finally {
    srv.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}
