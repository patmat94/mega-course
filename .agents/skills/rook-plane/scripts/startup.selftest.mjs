// startup.selftest.mjs · the checks behind `node startup.mjs --self-test`. Your agent does not run this file.
// Offline: one HTTP server on 127.0.0.1 and a stand-in for rook-clock's egress. Leaves no file behind.

import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { egressPlaces, findEgress, folderHash, globMatch, hostShown, readChecked, start, StartFailed, versionOf } from './startup.mjs';

const SCRIPT = fileURLToPath(new URL('./startup.mjs', import.meta.url));
const SECRET = `tok_FAKE_${'q7w8e9r0t1'}`;

function server() {
  const seen = [];
  const s = http.createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers });
    if (req.url === '/settings') {
      res.writeHead(200, { 'content-type': 'application/json', etag: '"s-41"' });
      res.end(JSON.stringify({ currency: 'EUR', fee: 3 }));
    } else if (req.url === '/limits') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ version: '2026-11-16.2', max: 40 }));
    } else if (req.url === '/odd') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('line one\n~~~~\n\u{1b}[2Jcleared\n');
    } else if (req.url === '/big') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('x'.repeat(300 * 1024));
    } else {
      res.writeHead(503);
      res.end('down');
    }
  });
  // Kept-alive sockets outlive the slow parts (each files read runs git), so no fetch races a closing socket.
  s.keepAliveTimeout = 120_000;
  return new Promise((ok) => s.listen(0, '127.0.0.1', () => ok({ s, seen, base: `http://127.0.0.1:${s.address().port}` })));
}

const rejects = (promise, pattern, code = 1) =>
  assert.rejects(promise, (e) => {
    assert.ok(e instanceof StartFailed, `not a failed start: ${e?.stack ?? e}`);
    assert.match(e.message, pattern);
    assert.equal(e.code, code, `exit code for: ${e.message}`);
    assert.equal(e.message.split('\n').length, 1, 'one line');
    return true;
  });

function project(tmp, name, reads, role = '# Role: writer\n\n## Purpose\n\nWrites the change.\n', git = true) {
  const root = join(tmp, name);
  mkdirSync(join(root, 'roles', 'writer'), { recursive: true });
  mkdirSync(join(root, 'why'), { recursive: true });
  writeFileSync(join(root, 'roles', 'writer', 'ROLE.md'), role);
  writeFileSync(join(root, 'roles', 'writer', 'reads.json'), JSON.stringify(reads));
  writeFileSync(join(root, 'why', 'fee.md'), '# Why the fee is flat\n\n**Decision:** one flat `fee`.\n');
  writeFileSync(join(root, 'why', 'currency.md'), '# Why EUR\n\n**Decision:** `currency` stays EUR.\n');
  if (git) gitInit(root);
  return root;
}
const gitInit = (root) => execFileSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore', windowsHide: true });
const starts = (root) => (existsSync(join(root, 'roles', 'writer', '.start')) ? readdirSync(join(root, 'roles', 'writer', '.start')) : []);
const runs = (root) => {
  const p = join(root, 'roles', 'writer', 'runs.jsonl');
  return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

export async function selfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'plane-startup-'));
  const srv = await server();
  const noEgress = { egressPlaces: [] };
  try {
    // 1. Every read is read now and lands in the bundle with its source, time and version; one run line.
    const p1 = project(tmp, 'p1', [
      { name: 'settings', get: `${srv.base}/settings` },
      { name: 'limits', get: `${srv.base}/limits` },
      { name: 'why', files: 'why/*.md' },
    ]);
    const one = await start('roles/writer', { project: p1, ...noEgress, launcher: 'codex' });
    const text = readFileSync(one.bundle, 'utf8');
    assert.match(text, /^# Start: writer\n/);
    assert.ok(text.includes('Writes the change.'), 'ROLE.md is in the bundle');
    assert.ok(text.includes(`- source: ${srv.base}/settings`));
    assert.ok(text.includes('- version: etag:"s-41"'));
    assert.ok(text.includes('- version: version:2026-11-16.2'));
    assert.ok(text.includes('### why/currency.md') && text.includes('### why/fee.md'));
    assert.ok(text.indexOf('why/currency.md') < text.indexOf('why/fee.md'), 'files in name order');
    assert.ok(text.includes('"fee":3'));
    const r1 = runs(p1);
    assert.equal(r1.length, 1);
    assert.equal(r1[0].role, 'writer');
    assert.equal(r1[0].launcher, 'codex');
    assert.match(r1[0].folder, /^sha256:[0-9a-f]{16}$/);
    assert.deepEqual(r1[0].reads.map((r) => r.version.split(':')[0]), ['etag', 'version', 'sha256']);
    assert.match(r1[0].bundle, /^roles\/writer\/\.start\/[0-9T-]+Z\.md$/);
    assert.equal(srv.seen.filter((s) => s.url === '/settings').length, 1);

    // The folder's version: the start bundles and runs.jsonl do not count, any other file does.
    const before = folderHash(join(p1, 'roles', 'writer'));
    assert.equal(before, r1[0].folder);
    await start('roles/writer', { project: p1, ...noEgress });
    assert.equal(folderHash(join(p1, 'roles', 'writer')), before);
    writeFileSync(join(p1, 'roles', 'writer', 'ROLE.md'), '# Role: writer\n\nChanged.\n');
    assert.notEqual(folderHash(join(p1, 'roles', 'writer')), before);
    assert.equal(runs(p1).length, 2);
    assert.equal(runs(p1)[1].launcher, 'none');

    // 2. A read that fails ends the start: one line naming it, no bundle, no run line, no older bundle used.
    const p2 = project(tmp, 'p2', [{ name: 'settings', get: `${srv.base}/settings` }, { name: 'prices', get: `${srv.base}/down` }]);
    await rejects(start('roles/writer', { project: p2, ...noEgress }), new RegExp(`^read prices: HTTP 503 from ${srv.base}/down$`));
    assert.deepEqual(starts(p2), []);
    assert.deepEqual(runs(p2), []);
    writeFileSync(join(p2, 'roles', 'writer', 'reads.json'), JSON.stringify([{ name: 'gone', get: 'http://127.0.0.1:9/' }]));
    await rejects(start('roles/writer', { project: p2, ...noEgress }), /^read gone: cannot reach http:\/\/127\.0\.0\.1:9/);
    writeFileSync(join(p2, 'roles', 'writer', 'reads.json'), JSON.stringify([{ name: 'big', get: `${srv.base}/big` }]));
    await rejects(start('roles/writer', { project: p2, ...noEgress }), /^read big: the answer is over 256 KB$/);
    writeFileSync(join(p2, 'roles', 'writer', 'reads.json'), JSON.stringify([{ name: 'notes', files: 'why/*.txt' }]));
    await rejects(start('roles/writer', { project: p2, ...noEgress }), /^read notes: no file matches why\/\*\.txt$/);
    writeFileSync(join(p2, 'roles', 'writer', 'reads.json'), JSON.stringify([{ name: 'cred', get: 'http://user:pw@127.0.0.1:9/' }]));
    await rejects(start('roles/writer', { project: p2, ...noEgress }), /user name or password in the URL is a secret/);
    assert.deepEqual(starts(p2), []);

    // 3. A read with a secret, and no rook-clock: refused before anything is read or sent.
    const seenBefore = srv.seen.length;
    const p3 = project(tmp, 'p3', [
      { name: 'settings', get: `${srv.base}/settings` },
      { name: 'prices', get: `${srv.base}/settings`, headers: { authorization: 'Bearer {{API_TOKEN}}' } },
    ]);
    await rejects(start('roles/writer', { project: p3, ...noEgress }), /^read prices: this read needs a secret: install rook-clock, or read it without one$/);
    writeFileSync(join(p3, 'roles', 'writer', 'reads.json'), JSON.stringify([{ name: 'q', get: `${srv.base}/settings?k=%7B%7BAPI_TOKEN%7D%7D` }]));
    await rejects(start('roles/writer', { project: p3, ...noEgress }), /^read q: this read needs a secret/);
    assert.equal(srv.seen.length, seenBefore, 'nothing was sent');
    assert.deepEqual(starts(p3), []);

    // 4. With rook-clock: the read goes through its egress with the hosts.json, and the value never shows.
    const fake = join(tmp, 'fake-egress.mjs');
    const calls = join(tmp, 'egress-calls.jsonl');
    writeFileSync(
      fake,
      [
        "import { appendFileSync } from 'node:fs';",
        `const CALLS = ${JSON.stringify(calls)};`,
        'export async function send(request, options) {',
        '  appendFileSync(CALLS, JSON.stringify({ request, hosts: options.hosts, vars: options.vars ?? null }) + "\\n");',
        "  if (request.url.includes('refuse')) { const e = new Error('refused: API_TOKEN may not go to elsewhere.example (hop 1)'); e.refused = true; throw e; }",
        "  return { status: 200, headers: { etag: 'p-9' }, body: '{\"price\":12}', url: request.url, hops: [] };",
        '}',
        // As rook-clock's: each entry as its origin, refused (quoting the entry) when it has a path.
        'const originOf = (e) => { const u = new URL(e.includes("://") ? e : "https://" + e); if (u.pathname !== "/") throw new Error("hosts.json: " + JSON.stringify(e) + " has a path"); return u.protocol + "//" + u.hostname + ":" + (u.port || (u.protocol === "https:" ? "443" : "80")); };',
        `export const hostLists = (j) => new Map(Object.entries(j).map(([k, v]) => [k, new Set(v.map(originOf))]));`,
        'export const listedValues = (vars, lists) => Object.fromEntries(Object.entries(vars ?? {}).filter(([k]) => lists.has(k)));',
        "export const hider = (vars) => (t) => Object.entries(vars).reduce((s, [n, v]) => s.split(v).join('{{' + n + '}}'), t);",
      ].join('\n'),
    );
    writeFileSync(join(p3, 'hosts.json'), JSON.stringify({ API_TOKEN: ['api.example.com'] }));
    writeFileSync(join(p3, 'vars.json'), JSON.stringify({ API_TOKEN: SECRET }));
    writeFileSync(join(p3, 'why', 'leak.md'), `pasted by mistake: ${SECRET}\n`);
    writeFileSync(
      join(p3, 'roles', 'writer', 'reads.json'),
      JSON.stringify([
        { name: 'prices', get: 'https://api.example.com/prices', headers: { authorization: 'Bearer {{API_TOKEN}}' } },
        { name: 'why', files: 'why/*.md' },
      ]),
    );
    const three = await start('roles/writer', { project: p3, egress: fake, vars: 'vars.json' });
    const call = JSON.parse(readFileSync(calls, 'utf8').trim().split('\n').at(-1));
    assert.equal(call.request.headers.authorization, 'Bearer {{API_TOKEN}}', 'egress fills the value, not startup');
    assert.deepEqual(call.hosts, { API_TOKEN: ['api.example.com'] });
    assert.deepEqual(call.vars, { API_TOKEN: SECRET });
    const t3 = readFileSync(three.bundle, 'utf8');
    assert.ok(t3.includes('{"price":12}') && t3.includes('- version: etag:p-9'));
    assert.ok(t3.includes('- source: https://api.example.com/prices'));
    assert.ok(!t3.includes(SECRET), 'the secret is in the bundle');
    assert.ok(t3.includes('pasted by mistake: {{API_TOKEN}}'), 'a pasted value is hidden too');
    const rec = readFileSync(join(p3, 'roles', 'writer', 'runs.jsonl'), 'utf8');
    assert.ok(!rec.includes(SECRET), 'the secret is in runs.jsonl');
    writeFileSync(join(p3, 'roles', 'writer', 'reads.json'), JSON.stringify([{ name: 'prices', get: 'https://refuse.example/x?k={{API_TOKEN}}' }]));
    await rejects(start('roles/writer', { project: p3, egress: fake, vars: 'vars.json' }), /^read prices: refused: API_TOKEN may not go to elsewhere\.example \(hop 1\)$/);
    // One hosts file: the project's, or --hosts. A role folder's own hosts.json is refused, unless it is the one given.
    writeFileSync(join(p3, 'roles', 'writer', 'hosts.json'), JSON.stringify({ API_TOKEN: ['elsewhere.example'] }));
    writeFileSync(join(p3, 'roles', 'writer', 'reads.json'), JSON.stringify([{ name: 'prices', get: 'https://api.example.com/prices', headers: { authorization: 'Bearer {{API_TOKEN}}' } }]));
    await rejects(start('roles/writer', { project: p3, egress: fake, vars: 'vars.json' }), /^roles\/writer\/hosts\.json: a role's own hosts\.json is not read/, 2);
    const given = await start('roles/writer', { project: p3, egress: fake, vars: 'vars.json', hosts: 'roles/writer/hosts.json' });
    assert.deepEqual(JSON.parse(readFileSync(calls, 'utf8').trim().split('\n').at(-1)).hosts, { API_TOKEN: ['elsewhere.example'] });
    assert.equal(given.hosts, join(p3, 'roles', 'writer', 'hosts.json'));
    rmSync(join(p3, 'roles', 'writer', 'hosts.json'));
    rmSync(join(p3, 'hosts.json'));
    await rejects(start('roles/writer', { project: p3, egress: fake }), /no hosts\.json in the project, and no --hosts/);
    writeFileSync(join(p3, 'hosts.json'), JSON.stringify({ API_TOKEN: ['api.example.com'] }));

    // With rook-clock installed, its hider runs even when no read needs a secret.
    writeFileSync(join(p3, 'roles', 'writer', 'reads.json'), JSON.stringify([{ name: 'why', files: 'why/*.md' }]));
    const plainStart = await start('roles/writer', { project: p3, egress: fake, vars: 'vars.json' });
    assert.ok(!readFileSync(plainStart.bundle, 'utf8').includes(SECRET), 'the hider ran');
    assert.equal(plainStart.egress, realpathSync.native(fake));

    // A read with no {{NAME}}: a known value written out, or a credential header, is refused before anything is sent.
    const seen4 = srv.seen.length;
    const runs4 = readFileSync(join(p3, 'roles', 'writer', 'runs.jsonl'), 'utf8');
    for (const [read, pattern] of [
      [{ name: 'b', get: `${srv.base}/settings?k=${SECRET}` }, /^read b: a secret value is written out; use \{\{API_TOKEN\}\}$/],
      [{ name: 'b', get: `${srv.base}/settings?k=${encodeURIComponent(SECRET)}` }, /written out/],
      [{ name: 'b', get: `${srv.base}/settings`, headers: { 'x-key': SECRET } }, /written out/],
      // Mixed or partial percent-encoding: decoded once before the check.
      [{ name: 'b', get: `${srv.base}/settings?k=tok%5fFAKE%5Fq7w8e9r0t1` }, /written out/],
      [{ name: 'b', get: `${srv.base}/settings?k=%74ok_FAKE_q7w8e9r0t1` }, /written out/],
      [{ name: 'b', get: `${srv.base}/settings`, headers: { 'x-foo': 'tok%5FFAKE_q7w8e9r0t1' } }, /written out/],
    ]) {
      writeFileSync(join(p3, 'roles', 'writer', 'reads.json'), JSON.stringify([read]));
      await rejects(start('roles/writer', { project: p3, egress: fake, vars: 'vars.json' }), pattern);
    }
    for (const headers of [{ authorization: 'Bearer abc123' }, { 'x-api-key': 'abc123' }, { cookie: 's=1' }, { 'x-thing': 'Bearer abc' }]) {
      writeFileSync(join(p3, 'roles', 'writer', 'reads.json'), JSON.stringify([{ name: 'c', get: `${srv.base}/settings`, headers }]));
      await rejects(start('roles/writer', { project: p3, ...noEgress }), /^read c: the .+ header holds a credential written out/);
    }
    assert.equal(srv.seen.length, seen4, 'nothing was sent');
    assert.equal(readFileSync(join(p3, 'roles', 'writer', 'runs.jsonl'), 'utf8'), runs4, 'no new record');

    // rook-clock's egress is never taken from inside the project, and the home skills folders come first.
    const planted = join(p3, '.claude', 'skills', 'rook-clock', 'scripts', 'egress.mjs');
    mkdirSync(join(planted, '..'), { recursive: true });
    writeFileSync(planted, readFileSync(fake, 'utf8'));
    const p3real = realpathSync.native(p3);
    assert.equal(findEgress(undefined, [planted, fake], p3real), realpathSync.native(fake));
    assert.equal(findEgress(undefined, [planted], p3real), null);
    assert.throws(() => findEgress(planted, [], p3real), (e) => e.code === 2 && /is inside the project/.test(e.message));
    await rejects(start('roles/writer', { project: p3, egress: planted }), /--egress: .+ is inside the project/, 2);
    // A network or device path (\\host\share, \\?\…, //host) is never taken: its real path may lead back in.
    const net = (e) => e.code === 2 && /is a network or device path/.test(e.message);
    assert.throws(() => findEgress('\\\\localhost\\c$\\x\\egress.mjs', [], p3real), net);
    assert.throws(() => findEgress('//localhost/c$/x/egress.mjs', [], p3real), net);
    if (process.platform === 'win32') {
      assert.throws(() => findEgress(`\\\\?\\${realpathSync.native(fake)}`, [], p3real), net);
      assert.equal(findEgress(undefined, [`\\\\?\\${realpathSync.native(fake)}`], p3real), null);
    }
    const places = egressPlaces(join(tmp, 'home'));
    assert.ok(places.slice(0, 4).every((p) => p.startsWith(join(tmp, 'home'))), 'home first');
    assert.ok(!places.some((p) => /[\\/]clock[\\/]/.test(p)), 'no folder named clock');

    // 5. Files stay inside the project, and never a secrets file.
    const p5 = project(tmp, 'p5', []);
    writeFileSync(join(tmp, 'outside.md'), 'outside\n');
    writeFileSync(join(p5, 'vars.json'), '{}');
    writeFileSync(join(p5, '.env'), 'X=1');
    mkdirSync(join(p5, 'config'));
    writeFileSync(join(p5, 'config', 'vars.json'), '{}');
    writeFileSync(join(p5, 'config', 'a.json'), '{}');
    const reads5 = (files) => writeFileSync(join(p5, 'roles', 'writer', 'reads.json'), JSON.stringify([{ name: 'f', files }]));
    for (const [files, pattern] of [
      ['../outside.md', /no "\.\." in a path/],
      ['why/../../outside.md', /no "\.\." in a path/],
      [join(tmp, 'outside.md'), /a path from the project's folder/],
      ['/etc/hosts', /a path from the project's folder/],
      ['C:/Windows/win.ini', /a path from the project's folder/],
      ['why\\fee.md', /with \/ between parts/],
      ['vars.json', /holds secrets/],
      ['VARS.JSON', /holds secrets/],
      ['.env', /holds secrets/],
      ['config/*.json', /holds secrets/],
      ['*/a.json', /\* and \? go in the last part only/],
      ['roles', /is not a file/],
      ['nope.md', /no file nope\.md/],
    ]) {
      reads5(files);
      await rejects(start('roles/writer', { project: p5, ...noEgress }), pattern);
    }
    // Another name for a secrets file: a stream name, a short name, a hard link, a key. Without --vars too.
    mkdirSync(join(p5, 'keys'));
    writeFileSync(join(p5, 'keys', 'id_rsa'), 'k');
    writeFileSync(join(p5, 'keys', 'server.PEM'), 'k');
    for (const [files, pattern] of [
      ['vars.json::$DATA', /no ":" in a path/],
      ['.env::$DATA', /no ":" in a path/],
      ['VARS~1.JSO', /no short name/],
      ['ENV~1', /no short name/],
      ['CONFIG~1/a.json', /no short name/],
      ['keys/id_rsa', /holds secrets/],
      ['keys/*', /holds secrets/],
      ['keys/server.PEM', /holds secrets/],
    ]) {
      reads5(files);
      await rejects(start('roles/writer', { project: p5, ...noEgress }), pattern);
    }
    linkSync(join(p5, 'vars.json'), join(p5, 'why', 'notes.md'));
    reads5('why/notes.md');
    await rejects(start('roles/writer', { project: p5, ...noEgress }), /has a second name \(a hard link\)/);
    reads5('why/*.md');
    await rejects(start('roles/writer', { project: p5, ...noEgress }), /has a second name/);
    rmSync(join(p5, 'why', 'notes.md'));
    // Only files that would be committed: a file git ignores and anything under .git/ are refused, and the
    // secret names are a second check.
    writeFileSync(join(p5, '.gitignore'), 'local.md\n');
    mkdirSync(join(p5, 'notes'));
    for (const n of ['local.md', 'prod.env', '.dev.vars', '.envrc', 'secrets.json', 'secret.yaml', 'server.key', 'id_work', '.npmrc', '.netrc']) {
      writeFileSync(join(p5, 'notes', n), `API_TOKEN=${SECRET}\n`);
    }
    symlinkSync(join(p5, '.git'), join(p5, 'gitlink'), 'junction');
    for (const [files, pattern] of [
      ...['prod.env', '.dev.vars', '.envrc', 'secrets.json', 'secret.yaml', 'server.key', 'id_work', '.npmrc', '.netrc', '*.env', 'p*'].map((n) => [`notes/${n}`, /holds secrets/]),
      ['notes/local.md', /^read f: notes\/local\.md is ignored by git; startup reads only files that would be committed: ask your human, and never change a git ignore rule to make a read pass$/],
      ['notes/*.md', /notes\/local\.md is ignored by git/],
      ['.git/config', /nothing under \.git\/ is read/],
      ['.GIT/config', /nothing under \.git\/ is read/],
      ['gitlink/config', /nothing under \.git\/ is read/],
    ]) {
      reads5(files);
      await rejects(start('roles/writer', { project: p5, ...noEgress }), pattern);
    }
    rmSync(join(p5, 'gitlink'), { force: true });
    // A project change cannot take your ignore line away: a "!" line that un-ignores the file (deeper or at
    // the root), a nested repository's own ignore rules, and a .git/config that points core.excludesFile elsewhere.
    writeFileSync(join(p5, '.gitignore'), 'local.md\nconfig/local.yaml\n');
    writeFileSync(join(p5, 'config', 'local.yaml'), `db_password: ${SECRET}\n`);
    reads5('config/local.yaml');
    await rejects(start('roles/writer', { project: p5, ...noEgress }), /^read f: config\/local\.yaml is ignored by git/);
    writeFileSync(join(p5, 'config', '.gitignore'), '!local.yaml\n');
    await rejects(start('roles/writer', { project: p5, ...noEgress }), /^read f: config\/local\.yaml is un-ignored by a "!" rule; startup does not read it$/);
    rmSync(join(p5, 'config', '.gitignore'));
    writeFileSync(join(p5, '.gitignore'), 'local.md\nconfig/local.yaml\n!config/local.yaml\n');
    await rejects(start('roles/writer', { project: p5, ...noEgress }), /config\/local\.yaml is un-ignored by a "!" rule/);
    writeFileSync(join(p5, '.gitignore'), 'local.md\n');
    mkdirSync(join(p5, 'vendor', 'sub'), { recursive: true });
    gitInit(join(p5, 'vendor', 'sub'));
    writeFileSync(join(p5, 'vendor', 'sub', '.git', 'info', 'exclude'), 'local.yaml\n');
    writeFileSync(join(p5, 'vendor', 'sub', 'local.yaml'), `db_password: ${SECRET}\n`);
    reads5('vendor/sub/local.yaml');
    await rejects(start('roles/writer', { project: p5, ...noEgress }), /^read f: vendor\/sub\/local\.yaml is inside another git repository \(vendor\/sub\); startup does not read it$/);
    reads5('vendor/sub/*.yaml');
    await rejects(start('roles/writer', { project: p5, ...noEgress }), /inside another git repository/);
    const globalIgnore = join(tmp, 'global-ignore');
    writeFileSync(globalIgnore, '*.local.md\n');
    writeFileSync(join(tmp, 'global-gitconfig'), `[core]\n\texcludesFile = ${globalIgnore.replace(/\\/g, '/')}\n`);
    const savedGlobal = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = join(tmp, 'global-gitconfig');
    try {
      writeFileSync(join(p5, 'notes', 'a.local.md'), `API_TOKEN=${SECRET}\n`);
      reads5('notes/a.local.md');
      await rejects(start('roles/writer', { project: p5, ...noEgress }), /^read f: notes\/a\.local\.md is ignored by git/);
      writeFileSync(join(tmp, 'empty-ignore'), '');
      execFileSync('git', ['config', 'core.excludesFile', join(tmp, 'empty-ignore')], { cwd: p5, stdio: 'ignore', windowsHide: true });
      await rejects(start('roles/writer', { project: p5, ...noEgress }), /^read f: notes\/a\.local\.md is ignored by git/);
      execFileSync('git', ['config', '--unset', 'core.excludesFile'], { cwd: p5, stdio: 'ignore', windowsHide: true });
    } finally {
      if (savedGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = savedGlobal;
    }
    const pn = project(tmp, 'pn', [{ name: 'why', files: 'why/fee.md' }], undefined, false);
    await rejects(start('roles/writer', { project: pn, ...noEgress }), /^read why: files reads need a git repository here, so ignored files stay out$/);
    assert.deepEqual(starts(pn), []);
    // The vars file is never read into a bundle, whatever it is called.
    writeFileSync(join(p5, 'secrets-here.json'), '{}');
    reads5('secrets-here.json');
    await rejects(start('roles/writer', { project: p5, ...noEgress, vars: 'secrets-here.json' }), /is the vars file/);
    // A link out of the project: a junction (no admin needed on Windows) and a file link where the system allows it.
    mkdirSync(join(tmp, 'out-dir'));
    writeFileSync(join(tmp, 'out-dir', 'x.md'), 'outside\n');
    symlinkSync(join(tmp, 'out-dir'), join(p5, 'linked'), 'junction');
    reads5('linked/x.md');
    await rejects(start('roles/writer', { project: p5, ...noEgress }), /leads out of the project/);
    let fileLink = true;
    try {
      symlinkSync(join(tmp, 'outside.md'), join(p5, 'why', 'link.md'), 'file');
    } catch {
      fileLink = false;
    }
    if (fileLink) {
      reads5('why/link.md');
      await rejects(start('roles/writer', { project: p5, ...noEgress }), /is a link; startup reads only plain files/);
      reads5('why/*.md');
      await rejects(start('roles/writer', { project: p5, ...noEgress }), /is a link/);
    }
    assert.deepEqual(starts(p5), []);

    // runs.jsonl with a second name (a hard link out), or a link to a file not there yet: no line is written there.
    const p5b = project(tmp, 'p5b', [{ name: 'why', files: 'why/fee.md' }]);
    writeFileSync(join(tmp, 'out-runs.txt'), '');
    linkSync(join(tmp, 'out-runs.txt'), join(p5b, 'roles', 'writer', 'runs.jsonl'));
    await rejects(start('roles/writer', { project: p5b, ...noEgress }), /runs\.jsonl is a link or has a second name/);
    assert.equal(readFileSync(join(tmp, 'out-runs.txt'), 'utf8'), '');
    rmSync(join(p5b, 'roles', 'writer', 'runs.jsonl'));
    let danglingLink = true;
    try {
      symlinkSync(join(tmp, 'not-yet.txt'), join(p5b, 'roles', 'writer', 'runs.jsonl'), 'file');
    } catch {
      danglingLink = false;
    }
    if (danglingLink) {
      await rejects(start('roles/writer', { project: p5b, ...noEgress }), /runs\.jsonl is a link/);
      assert.equal(existsSync(join(tmp, 'not-yet.txt')), false);
      rmSync(join(p5b, 'roles', 'writer', 'runs.jsonl'));
    }
    assert.equal((await start('roles/writer', { project: p5b, ...noEgress })).record.role, 'writer');
    assert.equal((await start('roles/writer', { project: p5b, ...noEgress })).record.role, 'writer', 'appends to its own runs.jsonl');

    // A glob cannot hang the start: no backtracking.
    assert.ok(globMatch('*.md', 'fee.md') && globMatch('f?e*', 'fee.md') && globMatch('*', 'x') && !globMatch('*.md', 'fee.txt') && !globMatch('a*b', 'ab.c'));
    assert.ok(globMatch('*a*b', 'xaxb') && !globMatch('*a*b', 'xbxa') && globMatch('**', ''));

    // 6. The role folder: inside the project, a plain folder, with its two files; reads.json well formed.
    const p6 = project(tmp, 'p6', [{ name: 'why', files: 'why/fee.md' }]);
    await rejects(start('../p5/roles/writer', { project: p6, ...noEgress }), /not inside this project/, 2);
    await rejects(start('.', { project: p6, ...noEgress }), /not inside this project/, 2);
    await rejects(start('roles/nobody', { project: p6, ...noEgress }), /no role folder at roles\/nobody/, 2);
    symlinkSync(join(p6, 'roles', 'writer'), join(p6, 'roles', 'alias'), 'junction');
    await rejects(start('roles/alias', { project: p6, ...noEgress }), /not a folder \(a link is not read\)/, 2);
    mkdirSync(join(p6, 'roles', 'bad name'));
    await rejects(start('roles/bad name', { project: p6, ...noEgress }), /role name/, 2);
    const reads6 = (v) => writeFileSync(join(p6, 'roles', 'writer', 'reads.json'), typeof v === 'string' ? v : JSON.stringify(v));
    for (const [v, pattern] of [
      ['{', /not JSON/],
      [{ name: 'x' }, /not a list/],
      [[{ name: 'x', get: 'http://a/', files: 'b' }], /needs one of "get"/],
      [[{ name: 'x' }], /needs one of "get"/],
      [[{ name: '-x', files: 'a' }], /needs a "name"/],
      [[{ name: 'a', files: 'why/fee.md' }, { name: 'A', files: 'why/fee.md' }], /two reads are named A/],
      [[{ name: 'a', files: 'why/fee.md', run: 'calc' }], /"run", which startup does not know/],
      [[{ name: 'a', files: 'why/fee.md', headers: {} }], /"headers" go with "get" only/],
    ]) {
      reads6(v);
      await rejects(start('roles/writer', { project: p6, ...noEgress }), pattern, 2);
    }
    reads6([{ name: 'a', files: 'why/{{X}}.md' }]);
    await rejects(start('roles/writer', { project: p6, ...noEgress }), /a \{\{NAME\}\} goes in a "get" read only/);
    reads6([{ name: 'why', files: 'why/fee.md' }]);
    // ROLE.md or reads.json with a second name (a hard link to a file outside): refused before anything is read.
    const keys = join(tmp, 'homekeys.json');
    writeFileSync(keys, JSON.stringify({ API_TOKEN: SECRET }));
    for (const f of ['ROLE.md', 'reads.json']) {
      const p = join(p6, 'roles', 'writer', f);
      const was = readFileSync(p);
      rmSync(p);
      linkSync(keys, p);
      await rejects(start('roles/writer', { project: p6, ...noEgress }), new RegExp(`writer/${f.replace('.', '\\.')} has a second name \\(a hard link\\)`), 2);
      rmSync(p);
      writeFileSync(p, was);
    }
    assert.deepEqual(starts(p6), []);
    // One open handle: a file swapped after its check (another file renamed over it, or a hard link) is refused.
    const a6 = join(p6, 'why', 'a.md');
    writeFileSync(a6, 'a');
    const checked = lstatSync(a6, { bigint: true });
    writeFileSync(join(p6, 'why', 'b.md'), 'b');
    renameSync(join(p6, 'why', 'b.md'), a6);
    assert.throws(() => readChecked(a6, 'why/a.md', checked), / why\/a\.md changed while startup read it; start again$/);
    rmSync(a6);
    linkSync(keys, a6);
    assert.throws(() => readChecked(a6, 'why/a.md', lstatSync(a6, { bigint: true })), /has a second name/);
    rmSync(a6);
    reads6([]);
    rmSync(join(p6, 'roles', 'writer', 'ROLE.md'));
    await rejects(start('roles/writer', { project: p6, ...noEgress }), /has no ROLE\.md/, 2);

    // 7. What a read says is data: a fence it holds cannot close the bundle's, steering characters show as text.
    const p7 = project(tmp, 'p7', [{ name: 'odd', get: `${srv.base}/odd` }]);
    const t7 = readFileSync((await start('roles/writer', { project: p7, ...noEgress })).bundle, 'utf8');
    assert.ok(t7.includes('~~~~~\nline one\n~~~~\n\\u{1b}[2Jcleared\n~~~~~'), t7);
    assert.ok(!t7.includes('\u{1b}'));

    // 8. The version of a read.
    assert.equal(versionOf('{"version":3}', null), 'version:3');
    assert.equal(versionOf('{"version":3}', 'W/"e1"'), 'etag:W/"e1"');
    assert.match(versionOf('plain', null), /^sha256:[0-9a-f]{16}$/);

    // 9. The command: prints the bundle's path; exit 1 on a failed read, 2 on a usage error.
    const cli = (cwd, ...args) =>
      new Promise((ok) => execFile(process.execPath, [SCRIPT, ...args], { cwd, timeout: 20_000 }, (e, stdout, stderr) => ok({ code: e ? e.code : 0, stdout, stderr })));
    const p9 = project(tmp, 'p9', [{ name: 'why', files: 'why/*.md' }]);
    const ok = await cli(p9, 'roles/writer', '--egress', fake);
    assert.equal(ok.code, 0, ok.stderr);
    const okLines = ok.stdout.trim().split(/\r?\n/);
    assert.match(okLines[0], /^roles\/writer\/\.start\/[0-9T-]+Z\.md$/);
    assert.equal(okLines[1], `hosts: none · egress: ${realpathSync.native(fake)}`);
    assert.equal(ok.stderr, '');
    // The line names, per secret, the hosts it may go to: a host only, never a value pasted in the list.
    writeFileSync(join(p9, 'hosts.json'), JSON.stringify({ API_TOKEN: ['api.example.com', 'http://127.0.0.1:47242', 'sk-LIVE-plane-r3-0001'] }));
    writeFileSync(join(p9, 'roles', 'writer', 'reads.json'), JSON.stringify([{ name: 'prices', get: 'https://api.example.com/p', headers: { authorization: 'Bearer {{API_TOKEN}}' } }]));
    const sec = await cli(p9, 'roles/writer', '--egress', fake);
    assert.equal(sec.code, 0, sec.stderr);
    // With rook-clock, the line is the origins egress takes, so a host it sends to never shows as (not a host).
    assert.equal(sec.stdout.trim().split(/\r?\n/)[1], `hosts: API_TOKEN → api.example.com, http://127.0.0.1:47242, sk-live-plane-r3-0001 (hosts.json) · egress: ${realpathSync.native(fake)}`);
    writeFileSync(join(p9, 'hosts.json'), JSON.stringify({ API_TOKEN: ['http://my_box.localhost:47342', 'rookbox'] }));
    const odd = await cli(p9, 'roles/writer', '--egress', fake);
    assert.equal(odd.stdout.trim().split(/\r?\n/)[1], `hosts: API_TOKEN → http://my_box.localhost:47342, rookbox (hosts.json) · egress: ${realpathSync.native(fake)}`);
    // A refused entry is never printed: egress's own message quotes it.
    writeFileSync(join(p9, 'hosts.json'), JSON.stringify({ API_TOKEN: ['http://127.0.0.1:47341', 'sk/LIVE+plane=r3/0001'] }));
    const refusedEntry = await cli(p9, 'roles/writer', '--egress', fake);
    assert.equal(refusedEntry.code, 2);
    assert.match(refusedEntry.stderr, /^hosts\.json: API_TOKEN: an entry is not a host \(list the host only\)\r?\n/);
    assert.ok(!refusedEntry.stderr.includes('LIVE'), 'the entry is printed');
    rmSync(join(p9, 'hosts.json'));
    assert.equal(hostShown('https://a.example.com/x?k=1'), '(not a host)');
    assert.equal(hostShown('localhost:8080'), 'localhost:8080');
    writeFileSync(join(p9, 'why', 'a'.repeat(120)), 'x');
    writeFileSync(join(p9, 'roles', 'writer', 'reads.json'), JSON.stringify([{ name: 'slow', files: `why/${'*a'.repeat(20)}*b` }]));
    const quick = await cli(p9, 'roles/writer');
    assert.equal(quick.code, 1, `a glob hung the start: ${quick.stderr}`);
    assert.match(quick.stderr, /no file matches/);
    writeFileSync(join(p9, 'roles', 'writer', 'reads.json'), JSON.stringify([{ name: 'prices', get: 'https://api.example.com/p', headers: { a: '{{K}}' } }]));
    const no = await cli(p9, 'roles/writer', '--egress', join(tmp, 'missing.mjs'));
    assert.equal(no.code, 2);
    assert.match(no.stderr, /--egress: no file at/);
    const bad = await cli(p9, 'roles/writer', '--nope', 'x');
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /--nope is not a flag/);
    writeFileSync(join(p9, 'roles', 'writer', 'reads.json'), JSON.stringify([{ name: 'down', get: `${srv.base}/down` }]));
    const failed = await cli(p9, 'roles/writer');
    assert.equal(failed.code, 1);
    assert.equal(failed.stderr.trim(), `start failed: read down: HTTP 503 from ${srv.base}/down`);
    assert.equal(failed.stdout, '');
  } finally {
    srv.s.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}
