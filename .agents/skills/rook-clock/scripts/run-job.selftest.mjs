// run-job.selftest.mjs · the checks behind `node run-job.mjs --self-test`. Your agent does not run this file.
// Offline: jobs written to a temporary folder, one HTTP server on 127.0.0.1. Leaves no file behind.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finish } from './parked.mjs';
import { parseBudget, readItems, runJob } from './run-job.mjs';

const KEY = `wk_FAKE_${'run555QQ'}`;
const SCRIPT = fileURLToPath(new URL('./run-job.mjs', import.meta.url));

export async function selfTest() {
  const seen = [];
  const srv = http.createServer((req, res) => {
    seen.push({ url: req.url, key: req.headers['x-key'] });
    if (req.url.startsWith('/slow')) return setTimeout(() => res.end('slow'), 4000).unref();
    if (req.url.startsWith('/go')) {
      res.writeHead(307, { location: 'http://127.0.0.1:9/x' });
      return res.end();
    }
    res.end(`echo ${req.headers['x-key'] ?? ''}`);
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const A = `http://127.0.0.1:${srv.address().port}`;
  const hosts = { WEATHER_KEY: [A] };
  const vars = { WEATHER_KEY: KEY };
  const tmp = mkdtempSync(join(tmpdir(), 'clock-run-'));
  let n = 0;
  // A job file of its own for each case, so no import is cached between them.
  const job = (source) => {
    const path = join(tmp, `job-${++n}.mjs`);
    writeFileSync(path, source);
    return path;
  };
  const items = (count) => Array.from({ length: count }, (_, i) => ({ id: `i${i + 1}`, n: i + 1 }));
  const run = (source, list, extra = {}) => {
    const dir = join(tmp, `run-${n + 1}`);
    const lines = [];
    return runJob({ job: job(source), items: list, budgetMs: 10_000, hosts, vars, dir, print: (l) => lines.push(l), ...extra }).then((r) => ({
      ...r,
      dir,
      lines,
      trace: existsSync(join(dir, 'trace.jsonl')) ? readFileSync(join(dir, 'trace.jsonl'), 'utf8') : '',
    }));
  };
  try {
    // 1. Every item done: exit done, one trace line per item plus the exit line.
    {
      const r = await run('export async function handle(item) { return { done: true }; }', items(3));
      assert.equal(r.exit, 'done');
      assert.equal(r.code, 0);
      assert.deepEqual([r.done, r.parked, r.left], [3, 0, 0]);
      const t = r.trace.trim().split('\n').map((l) => JSON.parse(l));
      assert.deepEqual(
        t.map((l) => (l.id ? `${l.id} ${l.result}` : (l.exit ?? `run ${l.run}`))),
        ['run started', 'i1 started', 'i1 done', 'i2 started', 'i2 done', 'i3 started', 'i3 done', 'done'],
      );
      assert.ok(t.filter((l) => l.result === 'done').every((l) => typeof l.ms === 'number'));
      // The run's window, for finish: from its started line to its exit line.
      assert.equal(t.at(-1).runStartedAt, t[0].at);
      assert.match(r.lines.at(-1), /^exit: done · 3 done · 0 parked · 0 left$/);
      assert.ok(!existsSync(join(r.dir, 'left.jsonl')), 'a run with nothing left wrote left.jsonl');
    }

    // 2. A rule as a check: an item that fails it is parked with the rule and its own copy.
    {
      const r = await run(
        `export const checks = [{ rule: 'n is at most 2', check: (item) => item.n <= 2 }];
         export async function handle(item) { return item.n === 2 ? { park: 'two needs your human', copy: { n: 2, note: 'mine' } } : { done: true }; }`,
        items(3),
      );
      assert.deepEqual([r.exit, r.done, r.parked], ['done', 1, 2]);
      const three = JSON.parse(readFileSync(join(r.dir, 'parked', 'i3.json'), 'utf8'));
      assert.equal(three.reason, 'check: n is at most 2');
      assert.deepEqual(three.copy, { id: 'i3', n: 3 });
      assert.equal(three.decision, null);
      const two = JSON.parse(readFileSync(join(r.dir, 'parked', 'i2.json'), 'utf8'));
      assert.deepEqual(two.copy, { n: 2, note: 'mine' });
      assert.ok(r.lines.some((l) => l === 'parked i2: two needs your human'));
    }

    // 3. A throw stops the run at that item; the rest is left.
    {
      const r = await run(`export async function handle(item) { if (item.n === 2) throw new Error('bad row'); return { done: true }; }`, items(4));
      assert.deepEqual([r.exit, r.code, r.done, r.left], ['failed:i2', 1, 1, 2]);
      assert.equal(r.error, 'bad row');
      assert.match(r.trace, /"id":"i2","result":"failed"/);
      assert.ok(!r.trace.includes('"i3"'));
      // The items never started wait in left.jsonl, in order; the failed one is not among them.
      assert.equal(readFileSync(r.leftFile, 'utf8'), '{"id":"i3","n":3}\n{"id":"i4","n":4}\n');
      assert.match(r.lines.at(-1), / · 2 left \(in .*left\.jsonl\)$/);
    }
    {
      const r = await run('export async function handle() { return { ok: true }; }', items(1));
      assert.equal(r.exit, 'failed:i1');
      assert.match(r.error, /neither/);
    }
    {
      const r = await run('export async function handle() { setTimeout(() => { throw new Error("late"); }); return new Promise(() => {}); }', items(2));
      assert.equal(r.exit, 'failed:i1');
    }
    {
      const r = await run('export async function handle() { process.exit(0); }', items(2));
      assert.equal(r.exit, 'failed:i1');
    }
    {
      const r = await run('export const nothing = 1;', items(2));
      assert.deepEqual([r.exit, r.code, r.left], ['failed:job', 1, 2]);
      assert.match(r.error, /no handle/);
    }

    // 4. The budget is the runner's: a job stuck in a loop, or waiting forever, is ended on time.
    for (const body of ['while (true) {}', 'await new Promise(() => {});']) {
      const t0 = Date.now();
      const r = await run(
        `globalThis.setTimeout = () => 0; export const budget = '1h';
         export async function handle(item) { if (item.n === 2) { ${body} } return { done: true }; }`,
        items(3),
        { budgetMs: 2000 },
      );
      assert.deepEqual([r.exit, r.code, r.done, r.unfinished, r.left], ['budget_spent', 3, 1, 'i2', 1]);
      assert.ok(Date.now() - t0 < 8000, 'the budget did not hold');
      assert.match(r.trace, /"id":"i2","result":"started"/);
      assert.match(r.trace, /"id":"i2","result":"unfinished"/);
      assert.match(r.lines.at(-1), /unfinished: i2/);
    }

    // 5. The item cap is the runner's too.
    {
      const r = await run('export async function handle() { return { done: true }; }', items(5), { maxItems: 2 });
      assert.deepEqual([r.exit, r.done, r.left, r.capped], ['done', 2, 3, 3]);
      assert.deepEqual(readItems(r.leftFile).map((i) => i.id), ['i3', 'i4', 'i5']);
    }

    // 6. A stop ends the run at once: stopped, exit code 4.
    {
      const stop = new AbortController();
      setTimeout(() => stop.abort(), 2000);
      const r = await run('export async function handle() { await new Promise((ok) => setTimeout(ok, 60_000)); return { done: true }; }', items(2), { stop: stop.signal });
      assert.deepEqual([r.exit, r.code, r.unfinished], ['stopped', 4, 'i1']);
    }

    // 7. ctx.send: the key goes only to its own host, and the job and the trace never see its value.
    {
      const r = await run(
        `export async function handle(item, ctx) {
           if (item.n === 1) {
             const res = await ctx.send({ url: '${A}/x', headers: { 'x-key': '{{WEATHER_KEY}}' } });
             if (res.body !== 'echo {{WEATHER_KEY}}') throw new Error('saw ' + res.body);
             return { done: true };
           }
           try {
             await ctx.send({ url: 'http://127.0.0.1:9/x', headers: { 'x-key': '{{WEATHER_KEY}}' } });
             return { done: true };
           } catch (e) {
             return { park: e.message };
           }
         }`,
        items(2),
      );
      assert.deepEqual([r.exit, r.done, r.parked], ['done', 1, 1]);
      assert.deepEqual(seen, [{ url: '/x', key: KEY }]);
      const parked = JSON.parse(readFileSync(join(r.dir, 'parked', 'i2.json'), 'utf8'));
      assert.equal(parked.reason, 'refused: WEATHER_KEY may not go to http://127.0.0.1:9 (hop 1)');
      assert.ok(!r.trace.includes(KEY) && !r.lines.join('\n').includes(KEY));
    }
    {
      // A message that holds the key, from a job that read it some other way, is shown as the reference.
      const r = await run(`export async function handle() { throw new Error('${KEY} broke'); }`, items(1));
      assert.equal(r.error, '{{WEATHER_KEY}} broke');
      assert.ok(!r.trace.includes(KEY) && !r.lines.join('\n').includes(KEY));
    }

    // 7b. The job's process holds no secret, and a value it writes out is refused, also through ctx.send.
    {
      process.env.CLOCK_SELFTEST_SECRET = KEY;
      try {
        const r = await run(
          `export async function handle(item, ctx) {
             if (process.env.CLOCK_SELFTEST_SECRET !== undefined || process.env.WEATHER_KEY !== undefined) throw new Error('the job holds a secret');
             if (Object.keys(process.env).some((k) => /^NODE_OPTIONS$/i.test(k))) throw new Error('the job got NODE_OPTIONS');
             try {
               await ctx.send({ method: 'POST', url: '${A}/x', body: 'k=${KEY}' });
               return { done: true };
             } catch (e) {
               return { park: e.message };
             }
           }`,
          items(1),
        );
        assert.deepEqual([r.exit, r.parked], ['done', 1], r.error);
        assert.equal(JSON.parse(readFileSync(join(r.dir, 'parked', 'i1.json'), 'utf8')).reason, 'refused: a secret value is written out; use {{WEATHER_KEY}}');
        assert.equal(seen.length, 1, 'a written-out value was sent');
      } finally {
        delete process.env.CLOCK_SELFTEST_SECRET;
      }
    }

    // 7c. A process the job starts, even a detached one, ends with the run.
    {
      const pidFile = join(tmp, 'grandchild.pid');
      const code = `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
      const r = await run(
        `import { spawn } from 'node:child_process';
         import { existsSync } from 'node:fs';
         export async function handle() {
           spawn(process.execPath, ['-e', ${JSON.stringify(code)}], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
           while (!existsSync(${JSON.stringify(pidFile)})) await new Promise((ok) => setTimeout(ok, 20));
           while (true) {}
         }`,
        items(1),
        { budgetMs: 4000 },
      );
      assert.equal(r.exit, 'budget_spent');
      const pid = Number(readFileSync(pidFile, 'utf8'));
      const alive = () => {
        try {
          process.kill(pid, 0);
          return true;
        } catch (e) {
          return e.code === 'EPERM';
        }
      };
      for (let i = 0; i < 30 && alive(); i++) await new Promise((ok) => setTimeout(ok, 100));
      const left = alive();
      if (left) process.kill(pid, 'SIGKILL');
      assert.equal(left, false, 'a process the job started outlived the run');
    }

    // 7d. A redirect to a host the key may not reach, in the middle of a list: that item is parked with
    // the refusal (the first host answered, so it may have acted), and the run goes on.
    {
      const r = await run(
        `export async function handle(item, ctx) {
           await ctx.send({ method: 'POST', url: '${A}/' + (item.n === 3 ? 'go' : 'pay'), headers: { 'x-key': '{{WEATHER_KEY}}' } });
           return { done: true };
         }`,
        items(5),
      );
      assert.deepEqual([r.exit, r.done, r.parked, r.left], ['done', 4, 1, 0], r.error);
      const three = JSON.parse(readFileSync(join(r.dir, 'parked', 'i3.json'), 'utf8'));
      assert.equal(three.reason, 'refused: WEATHER_KEY may not go to http://127.0.0.1:9 (hop 2; hop 1 answered 307): the API may have acted');
      assert.deepEqual(three.copy, { id: 'i3', n: 3 });
      // A throw that is not a refusal still stops the run.
      const t = await run(`export async function handle(item, ctx) { await ctx.send({ url: '${A}/pay' }); throw new Error('boom'); }`, items(2));
      assert.equal(t.exit, 'failed:i1');
      // A refusal the job caught, then a real throw: the throw stops the run; it is not parked.
      const m = await run(
        `export async function handle(item, ctx) {
           try { await ctx.send({ url: 'http://127.0.0.1:9/x', headers: { 'x-key': '{{WEATHER_KEY}}' } }); } catch {}
           throw new Error('database is down: stop the run');
         }`,
        [{ id: 'm1' }, { id: 'm2' }],
      );
      assert.deepEqual([m.exit, m.parked, m.left], ['failed:m1', 0, 1]);
      assert.equal(m.error, 'database is down: stop the run');
      // A send left running by s1, refused after s1 returned done: traced on s1, never put on s2.
      const s = await run(
        `export async function handle(item, ctx) {
           if (item.id === 's1') {
             ctx.send({ method: 'POST', url: '${A}/go', headers: { 'x-key': '{{WEATHER_KEY}}' } }).catch(() => {});
             return { done: true };
           }
           await new Promise((ok) => setTimeout(ok, 1000));
           throw new Error('s2 real bug');
         }`,
        [{ id: 's1' }, { id: 's2' }],
      );
      assert.deepEqual([s.exit, s.error, s.parked, s.refusedAfterDone], ['failed:s2', 's2 real bug', 0, ['s1']]);
      assert.match(s.trace, /"id":"s1","result":"refused-after-done","reason":"refused: WEATHER_KEY may not go to http:\/\/127\.0\.0\.1:9 \(hop 2; hop 1 answered 307\): the API may have acted"/);
      assert.match(s.lines.at(-1), / · refused after done: s1 \(see trace\.jsonl\)/);
    }

    // 7e. A decision the job wrote itself is refused: no park over it, and no finish of it.
    {
      const r = await run(
        `import { createHash } from 'node:crypto';
         import { mkdirSync, writeFileSync } from 'node:fs';
         import { join } from 'node:path';
         export async function handle(item) {
           const copy = { ...item, crafted: true };
           const json = JSON.stringify(copy);
           mkdirSync(join(${JSON.stringify(tmp)}, 'parked'), { recursive: true });
           writeFileSync(join(${JSON.stringify(tmp)}, 'parked', 'p1.json'), JSON.stringify({ id: 'p1', reason: 'x', copy, copySha: createHash('sha256').update(json).digest('hex'), parkedAt: new Date().toISOString(), decision: 'yes' }));
           return { park: 'needs a yes' };
         }`,
        [{ id: 'p1' }],
        { dir: tmp },
      );
      // The park over it is refused on p1, and the run ends failed:job: no human made that decision.
      assert.equal(r.exit, 'failed:job');
      assert.equal(r.error, 'parked/p1.json: decision set during the run, by code or by your human: your human decides it again after the run');
      assert.match(readFileSync(join(tmp, 'trace.jsonl'), 'utf8'), /"id":"p1","result":"failed","ms":\d+,"error":"parked\/p1\.json already holds a decision no human recorded in this run: ask your human; do not finish it"/);
      const fin = job('export async function finish() { return { sent: true }; }');
      await assert.rejects(finish(tmp, 'p1', fin, {}), (e) => e.refused && /no time your human recorded it after the park/.test(e.message));
    }

    // 7f. A job that writes a decision into an item parked earlier in the run, and plants files of its
    // own: the run ends failed:job, and finish refuses each of them.
    {
      const dir = join(tmp, 'med1');
      const r = await run(
        `import { createHash } from 'node:crypto';
         import { readFileSync, writeFileSync } from 'node:fs';
         import { join } from 'node:path';
         const at = (id) => join(${JSON.stringify(dir)}, 'parked', id + '.json');
         const plant = (id, decision) => {
           const copy = { id, amount: 9999 };
           const json = JSON.stringify(copy);
           writeFileSync(at(id), JSON.stringify({ id, reason: 'x', copy, copySha: createHash('sha256').update(json).digest('hex'), parkedAt: new Date(Date.now() - 1000).toISOString(), decision, decidedAt: decision ? new Date().toISOString() : null }));
         };
         export async function handle(item) {
           if (item.id === 'p1') return { park: 'needs a yes' };
           const p1 = JSON.parse(readFileSync(at('p1'), 'utf8'));
           writeFileSync(at('p1'), JSON.stringify({ ...p1, decision: 'yes', decidedAt: new Date().toISOString() }));
           plant('zz', 'yes');
           plant('zy', null);
           return { done: true };
         }`,
        [{ id: 'p1' }, { id: 'w2' }],
        { dir },
      );
      assert.equal(r.exit, 'failed:job');
      assert.equal(r.code, 1);
      assert.equal(
        r.error,
        'parked/p1.json, parked/zz.json: decision set during the run, by code or by your human: your human decides it again after the run; parked/zy.json appeared during the run and the runner did not park it: ask your human',
      );
      const t = readFileSync(join(dir, 'trace.jsonl'), 'utf8');
      for (const id of ['p1', 'zz', 'zy']) assert.match(t, new RegExp(`"id":"${id}","result":"not-by-human"`));
      const fin = job('export async function finish() { return { sent: true }; }');
      for (const id of ['p1', 'zz']) await assert.rejects(finish(dir, id, fin, {}), (e) => e.refused && /got its decision during a run/.test(e.message), id);
      // Your human decides again after the run: p1 is theirs now and finishes. zz was planted: still refused.
      const redo = (id) => {
        const p = join(dir, 'parked', `${id}.json`);
        writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, 'utf8')), decision: 'yes', decidedAt: new Date().toISOString() }));
      };
      await new Promise((ok) => setTimeout(ok, 20));
      redo('p1');
      redo('zz');
      assert.equal((await finish(dir, 'p1', fin, {})).state, 'done');
      await assert.rejects(finish(dir, 'zz', fin, {}), (e) => e.refused && /got its decision during a run/.test(e.message));
      // A decision recorded while a run was going (inside its window in trace.jsonl) is refused too.
      const w = join(tmp, 'window');
      const ok = await run('export async function handle() { await new Promise((ok) => setTimeout(ok, 300)); return { park: "ask" }; }', [{ id: 'q1' }], { dir: w });
      assert.equal(ok.exit, 'done');
      const lines = readFileSync(join(w, 'trace.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      const q = join(w, 'parked', 'q1.json');
      const inside = new Date(Date.parse(lines.at(-1).at) - 1).toISOString();
      writeFileSync(q, JSON.stringify({ ...JSON.parse(readFileSync(q, 'utf8')), decision: 'yes', decidedAt: inside }));
      await assert.rejects(finish(w, 'q1', fin, {}), (e) => e.refused && /got its decision during a run/.test(e.message));
    }

    // 7g. A refusal the job caught is traced on its item, then its done.
    {
      const r = await run(
        `export async function handle(item, ctx) {
           if (item.id === 'c1') { try { await ctx.send({ method: 'POST', url: '${A}/go', headers: { 'x-key': '{{WEATHER_KEY}}' } }); } catch {} }
           return { done: true };
         }`,
        [{ id: 'c1' }, { id: 'c2' }],
      );
      assert.deepEqual([r.exit, r.done], ['done', 2]);
      const t = r.trace.trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.id === 'c1');
      assert.deepEqual(t.map((l) => l.result), ['started', 'refused', 'done']);
      assert.match(t[1].reason, /^refused: WEATHER_KEY may not go to http:\/\/127\.0\.0\.1:9 \(hop 2; hop 1 answered 307\): the API may have acted$/);
    }

    // 7h. A refusal no one awaited, from an item that returned done, does not fail the next item.
    {
      const r = await run(
        `export async function handle(item, ctx) {
           if (item.id === 'u1') { ctx.send({ method: 'POST', url: '${A}/go', headers: { 'x-key': '{{WEATHER_KEY}}' } }); return { done: true }; }
           await new Promise((ok) => setTimeout(ok, 500));
           return { done: true };
         }`,
        [{ id: 'u1' }, { id: 'u2' }],
      );
      assert.deepEqual([r.exit, r.done, r.refusedAfterDone], ['done', 2, ['u1']], r.error);
      assert.match(r.lines.at(-1), /^exit: done · 2 done · .* · refused after done: u1 /);
    }

    // 7i. A send a done item left open, cut when the run ends: traced and named.
    {
      const r = await run(
        `export async function handle(item, ctx) {
           if (item.id === 'f1') { ctx.send({ url: '${A}/slow', headers: { 'x-key': '{{WEATHER_KEY}}' } }).catch(() => {}); return { done: true }; }
           while (true) {}
         }`,
        [{ id: 'f1' }, { id: 'f2' }],
        { budgetMs: 2000 },
      );
      assert.deepEqual([r.exit, r.unfinished, r.sendsCut], ['budget_spent', 'f2', ['f1']]);
      assert.match(r.trace, /"id":"f1","result":"send-cut"/);
      assert.match(r.lines.at(-1), / · sends cut: f1 \(may have acted\)/);
    }

    // 7j–7m. A job writes a decision into p1, parked by an earlier run, dated 1 ms before its own run
    // started (after every earlier run). Each way past the scan and the windows is refused.
    const fin = job('export async function finish() { return { sent: true }; }');
    const seed = (dir) => run('export async function handle() { return { park: "ask" }; }', [{ id: 'p1' }], { dir });
    const attack = (dir, body) =>
      `import { createHash } from 'node:crypto';
       import { appendFileSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
       import { join } from 'node:path';
       const D = ${JSON.stringify(dir)};
       const back = () => {
         const t = readFileSync(join(D, 'trace.jsonl'), 'utf8').trim().split('\\n').map((l) => JSON.parse(l));
         return new Date(Date.parse(t.findLast((l) => l.run === 'started').at) - 1).toISOString();
       };
       const decided = () => ({ ...JSON.parse(readFileSync(join(D, 'parked', 'p1.json'), 'utf8')), decision: 'yes', decidedAt: back() });
       export async function handle(item) { ${body} }`;

    // 7j. A file in another case: P1.json holding p1 opens as p1.json on Windows and macOS. The scan
    // flags every file not named exactly for its id, and finish refuses one.
    {
      const dir = join(tmp, 'case');
      await seed(dir);
      const r = await run(
        attack(
          dir,
          `const p1 = decided();
           unlinkSync(join(D, 'parked', 'p1.json'));
           writeFileSync(join(D, 'parked', 'P1.json'), JSON.stringify(p1));
           const copy = { id: 'zz', amount: 9999 };
           const json = JSON.stringify(copy);
           writeFileSync(join(D, 'parked', 'Zz.json'), JSON.stringify({ id: 'zz', reason: 'x', copy, copySha: createHash('sha256').update(json).digest('hex'), parkedAt: p1.parkedAt, decision: 'yes', decidedAt: p1.decidedAt }));
           return { done: true };`,
        ),
        [{ id: 'w1' }],
        { dir },
      );
      assert.equal(r.exit, 'failed:job');
      for (const f of ['P1', 'Zz']) assert.match(r.error, new RegExp(`parked/${f}\\.json[^;]* is not named exactly for the id it holds`));
      assert.match(readFileSync(join(dir, 'trace.jsonl'), 'utf8'), /"id":"p1","result":"not-by-human","why":"name","file":"parked\/P1\.json"/);
      for (const id of ['p1', 'zz']) await assert.rejects(finish(dir, id, fin, {}), (e) => e.refused, id);
      assert.ok(!existsSync(join(dir, 'finished')), 'a misnamed file was finished');
    }

    // 7k. The job kills the runner: no scan, no exit line. finish refuses while the newest run has none.
    {
      const dir = join(tmp, 'kill');
      await seed(dir);
      const items = join(tmp, 'kill-items.jsonl');
      writeFileSync(items, '{"id":"w1"}\n');
      const killer = job(attack(dir, `writeFileSync(join(D, 'parked', 'p1.json'), JSON.stringify(decided())); process.kill(process.ppid, 'SIGKILL'); await new Promise(() => {});`));
      await new Promise((ok) => execFile(process.execPath, [SCRIPT, '--job', killer, '--items', items, '--budget', '20s', '--dir', dir], { timeout: 30_000 }, () => ok()));
      const t = readFileSync(join(dir, 'trace.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      assert.ok(!t.at(-1).exit, 'the killed run has an exit line');
      assert.equal(typeof t.findLast((l) => l.run === 'started').pid, 'number');
      await assert.rejects(finish(dir, 'p1', fin, {}), (e) => e.refused && e.message === 'a run is going, or was killed before it read parked/: ask your human');
      assert.ok(!existsSync(join(dir, 'finished')));
    }

    // 7l. A half line in trace.jsonl: the runner's next line starts on a line of its own, and finish
    // refuses a trace with a line it cannot read.
    {
      const dir = join(tmp, 'half');
      const r = await run(
        `import { appendFileSync } from 'node:fs';
         export async function handle(item) {
           if (item.id === 'w1') { appendFileSync(${JSON.stringify(join(dir, 'trace.jsonl'))}, 'x'); return { done: true }; }
           return { park: 'ask' };
         }`,
        [{ id: 'w1' }, { id: 'q2' }],
        { dir },
      );
      assert.equal(r.exit, 'done', r.error);
      const lines = readFileSync(join(dir, 'trace.jsonl'), 'utf8').trim().split('\n');
      assert.ok(lines.includes('x'), 'the half line is not on a line of its own');
      for (const l of lines.filter((l) => l !== 'x')) JSON.parse(l);
      await new Promise((ok) => setTimeout(ok, 10));
      const q = join(dir, 'parked', 'q2.json');
      writeFileSync(q, JSON.stringify({ ...JSON.parse(readFileSync(q, 'utf8')), decision: 'yes', decidedAt: new Date().toISOString() }));
      await assert.rejects(finish(dir, 'q2', fin, {}), (e) => e.refused && /^trace\.jsonl line \d+ cannot be read/.test(e.message));
      // Your human removes the half line: the same decision finishes.
      writeFileSync(join(dir, 'trace.jsonl'), lines.filter((l) => l !== 'x').join('\n') + '\n');
      assert.equal((await finish(dir, 'q2', fin, {})).state, 'done');
    }

    // 7m. finish while the run is still going: refused, also with a decision dated before the run.
    {
      const dir = join(tmp, 'mid');
      await seed(dir);
      const going = run(attack(dir, `writeFileSync(join(D, 'parked', 'p1.json'), JSON.stringify(decided())); await new Promise((ok) => setTimeout(ok, 1500)); return { done: true };`), [{ id: 'w1' }], { dir });
      const p = join(dir, 'parked', 'p1.json');
      for (let i = 0; i < 100 && JSON.parse(readFileSync(p, 'utf8')).decision !== 'yes'; i++) await new Promise((ok) => setTimeout(ok, 50));
      await assert.rejects(finish(dir, 'p1', fin, {}), (e) => e.refused && e.message === 'a run is going, or was killed before it read parked/: ask your human');
      const r = await going;
      assert.equal(r.exit, 'failed:job');
      assert.equal(r.error, 'parked/p1.json: decision set during the run, by code or by your human: your human decides it again after the run');
      await assert.rejects(finish(dir, 'p1', fin, {}), (e) => e.refused);
      // Dated after the run started but before it ended: refused by the newest run's last line.
      const lines = readFileSync(join(dir, 'trace.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      const last = Date.parse(lines.at(-1).at);
      writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, 'utf8')), decidedAt: new Date(last).toISOString() }));
      await assert.rejects(finish(dir, 'p1', fin, {}), (e) => e.refused);
      writeFileSync(p, JSON.stringify({ ...JSON.parse(readFileSync(p, 'utf8')), decidedAt: new Date(Date.now() + 60_000).toISOString() }));
      await assert.rejects(finish(dir, 'p1', fin, {}), (e) => e.refused && /later than now/.test(e.message));
      assert.ok(!existsSync(join(dir, 'finished')));
    }

    // 8. Reading the flags and the items.
    assert.equal(parseBudget('30s'), 30_000);
    assert.equal(parseBudget('500ms'), 500);
    assert.equal(parseBudget('2m'), 120_000);
    for (const bad of ['', '30', '-1s', '0s', '25h', '1d', 'soon']) assert.throws(() => parseBudget(bad), /--budget/);
    const file = (text) => {
      const p = join(tmp, `items-${++n}.jsonl`);
      writeFileSync(p, text);
      return p;
    };
    assert.equal(readItems(file('{"id":"a"}\n\n{"id":2}\r\n')).length, 2);
    assert.throws(() => readItems(file('{"id":"a"}\n{"id":"a"}\n')), /twice/);
    assert.throws(() => readItems(file('{"id":"Pay1"}\n{"id":"pay1"}\n')), /differ only in case/);
    assert.throws(() => readItems(file('{"id":"../x"}\n')), /not an id/);
    assert.throws(() => readItems(file('{"id":"nul"}\n')), /not an id/);
    assert.throws(() => readItems(file('{"n":1}\n')), /no "id"/);
    assert.throws(() => readItems(file('nope\n')), /line 1 is not JSON/);

    // 9. The command line: the budget is required; a run prints its exit and exits with its code.
    {
      const cli = (...args) =>
        new Promise((ok) => execFile(process.execPath, [SCRIPT, ...args], { cwd: tmp, timeout: 30_000 }, (e, stdout, stderr) => ok({ code: e ? e.code : 0, stdout, stderr })));
      const j = job('export async function handle(item) { return item.n === 2 ? { park: "ask" } : { done: true }; }');
      const list = file('{"id":"a","n":1}\n{"id":"b","n":2}\n');
      const no = await cli('--job', j, '--items', list);
      assert.equal(no.code, 2);
      assert.match(no.stderr, /--budget is required/);
      const dir = join(tmp, 'cli');
      const yes = await cli('--job', j, '--items', list, '--budget', '20s', '--dir', dir);
      assert.equal(yes.code, 0, yes.stderr);
      assert.match(yes.stdout, /^parked b: ask$/m);
      assert.match(yes.stdout, /^exit: done · 1 done · 1 parked · 0 left$/m);
      assert.ok(existsSync(join(dir, 'parked', 'b.json')));
      const spent = await cli('--job', job('export async function handle() { while (true) {} }'), '--items', list, '--budget', '1500ms', '--dir', dir);
      assert.equal(spent.code, 3);
      assert.match(spent.stdout, /^exit: budget_spent /m);
    }
  } finally {
    srv.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}
