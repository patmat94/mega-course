// reach.selftest.mjs · the checks behind `node reach.mjs --self-test`. Your agent does not run this file.
// Offline: a project in a temp folder, and the script run as a child process. Leaves no file behind.

import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accountHome, add, checkId, checkOwner, isMine, isNoOwner, keyHome, keyOf, keyPath, loadJobs, main, parseStop, projectTop, reachDir, record, Refused, rolesOf, seen, signedLine } from './reach.mjs';

const SCRIPT = fileURLToPath(new URL('./reach.mjs', import.meta.url));

const WIN = process.platform === 'win32';
/**
 * node's arguments for a script run as a child whose account home is `home`: os.userInfo() answers it, the
 * way the system would. HOME and USERPROFILE are not how the scripts find a home, so they never set it.
 */
export const asAccount = (home, script) => [
  '--input-type=module',
  '-e',
  `import os from 'node:os'; import { syncBuiltinESMExports } from 'node:module'; import { pathToFileURL } from 'node:url'; const u = os.userInfo; os.userInfo = (o) => ({ ...u(o), homedir: ${JSON.stringify(home)} }); syncBuiltinESMExports(); await import(pathToFileURL(process.argv[1]).href);`,
  '--',
  script,
];
/** HOME and USERPROFILE for a child: a decoy folder, never the real home, whatever reads them. */
export const decoyEnv = (home, more = {}) => ({ ...process.env, HOME: join(home, 'env-home'), USERPROFILE: join(home, 'env-home'), ...more });
// The script as a child process, with its account home (and so its key) in the temp folder.
const run = (cwd, args) =>
  new Promise((ok) =>
    execFile(process.execPath, [...asAccount(keyHome.dir, SCRIPT), ...args], { cwd, timeout: 30_000, env: decoyEnv(keyHome.dir) }, (e, stdout, stderr) => ok({ code: e ? e.code : 0, stdout, stderr })),
  );

// Stand-in jobs: node child processes this test starts, and stops at the end.
const children = [];
function job() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: !WIN, windowsHide: true });
  children.push(child);
  return child.pid;
}

const throwsCode = (fn, code, pattern) =>
  assert.throws(fn, (e) => e instanceof Refused && e.code === code && (!pattern || pattern.test(e.message)), `expected a refusal ${code} ${pattern ?? ''}`);

export async function selfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'cut-reach-'));
  const homeWas = keyHome.dir;
  keyHome.dir = tmp; // the temp folder is the home: the key goes in it, and no search for the project's top goes above it
  try {
    // 1. What a line may hold.
    for (const bad of ['', '../x', 'a/b', 'a;b', 'a b', '-x', 'con', 'NUL.txt', 'x.', 'a'.repeat(65), 'a\u001b[2Jb']) throwsCode(() => checkId(bad), 2);
    assert.equal(checkId('sync-worker'), 'sync-worker');
    for (const none of ['none', '', 'null', '-', '—', ' NONE ']) assert.equal(isNoOwner(none), true, none);
    assert.equal(checkOwner('—'), 'none');
    assert.equal(checkOwner('ops/lint'), 'ops/lint');
    throwsCode(() => checkOwner('writer; rm'), 2);
    throwsCode(() => checkOwner(undefined), 2, /--owner is required/);
    assert.deepEqual(parseStop('pid:4120'), { kind: 'pid', pid: 4120 });
    assert.deepEqual(parseStop('task:\\Jobs\\Report Job'), { kind: 'task', name: '\\Jobs\\Report Job' });
    assert.deepEqual(parseStop('url:https://jobs.example.com/stop?id=7'), { kind: 'url', url: 'https://jobs.example.com/stop?id=7' });
    assert.equal(parseStop('url:http://127.0.0.1:8080/stop').kind, 'url');
    for (const bad of ['pid:0', 'pid:-1', 'pid:1e3', 'pid:4294967296', 'pid:12 34', 'task:a&b', 'task:"x"', 'task:..\\x', 'task:a|b', 'task:x.', 'url:http://jobs.example.com/stop', 'url:ftp://x/y', 'url:https://u:p@x.example.com/', 'url:https://{{KEY}}.example.com/', 'url:not a url', 'kill:1', 'pid:', 'url:https://x.example.com/\u202Estop', 'url:https://x.example.com/a\u200Bb']) {
      throwsCode(() => parseStop(bad), 2);
    }

    // 2. add, seen and list, with REACH.md written from the list.
    const p = join(tmp, 'project');
    mkdirSync(join(p, 'roles', 'writer'), { recursive: true });
    mkdirSync(join(p, 'roles', 'checker'));
    const roles = rolesOf(p);
    assert.deepEqual(roles, ['checker', 'writer']);
    assert.deepEqual(rolesOf(p, 'writer, ops'), ['writer', 'ops']);
    throwsCode(() => rolesOf(p, 'none'), 2);
    throwsCode(() => rolesOf(p, ','), 2);
    const pid = { sync: job(), found: job(), claims: job() };
    const F = String(pid.found);
    await add(p, 'sync-worker', { owner: 'writer', stop: `pid:${pid.sync}`, start: 'node workers/sync.mjs' }, roles);
    await add(p, 'report-job', { owner: 'ops', stop: 'task:ReportJob' }, roles);
    await seen(p, F, { owner: 'none', note: 'found in the process list' }, roles);
    await seen(p, 'claims-mine', { owner: 'writer', stop: `pid:${pid.claims}` }, roles);
    const jobs = loadJobs(p);
    assert.deepEqual([...jobs.keys()], ['sync-worker', 'report-job', F, 'claims-mine']);
    assert.equal(jobs.get(F).stop.pid, pid.found, 'a seen pid id is its own stop');
    assert.equal(jobs.get(F).state, 'found');
    assert.match(jobs.get('sync-worker').born, /^(win|linux|ps):/, 'a pid line holds when the process started');
    assert.equal(jobs.get('report-job').born, undefined);
    assert.equal(isMine(jobs.get('sync-worker'), roles), true);
    assert.equal(isMine(jobs.get('report-job'), roles), false, 'a role that is not yours');
    assert.equal(isMine(jobs.get(F), roles), false, 'no owner');
    assert.equal(isMine(jobs.get('claims-mine'), roles), false, 'a seen job is never yours, whatever owner it reports');
    const view = readFileSync(join(p, 'REACH.md'), 'utf8');
    assert.ok(view.includes(`| sync-worker | writer (yours) | running | pid:${pid.sync} | \`node workers/sync.mjs\` |`), view);
    assert.ok(view.includes(`| claims-mine | writer | found | pid:${pid.claims} |`), view);
    const pack = realpathSync.native(fileURLToPath(new URL('..', import.meta.url))).replace(/[\\/]$/, '').replace(/\\/g, '/');
    assert.ok(view.includes(`Stop one: \`node "${pack}/scripts/cut.mjs" --job <id>\`, first with \`--dry-run\`.`), view);
    assert.equal(readFileSync(join(p, '.reach', '.gitignore'), 'utf8'), '*\n', '.reach/ stays out of version control');
    await assert.rejects(add(p, 'gone', { owner: 'writer', stop: 'pid:2147483646' }, roles), /not running here/, 'a pid that does not run is not written');
    assert.equal(jobs.get('sync-worker').foundThenAdded, false, 'a pid this session started is not found then added');
    //    A pid this session did not start (its parents lead elsewhere) is a found job: added only with --note,
    //    and the line says so.
    const fp = join(tmp, 'found-pid');
    mkdirSync(fp);
    const elsewhere = { table: new Map([[4242424, { ppid: 4242423, born: 'win:7' }], [4242423, { ppid: 1, born: 'win:6' }]]) };
    await assert.rejects(add(fp, 'other', { owner: 'ops', stop: 'pid:4242424', ...elsewhere }, roles), (e) => e.code === 2 && /^pid 4242424 was not started under this session: found then added needs --note/.test(e.message));
    assert.equal(loadJobs(fp).has('other'), false);
    await add(fp, 'other', { owner: 'ops', stop: 'pid:4242424', note: 'my human: it is ops', ...elsewhere }, roles);
    assert.equal(loadJobs(fp).get('other').foundThenAdded, true);
    assert.ok(readFileSync(join(fp, 'REACH.md'), 'utf8').includes('| other | ops | running (found then added) | pid:4242424 |'));
    const saidOther = [];
    await main(['list'], { project: fp, out: (l) => saidOther.push(l) });
    assert.ok(saidOther.includes('other · ops · running · found then added · pid:4242424 · note "my human: it is ops"'), saidOther.join('\n'));

    // 3. No second line for a job that is on the list; seen never changes an owner.
    const rejects = (promise, code, pattern) => assert.rejects(promise, (e) => e instanceof Refused && e.code === code && pattern.test(e.message));
    await rejects(add(p, 'sync-worker', { owner: 'writer', stop: 'pid:1' }, roles), 2, /already on the list/);
    await rejects(seen(p, 'report-job', { owner: 'writer', stop: 'pid:9' }, roles), 2, /never changes a job's owner/);
    await rejects(add(p, 'x', { owner: 'writer' }, roles), 2, /--stop is required/);
    await rejects(add(p, 'x', { owner: 'writer', stop: 'pid:9', note: 'a\nb' }, roles), 2, /--note/);

    const s3 = join(tmp, 'secrets');
    mkdirSync(s3);
    // 3b. No secret written out in a url: stop or a --start line: by its name=value, or by a value this
    //     computer holds (an environment variable whose name says secret, or a name in hosts.json).
    await rejects(add(s3, 'lit', { owner: 'writer', stop: 'url:https://hooks.example.com/stop?token=ghp_LITERALVALUE0001' }, roles), 2, /--stop: a secret value is written out \(token\)/);
    await rejects(add(s3, 'lit', { owner: 'writer', stop: 'task:Lit', start: 'API_KEY=sk-live-0001 node w.mjs' }, roles), 2, /--start: a secret value is written out \(API_KEY\)/);
    await rejects(seen(s3, 'lit', { owner: 'none', stop: 'url:https://hooks.example.com/stop?password=hunter22' }, roles), 2, /a secret value is written out/);
    process.env.CUT_SELFTEST_TOKEN = 'Zq8vLw2xKp4Rt7Yb';
    process.env.CUT_SELFTEST_WEATHER = 'weatherValue123';
    writeFileSync(join(s3, 'hosts.json'), JSON.stringify({ CUT_SELFTEST_WEATHER: ['https://wx.example.com'] }));
    try {
      await rejects(add(s3, 'lit', { owner: 'writer', stop: 'url:https://hooks.example.com/stop/Zq8vLw2xKp4Rt7Yb' }, roles), 2, /\(CUT_SELFTEST_TOKEN\)/);
      await rejects(add(s3, 'lit', { owner: 'writer', stop: 'task:Lit', start: 'node w.mjs weatherValue123' }, roles), 2, /\(CUT_SELFTEST_WEATHER\)/);
    } finally {
      delete process.env.CUT_SELFTEST_TOKEN;
      delete process.env.CUT_SELFTEST_WEATHER;
      rmSync(join(s3, 'hosts.json'));
    }
    await add(s3, 'named', { owner: 'writer', stop: 'url:https://hooks.example.com/stop?key={{STOP_KEY}}', start: 'API_KEY=$API_KEY node w.mjs' }, roles);

    // 3c. A note is printed in quotes, so it cannot fake the fields after it.
    const said = [];
    await main(['add', 'n', '--owner', 'none', '--stop', 'task:N', '--note', 'ok · writer (yours) · running'], { project: s3, out: (l) => said.push(l) });
    assert.deepEqual(said, ['added: n · none · running · task:N · note "ok · writer (yours) · running"']);

    // 4. The command line: steering text is shown, not obeyed; JSON for scripts; usage errors exit 2.
    const listed = await run(p, ['list', '--json']);
    assert.equal(listed.code, 0);
    const json = JSON.parse(listed.stdout);
    assert.deepEqual(json.roles, ['checker', 'writer']);
    assert.deepEqual(json.jobs.map((j) => [j.id, j.yours]), [['sync-worker', true], ['report-job', false], [F, false], ['claims-mine', false]]);
    await assert.rejects(main(['add', 'esc', '--owner', 'writer', '--stop', 'task:Esc', '--note', 'ok\u001b[2J'], { project: p, out: () => {} }), /--note: one line/);
    const plain = await run(p, ['list']);
    assert.equal(plain.code, 0);
    assert.ok(plain.stdout.split(/\r?\n/).includes(`sync-worker · writer (yours) · running · pid:${pid.sync}`), plain.stdout);
    assert.match(plain.stdout, /^your roles: checker, writer$/m);
    assert.equal((await run(p, ['seen', 'x', '--owner', 'none', '--stop', 'pid:3', '--start', 'evil'])).code, 2);
    assert.equal((await run(p, ['remove', 'x'])).code, 2);
    const bad = await run(p, ['add', 'a\u001b]0;x\u0007', '--owner', 'w', '--stop', 'pid:1']);
    assert.equal(bad.code, 2);
    assert.doesNotMatch(bad.stderr, /\u001b/, 'no raw escape reaches the terminal');

    // 5. A line reach.mjs did not write is refused, and with it the whole list: a well-formed line with no
    //    MAC, a list copied from another folder, a signed line that does not check out, a second line for a job.
    const q = join(tmp, 'hand');
    mkdirSync(join(q, '.reach'), { recursive: true });
    const list = join(q, '.reach', 'jobs.jsonl');
    writeFileSync(list, `${JSON.stringify({ at: 'x', event: 'added', id: 'build-cache', owner: 'ci', stop: 'task:BuildCache' })}\n`);
    throwsCode(() => loadJobs(q), 1, /line 1 was not written by reach\.mjs on this computer for this folder; nothing on the list is used/);
    writeFileSync(list, `${JSON.stringify({ at: 'x', event: 'added', id: 'build-cache', owner: 'ci', stop: 'task:BuildCache', mac: '0'.repeat(64) })}\n`);
    throwsCode(() => loadJobs(q), 1, /line 1 was not written by reach\.mjs/);
    const copy = join(tmp, 'copy');
    cpSync(p, copy, { recursive: true });
    throwsCode(() => loadJobs(copy), 1, /line 1 was not written by reach\.mjs/);
    const key = keyOf();
    const { root } = reachDir(q);
    // Signed lines, each in a list of its own, that reach.mjs would write only through a fault.
    const signed = (name, ...events) => {
      const d = join(tmp, name);
      mkdirSync(d);
      for (const e of events) {
        try {
          record(d, e, []);
        } catch {}
      }
      return d;
    };
    throwsCode(() => loadJobs(signed('h1', { event: 'added', id: 'w', owner: 'writer', stop: 'pid:1 & calc' })), 1, /line 1: --stop pid/);
    throwsCode(() => loadJobs(signed('h2', { event: 'added', id: 'w', owner: 'writer', stop: 'pid:9' })), 1, /line 1: pid 9 has no start time/);
    const h3 = signed('h3', { event: 'seen', id: 'foreign', owner: 'none', stop: 'task:Foreign' }, { event: 'added', id: 'foreign', owner: 'writer', stop: 'task:Foreign' });
    throwsCode(() => loadJobs(h3), 1, /line 2: foreign is on the list already \(found\), and a second added line is refused/);
    writeFileSync(list, 'not json\n');
    throwsCode(() => loadJobs(q), 1, /line 1 cannot be read/);
    //    A line signed with this key, but in no place reach.mjs gave it, is refused too.
    writeFileSync(list, signedLine(key, root, { at: 'x', event: 'added', id: 'w', owner: 'writer', stop: 'task:W' }));
    throwsCode(() => loadJobs(q), 1, /changed outside reach\.mjs/);

    // 5b. The list is one chain, and its head is kept next to the key: a line replayed, moved or deleted,
    //     the list cut short, emptied or deleted, refuses it whole.
    const c = join(tmp, 'chain');
    mkdirSync(c);
    for (const id of ['a', 'b', 'c']) await add(c, id, { owner: 'ops', stop: `task:${id.toUpperCase()}` }, roles);
    const cl = join(c, '.reach', 'jobs.jsonl');
    const good = readFileSync(cl, 'utf8');
    const [l1, l2, l3] = good.trim().split('\n');
    const CHANGED = /^the reach list was changed outside reach\.mjs; nothing stopped: /;
    for (const text of [`${good}${l2}\n`, `${[l2, l1, l3].join('\n')}\n`, `${[l1, l3].join('\n')}\n`, `${[l1, l2].join('\n')}\n`, '']) {
      writeFileSync(cl, text);
      throwsCode(() => loadJobs(c), 1, CHANGED);
      await rejects(add(c, 'd', { owner: 'ops', stop: 'task:D' }, roles), 1, CHANGED);
    }
    writeFileSync(cl, good);
    assert.equal(loadJobs(c).size, 3, 'the list as reach.mjs left it');
    rmSync(join(c, '.reach'), { recursive: true });
    throwsCode(() => loadJobs(c), 1, CHANGED);

    // 6. .reach/ and its files stay plain and in the project: no link, no second name.
    const r = join(tmp, 'links');
    mkdirSync(join(r, '.reach'), { recursive: true });
    const outside = join(tmp, 'outside.jsonl');
    writeFileSync(outside, '');
    linkSync(outside, join(r, '.reach', 'jobs.jsonl'));
    await assert.rejects(add(r, 'w', { owner: 'writer', stop: 'task:W' }, []), /second name/);
    assert.equal(readFileSync(outside, 'utf8'), '', 'nothing written through the hard link');
    const s = join(tmp, 'symlinked');
    mkdirSync(s);
    mkdirSync(join(tmp, 'elsewhere'));
    let linked = true;
    try {
      symlinkSync(join(tmp, 'elsewhere'), join(s, '.reach'), 'junction');
    } catch {
      linked = false; // no right to make links here: the check above covers a second name
    }
    if (linked) {
      await assert.rejects(add(s, 'w', { owner: 'writer', stop: 'task:W' }, []), /\.reach is a link/);
      assert.equal(existsSync(join(tmp, 'elsewhere', 'jobs.jsonl')), false);
    }
    throwsCode(() => loadJobs('\\\\localhost\\c$\\x'), 1, /network or device path/);
    throwsCode(() => loadJobs('//localhost/c$/x'), 1, /network or device path/);

    // 7. The home folder is the account's, never HOME or USERPROFILE: a project can set those for every
    //    command its harness runs. Here they point into a project; only paths are read, no real file.
    const p7 = join(tmp, 'env-proj');
    mkdirSync(join(p7, '.git'), { recursive: true });
    mkdirSync(join(p7, 'app'));
    const envWas = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    keyHome.dir = null;
    process.env.HOME = p7;
    process.env.USERPROFILE = p7;
    try {
      assert.equal(accountHome(), userInfo().homedir);
      assert.equal(keyPath(), join(userInfo().homedir, '.rook-cut', 'key'), 'the key is in the account home');
      assert.equal(projectTop(join(p7, 'app')), realpathSync.native(p7), 'the search for the top does not stop at a home the project set');
    } finally {
      for (const [k, v] of Object.entries(envWas)) v === undefined ? delete process.env[k] : (process.env[k] = v);
      keyHome.dir = tmp;
    }
    //    A key whose real path is in the project (a link from the home's .rook-cut) is not used.
    const homeK = join(tmp, 'home-k');
    const pk = join(tmp, 'key-proj');
    mkdirSync(join(pk, '.git'), { recursive: true });
    mkdirSync(join(pk, 'keys'));
    mkdirSync(homeK);
    let kLinked = true;
    try {
      symlinkSync(join(pk, 'keys'), join(homeK, '.rook-cut'), 'junction');
    } catch {
      kLinked = false;
    }
    if (kLinked) {
      keyHome.dir = homeK;
      try {
        await assert.rejects(add(pk, 'w', { owner: 'writer', stop: 'task:W' }, []), /key folder .+ is inside the project/);
        assert.equal(existsSync(join(pk, 'keys', 'key')), false, 'no key made in the project');
      } finally {
        keyHome.dir = tmp;
      }
    }
  } finally {
    keyHome.dir = homeWas;
    for (const c of children) {
      try {
        process.kill(c.pid, 'SIGKILL');
      } catch {}
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}
