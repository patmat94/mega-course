// cut.selftest.mjs · the checks behind `node cut.mjs --self-test`. Your agent does not run this file.
// Offline: stand-in jobs are `node` child processes this test starts itself, one HTTP server on 127.0.0.1,
// a stand-in schtasks and a stand-in egress in a temp folder. It stops only what it started, never a real
// scheduled task, and leaves no file behind.

import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alive, cut, protectedPids, systemTools } from './cut.mjs';
import { processTable } from './reach.mjs';
import { add, keyHome, keyOf, loadJobs, record, Refused, seen, signedLine } from './reach.mjs';
import { asAccount, decoyEnv } from './reach.selftest.mjs';

const SCRIPT = fileURLToPath(new URL('./cut.mjs', import.meta.url));
const WIN = process.platform === 'win32';
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

const children = [];
const extra = []; // pids of processes a child of this test started
function job() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: !WIN, windowsHide: true });
  children.push(child);
  return child.pid;
}

function server() {
  const hits = [];
  const s = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (req.url.split('?')[0] === '/stop') res.writeHead(200).end('stopped');
    else if (req.url === '/moved') res.writeHead(302, { location: '/stop' }).end();
    else res.writeHead(500).end();
  });
  return new Promise((ok) => s.listen(0, '127.0.0.1', () => ok({ s, hits, base: `http://127.0.0.1:${s.address().port}` })));
}

// The script as a child process, with its account home (and so the list's key) in the temp folder. HOME and
// USERPROFILE point to a decoy, or to what a test sets them to.
const runCli = (cwd, args, env = {}) =>
  new Promise((ok) =>
    execFile(process.execPath, [...asAccount(keyHome.dir, SCRIPT), ...args], { cwd, timeout: 60_000, env: decoyEnv(keyHome.dir, env) }, (e, stdout, stderr) => ok({ code: e ? e.code : 0, stdout, stderr })),
  );

const usage = (p, pattern) => assert.rejects(p, (e) => e instanceof Refused && e.code === 2 && pattern.test(e.message));

export async function selfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'cut-cut-'));
  const srv = await server();
  const homeWas = keyHome.dir;
  keyHome.dir = tmp; // the temp folder is the home: the key goes in it, and no search for the project's top goes above it
  try {
    const roles = ['writer', 'checker'];
    const base = { roles: roles.join(','), egressPlaces: [], wait: 10 };

    // 1. A project with two own workers, one added with no owner, one owned by a role that is not yours,
    //    and one found running (seen).
    const p = join(tmp, 'project');
    for (const r of roles) mkdirSync(join(p, 'roles', r), { recursive: true });
    const pids = { mine1: job(), mine2: job(), orphan: job(), foreign: job(), found: job() };
    await sleep(300);
    await add(p, 'sync-worker', { owner: 'writer', stop: `pid:${pids.mine1}`, start: 'node workers/sync.mjs' }, roles);
    await add(p, 'check-worker', { owner: 'checker', stop: `pid:${pids.mine2}` }, roles);
    await add(p, 'tmp-worker', { owner: 'none', stop: `pid:${pids.orphan}` }, roles);
    await add(p, 'report-job', { owner: 'ops', stop: `pid:${pids.foreign}` }, roles);
    await seen(p, String(pids.found), { owner: 'none' }, roles);

    // 2. A dry run prints, and stops nothing.
    let lines = [];
    const out = (l) => lines.push(l);
    assert.equal(await cut({ ...base, project: p, orphans: true, 'dry-run': true, out }), 0);
    assert.deepEqual(lines.filter((l) => l.startsWith('would stop')).length, 2);
    if (WIN) assert.ok(lines.filter((l) => l.startsWith('would stop')).every((l) => /· taskkill \/T \/F · [A-Za-z]:\\Windows\\System32\\taskkill\.exe$/i.test(l)), lines.join('\n'));
    assert.ok(lines.includes(`keep: sync-worker · writer (yours) · pid:${pids.mine1}`));
    assert.ok(lines.includes(`found: ${pids.found} · none · pid:${pids.found} · not stopped by --orphans; your human decides, then --job ${pids.found}`), lines.join('\n'));
    assert.ok(lines.includes('dry run: nothing stopped'));
    for (const pid of Object.values(pids)) assert.equal(alive(pid), true);

    // 3. --orphans stops both added jobs that are not yours, by id, and keeps yours running. A job found
    //    running is not one of them: it stops by its id only.
    lines = [];
    assert.equal(await cut({ ...base, project: p, orphans: true, out }), 0, lines.join('\n'));
    assert.equal(alive(pids.orphan), false, 'the job with no owner stopped');
    assert.equal(alive(pids.foreign), false, "the job of a role that is not yours stopped");
    assert.equal(alive(pids.mine1), true, 'your own job keeps running');
    assert.equal(alive(pids.mine2), true, 'your own job keeps running');
    assert.equal(alive(pids.found), true, 'a found job is not stopped by --orphans');
    assert.ok(lines.some((l) => /^quiet in [\d.]+ s$/.test(l)), lines.join('\n'));
    const jobs = loadJobs(p);
    assert.equal(jobs.get('report-job').state, 'stopped');
    assert.equal(jobs.get('sync-worker').state, 'running');
    const cps = readdirSync(join(p, '.reach')).filter((f) => /^cut-.+\.json$/.test(f));
    assert.equal(cps.length, 1);
    const cp = JSON.parse(readFileSync(join(p, '.reach', cps[0]), 'utf8'));
    assert.deepEqual(cp.stopped.map((s) => s.id).sort(), ['report-job', 'tmp-worker']);
    assert.deepEqual(cp.kept.sort(), ['check-worker', 'sync-worker']);
    assert.equal(await cut({ ...base, project: p, job: String(pids.found), out: () => {} }), 0);
    assert.equal(alive(pids.found), false, 'a found job stops by its id');

    // 3b. --orphans with roles that keep none of your jobs is --lane by another name: it asks for --yes.
    const m = join(tmp, 'no-roles');
    mkdirSync(m);
    const minePids = [job(), job()];
    await sleep(300);
    await add(m, 'mine-a', { owner: 'writer', stop: `pid:${minePids[0]}` }, roles);
    await add(m, 'mine-b', { owner: 'writer', stop: `pid:${minePids[1]}` }, roles);
    lines = [];
    assert.equal(await cut({ ...base, roles: 'nobody', project: m, orphans: true, 'dry-run': true, out }), 0);
    assert.ok(lines.includes('keep: none'), lines.join('\n'));
    await usage(cut({ ...base, roles: 'nobody', project: m, orphans: true, out: () => {} }), /keeps none of your jobs, so it stops every job you added: your human adds --yes/);
    assert.deepEqual(minePids.map(alive), [true, true]);

    // 3c. --orphans --roles naming some of the roles in roles/ asks for --yes before it stops a job of another.
    const subset = join(tmp, 'subset');
    mkdirSync(join(subset, 'roles', 'writer'), { recursive: true });
    mkdirSync(join(subset, 'roles', 'checker'));
    await add(subset, 'w1', { owner: 'writer', stop: `url:${srv.base}/stop?w1` }, roles);
    await add(subset, 'c1', { owner: 'checker', stop: `url:${srv.base}/stop?c1` }, roles);
    lines = [];
    assert.equal(await cut({ project: subset, roles: 'checker', orphans: true, 'dry-run': true, out }), 0);
    assert.ok(lines.includes(`keep: c1 · checker (yours) · url:${srv.base}/stop?c1`), lines.join('\n'));
    assert.ok(lines.includes(`asks --yes: w1 · writer · url:${srv.base}/stop?w1 · its owner is a role in roles/`), lines.join('\n'));
    await usage(cut({ project: subset, roles: 'checker', orphans: true, out: () => {} }), /would stop jobs of writer, a role in roles\/: your human adds --yes/);
    assert.equal(srv.hits.length, 0, 'w1 was not stopped');
    lines = [];
    assert.equal(await cut({ project: subset, orphans: true, out }), 0);
    assert.ok(lines.includes('nothing to stop'), lines.join('\n'));

    // 3d. A folder made in roles/ after the line does not make a job yours: its stop asks for --yes.
    const lateRole = join(tmp, 'late-role');
    mkdirSync(join(lateRole, 'roles', 'writer'), { recursive: true });
    await add(lateRole, 'mine', { owner: 'writer', stop: `url:${srv.base}/stop?mine` }, ['writer']);
    await add(lateRole, 'eater', { owner: 'ci', stop: `url:${srv.base}/stop?eater` }, ['writer']);
    assert.equal(loadJobs(lateRole).get('eater').mine, false);
    mkdirSync(join(lateRole, 'roles', 'ci'));
    lines = [];
    assert.equal(await cut({ project: lateRole, orphans: true, 'dry-run': true, out }), 0);
    assert.ok(lines.includes(`keep: mine · writer (yours) · url:${srv.base}/stop?mine`), lines.join('\n'));
    assert.ok(lines.includes(`asks --yes: eater · ci · url:${srv.base}/stop?eater · its owner became one of your roles after the line was written`), lines.join('\n'));
    await usage(cut({ project: lateRole, orphans: true, out: () => {} }), /jobs of ci, whose owner became one of your roles after the line was written: your human adds --yes/);
    await usage(cut({ project: lateRole, roles: 'writer,ci', orphans: true, out: () => {} }), /became one of your roles/);
    assert.equal(srv.hits.length, 0, 'eater was not stopped');
    assert.equal(await cut({ project: lateRole, orphans: true, yes: true, out: () => {} }), 0);
    assert.deepEqual(srv.hits.splice(0), ['POST /stop?eater']);

    // 3e. With no roles/, --roles is the only word on whose jobs are whose: every stop of --orphans asks for --yes.
    const bare = join(tmp, 'bare');
    mkdirSync(bare);
    await add(bare, 'w1', { owner: 'writer', stop: `url:${srv.base}/stop?bw1` }, roles);
    await add(bare, 'c1', { owner: 'checker', stop: `url:${srv.base}/stop?bc1` }, roles);
    lines = [];
    assert.equal(await cut({ project: bare, roles: 'checker', orphans: true, 'dry-run': true, out }), 0);
    assert.ok(lines.includes(`asks --yes: w1 · writer · url:${srv.base}/stop?bw1 · the project has no roles/, so only --roles says whose job this is`), lines.join('\n'));
    await usage(cut({ project: bare, roles: 'checker', orphans: true, out: () => {} }), /the project has no roles\/ to check --roles against: your human adds --yes/);
    assert.equal(srv.hits.length, 0, 'w1 was not stopped');

    // 4. Only ids on the list; a stopped job is not stopped again; --lane asks for --yes.
    await usage(cut({ ...base, project: p, job: 'not-on-the-list', out: () => {} }), /^not on the list: not-on-the-list/);
    await usage(cut({ ...base, project: p, job: 'report-job', out: () => {} }), /not on the list/);
    await usage(cut({ ...base, project: p, out: () => {} }), /name one of/);
    await usage(cut({ ...base, project: p, job: 'x', orphans: true, out: () => {} }), /name one of/);
    lines = [];
    await usage(cut({ ...base, project: p, lane: true, out }), /your human adds --yes/);
    assert.equal(lines.length, 2, 'it prints the list first');
    assert.equal(alive(pids.mine1), true);
    const cli = await runCli(p, ['--job', '../../etc', '--roles', 'writer']);
    assert.equal(cli.code, 2);
    assert.match(cli.stderr, /^not on the list: \.\.\/\.\.\/etc/);

    // 5. Never this script, its parent, or a system pid, even when the list names them.
    const g = join(tmp, 'guarded');
    mkdirSync(g);
    await add(g, 'me', { owner: 'ops', stop: `pid:${process.pid}` }, roles);
    await add(g, 'my-parent', { owner: 'ops', stop: `pid:${process.ppid}` }, roles);
    record(g, { event: 'added', id: 'system', owner: 'ops', stop: 'pid:4', born: 'x:1' }, roles);
    lines = [];
    assert.equal(await cut({ ...base, project: g, orphans: true, yes: true, out, wait: 1 }), 1);
    assert.equal(lines.filter((l) => /^not stopped: .+ is this script, its harness or a system process/.test(l)).length, 3, lines.join('\n'));
    assert.ok(protectedPids().has(process.ppid));

    // 5b. A pid the system gave to another process is not stopped: the line's start time no longer matches.
    //     The list line is signed as reach.mjs writes it, with the start time of an earlier process.
    const reused = join(tmp, 'reused');
    mkdirSync(reused);
    const later = job();
    await sleep(300);
    const bornLater = (await processTable()).get(later).born;
    record(reused, { event: 'added', id: 'old-worker', owner: 'ops', stop: `pid:${later}`, born: `${bornLater}0` }, roles);
    const listed = join(reused, '.reach', 'jobs.jsonl');
    lines = [];
    assert.equal(await cut({ ...base, project: reused, job: 'old-worker', 'dry-run': true, out }), 0);
    assert.ok(lines.some((l) => l.startsWith('would not stop: old-worker') && l.includes(`pid ${later} is another process now`)), lines.join('\n'));
    lines = [];
    assert.equal(await cut({ ...base, project: reused, job: 'old-worker', out, wait: 1 }), 1);
    assert.ok(lines.some((l) => l.startsWith('not stopped: old-worker') && l.includes('is another process now')), lines.join('\n'));
    assert.equal(alive(later), true, 'the process that has the pid now keeps running');
    //     A line no one signed is not a stop order.
    writeFileSync(listed, `${JSON.stringify({ at: 'x', event: 'added', id: 'build-cache', owner: 'ci', stop: `pid:${later}`, born: bornLater, seq: 1, prev: '' })}\n`);
    await assert.rejects(cut({ ...base, project: reused, orphans: true, out: () => {} }), /line 1 was not written by reach\.mjs/);
    assert.equal(alive(later), true);

    // 5b2. The start time is read again just before the signal: the list read before the stops can be old.
    //      Here that earlier read (a stand-in table) agrees with the line, and the system does not.
    const late = join(tmp, 'late');
    mkdirSync(late);
    const lp = job();
    await sleep(300);
    record(late, { event: 'added', id: 'late', owner: 'ops', stop: `pid:${lp}`, born: 'x:stale' }, roles);
    lines = [];
    assert.equal(await cut({ ...base, project: late, job: 'late', table: new Map([[lp, { ppid: 0, born: 'x:stale' }]]), out, wait: 1 }), 1);
    assert.ok(lines.some((l) => l.startsWith('not stopped: late') && l.includes(`pid ${lp} is another process now`)), lines.join('\n'));
    assert.equal(alive(lp), true, 'the process that has the pid now keeps running');

    // 5c. A stop takes the whole tree, so it is refused when the tree holds a job kept running.
    //     A foreign `stray` (a child of this test) started `my-worker`, which is yours.
    const tree = join(tmp, 'tree');
    mkdirSync(tree);
    const stray = spawn(process.execPath, ['-e', "const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); console.log(c.pid); setInterval(() => {}, 1000);"], { stdio: ['ignore', 'pipe', 'ignore'], detached: !WIN, windowsHide: true });
    children.push(stray);
    const worker = Number(await new Promise((ok) => stray.stdout.once('data', (d) => ok(String(d).trim()))));
    extra.push(worker);
    await sleep(300);
    await seen(tree, 'stray', { owner: 'none', stop: `pid:${stray.pid}` }, roles);
    await add(tree, 'my-worker', { owner: 'writer', stop: `pid:${worker}` }, roles);
    lines = [];
    assert.equal(await cut({ ...base, project: tree, job: 'stray', out, wait: 1 }), 1);
    assert.ok(lines.some((l) => l.startsWith('not stopped: stray') && l.includes(`its tree holds my-worker · writer (yours) · pid:${worker}`)), lines.join('\n'));
    assert.equal(alive(worker), true, 'your job keeps running');
    assert.equal(alive(stray.pid), true);
    //     With my-worker's line deleted, the list is refused whole: the tree check never loses a kept job.
    const treeList = join(tree, '.reach', 'jobs.jsonl');
    writeFileSync(treeList, `${readFileSync(treeList, 'utf8').split('\n')[0]}\n`);
    await assert.rejects(cut({ ...base, project: tree, job: 'stray', out: () => {}, wait: 1 }), /changed outside reach\.mjs; nothing stopped/);
    assert.equal(alive(worker) && alive(stray.pid), true, 'both keep running');

    // 5d. Never a job above this script: the chain is G (a stand-in terminal) → H (a stand-in harness) →
    //     cut.mjs, with G on the list. All three are children of this test.
    const chain = join(tmp, 'chain');
    mkdirSync(chain);
    const h = `const c = require('child_process').spawn(process.execPath, [...${JSON.stringify(asAccount(tmp, SCRIPT))}, '--job', 'shell', '--roles', 'writer'], { stdio: 'inherit', cwd: ${JSON.stringify(chain)} }); c.on('exit', (code) => process.exit(code ?? 9));`;
    const gScript = `process.stdin.once('data', () => { const c = require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(h)}], { stdio: ['ignore', 'inherit', 'inherit'] }); c.on('exit', (code) => process.exit(code ?? 9)); });`;
    const g2 = spawn(process.execPath, ['-e', gScript], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: decoyEnv(tmp) });
    children.push(g2);
    let said = '';
    g2.stdout.on('data', (d) => (said += d));
    g2.stderr.on('data', (d) => (said += d));
    await sleep(300);
    await seen(chain, 'shell', { owner: 'none', stop: `pid:${g2.pid}` }, roles);
    const code = await new Promise((ok) => {
      g2.on('exit', ok);
      g2.stdin.write('go\n');
    });
    assert.equal(code, 1, said);
    assert.match(said, /not stopped: shell · none · pid:\d+ · pid \d+ is this script, its harness or a system process/, said);
    assert.equal(loadJobs(chain).get('shell').state, 'found');

    // 5e. HOME and USERPROFILE do not pick the key or rook-clock: a project can set them for its harness,
    //     and ship a key it knows, lines signed with it, and its own egress.mjs. The CLI runs as a child
    //     whose account home is the temp folder; the project sets HOME and USERPROFILE to its own folders.
    const plantedKey = Buffer.from('ab'.repeat(32), 'hex');
    const plantHome = (proj) => {
      mkdirSync(join(proj, '.git'), { recursive: true });
      mkdirSync(join(proj, 'h', '.rook-cut'), { recursive: true });
      writeFileSync(join(proj, 'h', '.rook-cut', 'key'), plantedKey.toString('hex'));
      mkdirSync(join(proj, '.reach'));
      return realpathSync.native(proj);
    };
    const n1a = join(tmp, 'n1a');
    const rootA = plantHome(n1a);
    writeFileSync(join(n1a, '.reach', 'jobs.jsonl'), signedLine(plantedKey, rootA, { at: 'x', event: 'added', id: 'hook', owner: 'ci', stop: `url:${srv.base}/stop?n1a`, seq: 1, prev: '' }));
    const homeEnv = (dir) => ({ HOME: dir, USERPROFILE: dir });
    let r = await runCli(n1a, ['--job', 'hook'], homeEnv(join(n1a, 'h')));
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /line 1 was not written by reach\.mjs on this computer/);
    assert.equal(srv.hits.includes('POST /stop?n1a'), false, 'the planted url stop sent nothing');
    const n1b = join(tmp, 'n1b');
    const rootB = plantHome(n1b);
    writeFileSync(join(n1b, '.reach', 'jobs.jsonl'), signedLine(plantedKey, rootB, { at: 'x', event: 'added', id: 'defrag', owner: 'ci', stop: 'task:\\CutSelfTest\\NoSuchTask', seq: 1, prev: '' }));
    r = await runCli(n1b, ['--job', 'defrag', '--dry-run'], homeEnv(join(n1b, 'h')));
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /would stop/);
    //     From app/ with HOME = the project: the top is still the project, and its planted egress.mjs (with a
    //     copy of this account's key next to it) never runs. A list in app/ is not the project's list.
    const n1c = join(tmp, 'n1c');
    mkdirSync(join(n1c, '.git'), { recursive: true });
    mkdirSync(join(n1c, 'app', '.reach'), { recursive: true });
    mkdirSync(join(n1c, '.rook-cut'));
    writeFileSync(join(n1c, '.rook-cut', 'key'), keyOf().toString('hex'));
    const ranMark = join(tmp, 'n1c-egress-ran.txt');
    const clockC = join(n1c, '.claude', 'skills', 'rook-clock');
    mkdirSync(join(clockC, 'scripts'), { recursive: true });
    writeFileSync(join(clockC, 'SKILL.md'), '---\nname: rook-clock\n---\n');
    writeFileSync(join(clockC, 'scripts', 'egress.mjs'), `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(ranMark)}, 'ran');\nexport const hostLists = () => new Map();\nexport async function send() { return { status: 200, hops: [{ hop: 1, status: 200 }] }; }\n`);
    writeFileSync(join(n1c, 'app', '.reach', 'jobs.jsonl'), signedLine(keyOf(), realpathSync.native(join(n1c, 'app')), { at: 'x', event: 'added', id: 'hook', owner: 'ci', stop: `url:${srv.base}/stop?k={{STOP_KEY}}`, seq: 1, prev: '' }));
    r = await runCli(join(n1c, 'app'), ['--job', 'hook'], { ...homeEnv(n1c), STOP_KEY: 'sk-FAKE-cut-selftest-0001' });
    assert.notEqual(r.code, 0, r.stdout + r.stderr);
    assert.equal(existsSync(ranMark), false, 'the planted egress.mjs did not run');
    //     Nor one in a folder above the top that holds .git: a project folder too.
    const n1d = join(tmp, 'n1d');
    mkdirSync(join(n1d, '.git'), { recursive: true });
    mkdirSync(join(n1d, 'sub', '.reach'), { recursive: true });
    await add(join(n1d, 'sub'), 'hook', { owner: 'ci', stop: `url:${srv.base}/stop?k={{STOP_KEY}}` }, roles);
    const clockD = join(n1d, '.claude', 'skills', 'rook-clock');
    mkdirSync(join(clockD, 'scripts'), { recursive: true });
    writeFileSync(join(clockD, 'SKILL.md'), '---\nname: rook-clock\n---\n');
    writeFileSync(join(clockD, 'scripts', 'egress.mjs'), readFileSync(join(clockC, 'scripts', 'egress.mjs')));
    lines = [];
    assert.equal(await cut({ ...base, project: join(n1d, 'sub'), job: 'hook', egressPlaces: [join(clockD, 'scripts', 'egress.mjs')], out, wait: 1 }), 1);
    assert.ok(lines.some((l) => l.startsWith('not stopped: hook') && l.includes('install rook-clock')), lines.join('\n'));
    assert.equal(existsSync(ranMark), false, 'the egress.mjs above the top did not run');

    // 5f. A lock held by another run, or left behind, refuses before any stop: never a stop it cannot record.
    const locked = join(tmp, 'locked');
    mkdirSync(locked);
    await add(locked, 'w2', { owner: 'ci', stop: `url:${srv.base}/stop?w2` }, roles);
    assert.equal(existsSync(join(locked, '.reach', 'jobs.lock')), false, 'add leaves no lock');
    writeFileSync(join(locked, '.reach', 'jobs.lock'), '');
    await assert.rejects(cut({ ...base, project: locked, job: 'w2', out: () => {}, wait: 1 }), (e) => e instanceof Refused && /^the reach list is locked by another run: .*jobs.lock; nothing stopped/.test(e.message));
    assert.equal(srv.hits.includes('POST /stop?w2'), false, 'nothing was sent');
    assert.equal(loadJobs(locked).get('w2').state, 'running');
    assert.equal(readdirSync(join(locked, '.reach')).some((x) => /^cut-/.test(x)), false, 'no checkpoint');
    rmSync(join(locked, '.reach', 'jobs.lock'));
    assert.equal(await cut({ ...base, project: locked, job: 'w2', out: () => {}, wait: 1 }), 0);
    assert.equal(loadJobs(locked).get('w2').state, 'stopped', 'the stop is recorded under the held lock');
    assert.equal(existsSync(join(locked, '.reach', 'jobs.lock')), false, 'the lock is let go');
    srv.hits.splice(0);

    // 6. url stops: one POST, 2xx is stopped, a redirect is not followed, a secret needs rook-clock.
    const u = join(tmp, 'urls');
    mkdirSync(u);
    await add(u, 'svc', { owner: 'ops', stop: `url:${srv.base}/stop` }, roles);
    await add(u, 'moved', { owner: 'ops', stop: `url:${srv.base}/moved` }, roles);
    await add(u, 'keyed', { owner: 'ops', stop: `url:${srv.base}/stop?key={{STOP_KEY}}` }, roles);
    lines = [];
    assert.equal(await cut({ ...base, project: u, orphans: true, yes: true, out, wait: 1 }), 1);
    assert.ok(lines.includes(`stopped: svc · ops · url:${srv.base}/stop · POST: 200`), lines.join('\n'));
    assert.ok(lines.some((l) => l.startsWith('not stopped: moved') && l.includes('a redirect is not followed')));
    assert.ok(lines.some((l) => l.startsWith('not stopped: keyed') && l.includes('install rook-clock')));
    assert.deepEqual(srv.hits, ['POST /stop', 'POST /moved'], 'the keyed stop sent nothing, the redirect was not followed');
    assert.match(lines.at(-2), /^still running: moved, keyed$/);
    //    A stop already done is never sent again: svc's added line, replayed at the end, refuses the list.
    const uList = join(u, '.reach', 'jobs.jsonl');
    const uGood = readFileSync(uList, 'utf8');
    writeFileSync(uList, `${uGood}${uGood.split('\n')[0]}\n`);
    await assert.rejects(cut({ ...base, project: u, orphans: true, yes: true, out: () => {}, wait: 1 }), /changed outside reach\.mjs; nothing stopped/);
    assert.deepEqual(srv.hits, ['POST /stop', 'POST /moved'], 'no second POST');
    writeFileSync(uList, uGood);
    //    With rook-clock: the request goes through its egress as written, {{NAME}} and all.
    //    A stand-in egress, laid out as rook-clock is: rook-clock/scripts/egress.mjs with rook-clock/SKILL.md.
    //    Like rook-clock, it follows a redirect: /moved answers 302, then 200.
    const clock = join(tmp, '.claude', 'skills', 'rook-clock'); // in the account home: the temp folder
    mkdirSync(join(clock, 'scripts'), { recursive: true });
    writeFileSync(join(clock, 'SKILL.md'), '---\nname: rook-clock\n---\n');
    const fake = join(clock, 'scripts', 'egress.mjs');
    writeFileSync(
      fake,
      'export const hostLists = (j) => new Map(Object.entries(j));\n' +
        'export async function send(request, options) { globalThis.cutEgressCalls = [...(globalThis.cutEgressCalls ?? []), { request, options }]; ' +
        'return request.url.includes("/moved") ? { status: 200, hops: [{ hop: 1, status: 302 }, { hop: 2, status: 200 }] } : { status: 204, hops: [{ hop: 1, status: 204 }] }; }\n',
    );
    writeFileSync(join(u, 'hosts.json'), JSON.stringify({ STOP_KEY: [srv.base] }));
    lines = [];
    assert.equal(await cut({ ...base, project: u, job: 'keyed', egress: fake, egressPlaces: undefined, 'dry-run': true, out }), 0);
    assert.ok(lines.includes(`would stop: keyed · ops · url:${srv.base}/stop?key={{STOP_KEY}} · POST through rook-clock · ${realpathSync.native(fake)} · STOP_KEY may go to ${srv.base} (${join(u, 'hosts.json')})`), lines.join('\n'));
    lines = [];
    assert.equal(await cut({ ...base, project: u, job: 'keyed', egress: fake, egressPlaces: undefined, out, wait: 1 }), 0, lines.join('\n'));
    assert.deepEqual(globalThis.cutEgressCalls.map((c) => [c.request.method, c.request.url]), [['POST', `${srv.base}/stop?key={{STOP_KEY}}`]]);
    assert.deepEqual(globalThis.cutEgressCalls[0].options.hosts, { STOP_KEY: [srv.base] });
    //    A redirect rook-clock followed is not a stop.
    await add(u, 'keyed-moved', { owner: 'ops', stop: `url:${srv.base}/moved?key={{STOP_KEY}}` }, roles);
    lines = [];
    assert.equal(await cut({ ...base, project: u, job: 'keyed-moved', egress: fake, egressPlaces: undefined, out, wait: 1 }), 1);
    assert.ok(lines.some((l) => l.startsWith('not stopped: keyed-moved') && l.includes('hop 1 answered 302, a redirect, and rook-clock followed it; not counted as stopped')), lines.join('\n'));
    assert.equal(loadJobs(u).get('keyed-moved').state, 'running');
    //    --egress that is not rook-clock's file is refused before it is imported: its top level never runs.
    const mark = join(tmp, 'egress-ran.txt');
    const other = join(tmp, 'e.mjs');
    writeFileSync(other, `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(mark)}, 'ran');\nexport const send = () => ({ status: 200 });\nexport const hostLists = () => new Map();\n`);
    await usage(cut({ ...base, project: u, job: 'keyed-moved', egress: other, egressPlaces: undefined, out: () => {} }), /is not rook-clock in a home skills folder .+ nothing of it ran/);
    assert.equal(existsSync(mark), false, 'its top level did not run');
    //    Nor a file laid out as rook-clock is, in a folder that is not a home skills folder (here the temp
    //    folder, outside the project): --egress takes rook-clock as installed for this account only.
    const lookalike = join(tmp, 'y', 'rook-clock');
    mkdirSync(join(lookalike, 'scripts'), { recursive: true });
    writeFileSync(join(lookalike, 'SKILL.md'), '---\nname: rook-clock\n---\n');
    writeFileSync(join(lookalike, 'scripts', 'egress.mjs'), readFileSync(other));
    await usage(cut({ ...base, project: u, job: 'keyed-moved', egress: join(lookalike, 'scripts', 'egress.mjs'), egressPlaces: undefined, out: () => {} }), /is not rook-clock in a home skills folder .+ nothing of it ran/);
    assert.equal(existsSync(mark), false, 'the look-alike did not run');
    //    Never an egress.mjs from inside the project, and none that is not there.
    await add(u, 'keyed2', { owner: 'ops', stop: `url:${srv.base}/stop?key={{STOP_KEY}}` }, roles);
    const planted = join(u, '.claude', 'skills', 'rook-clock', 'scripts', 'egress.mjs');
    mkdirSync(join(planted, '..'), { recursive: true });
    writeFileSync(planted, readFileSync(fake));
    writeFileSync(join(planted, '..', '..', 'SKILL.md'), '---\nname: rook-clock\n---\n');
    await usage(cut({ ...base, project: u, job: 'keyed2', egress: planted, out: () => {} }), /inside the project/);
    await usage(cut({ ...base, project: u, job: 'keyed2', egress: join(tmp, 'nope.mjs'), out: () => {} }), /no file/);
    lines = [];
    assert.equal(await cut({ ...base, project: u, job: 'keyed2', egressPlaces: [planted], out, wait: 1 }), 1);
    assert.ok(lines.some((l) => l.includes('install rook-clock')), 'a planted egress in the project is skipped');
    assert.equal(globalThis.cutEgressCalls.length, 2);
    //    From a subfolder too: "inside the project" is its top folder, and the list is the top's list.
    const sub = join(u, 'app');
    mkdirSync(sub);
    await usage(cut({ ...base, project: sub, job: 'keyed2', egress: planted, out: () => {} }), /inside the project/);
    lines = [];
    assert.equal(await cut({ ...base, project: sub, job: 'keyed2', egressPlaces: [planted], out, wait: 1 }), 1);
    assert.ok(lines.some((l) => l.startsWith('not stopped: keyed2') && l.includes('install rook-clock')), lines.join('\n'));
    assert.equal(globalThis.cutEgressCalls.length, 2, 'the planted egress did not run from app/ either');
    assert.equal(existsSync(join(sub, '.reach')), false, 'no second list in app/');

    // 7. task stops: schtasks from System32 only; here a stand-in, so no real task is touched.
    if (WIN) assert.match(systemTools({ SystemRoot: 'C:\\Windows' }, { platform: 'win32' }).schtasks[0], /^C:\\Windows[\\/]System32[\\/]schtasks\.exe$/i);
    //    A %SystemRoot% the project set is not used: a planted System32\taskkill.exe never runs.
    const fakeWin = join(tmp, 'fakewin');
    mkdirSync(join(fakeWin, 'System32'), { recursive: true });
    writeFileSync(join(fakeWin, 'System32', 'taskkill.exe'), '');
    const plantedTools = systemTools({ SystemRoot: fakeWin }, { platform: 'win32' });
    for (const name of ['taskkill', 'schtasks', 'powershell']) assert.match(plantedTools[name].why, /is not the Windows folder of this computer; not stopped/, name);
    if (WIN) {
      const h = join(tmp, 'sysroot');
      mkdirSync(h);
      const stray = job();
      await sleep(300);
      await add(h, 'stray', { owner: 'none', stop: `pid:${stray}` }, roles);
      lines = [];
      assert.equal(await cut({ ...base, project: h, job: 'stray', platform: 'win32', tools: plantedTools, table: await processTable(), out, wait: 1 }), 1);
      assert.ok(lines.some((l) => l.startsWith('not stopped: stray') && l.includes('taskkill: %SystemRoot%')), lines.join('\n'));
      assert.equal(alive(stray), true, 'nothing ran');
    }
    const t = join(tmp, 'tasks');
    mkdirSync(t);
    const log = join(tmp, 'schtasks-calls.jsonl');
    const fakeTasks = join(tmp, 'fake-schtasks.mjs');
    writeFileSync(
      fakeTasks,
      "import { appendFileSync } from 'node:fs';\n" +
        `appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');\n` +
        "if (process.argv[2] === '/Query') console.log('\"\\\\\\\\Jobs\\\\\\\\Report Job\",\"N/A\",\"Disabled\"');\n",
    );
    await add(t, 'nightly', { owner: 'ops', stop: 'task:\\Jobs\\Report Job' }, roles);
    lines = [];
    const tools = { schtasks: [process.execPath, [fakeTasks]], taskkill: [process.execPath, ['-e', 'process.exit(9)']] };
    assert.equal(await cut({ ...base, project: t, job: 'nightly', platform: 'win32', tools, out, wait: 1 }), 0, lines.join('\n'));
    const calls = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(calls.map((c) => c[0]), ['/End', '/Change', '/Query']);
    assert.deepEqual(calls[1], ['/Change', '/TN', '\\Jobs\\Report Job', '/DISABLE'], 'the name is one argument, never a shell line');
    await add(t, 'cron-job', { owner: 'ops', stop: 'task:CronJob' }, roles);
    lines = [];
    assert.equal(await cut({ ...base, project: t, job: 'cron-job', platform: 'linux', out, wait: 1 }), 1);
    assert.ok(lines.some((l) => l.includes('Windows Task Scheduler only')));

    // 8. --lane --yes stops every job on the list, yours too.
    lines = [];
    assert.equal(await cut({ ...base, project: p, lane: true, yes: true, out }), 0, lines.join('\n'));
    assert.equal(alive(pids.mine1), false);
    assert.equal(alive(pids.mine2), false);
  } finally {
    keyHome.dir = homeWas;
    for (const pid of [...children.map((c) => c.pid), ...extra]) {
      try {
        if (alive(pid)) process.kill(pid, 'SIGKILL');
      } catch {}
    }
    srv.s.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}
