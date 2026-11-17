// launch.selftest.mjs · the checks behind `node launch.mjs --self-test`. Your agent does not run this file.
// Offline: one HTTP server on 127.0.0.1 and stand-in harnesses on a PATH of their own (no model is called).
// Leaves no file behind.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findHarness, harnessArgs, launch, scriptOfLauncher } from './launch.mjs';
import { StartFailed } from './startup.mjs';

const SCRIPT = fileURLToPath(new URL('./launch.mjs', import.meta.url));
const WIN = process.platform === 'win32';

// A stand-in harness: it writes what it got (arguments, folder, stdin, the system prompt file) and exits.
const FAKE = `
const fs = require('node:fs');
let stdin = 'open';
try { stdin = fs.readFileSync(0, 'utf8') === '' ? 'closed' : 'data'; } catch { stdin = 'closed'; }
const args = process.argv.slice(2);
const at = args.indexOf('--system-prompt-file') + 1 || args.indexOf('--system-prompt') + 1;
let file = at ? args[at] : null;
const c = args.find((a) => a.startsWith('model_instructions_file='));
if (c) file = JSON.parse(c.slice('model_instructions_file='.length));
fs.appendFileSync(process.env.FAKE_OUT, JSON.stringify({ tag: process.env.FAKE_TAG, args, cwd: process.cwd(), stdin, prompt: file ? fs.readFileSync(file, 'utf8') : null }) + '\\n');
process.exit(Number(process.env.FAKE_EXIT || 0));
`;

function plant(dir, name, tag) {
  mkdirSync(dir, { recursive: true });
  const js = join(dir, `${name}-harness.js`);
  writeFileSync(js, FAKE.replace("process.env.FAKE_TAG", JSON.stringify(tag)));
  if (WIN) {
    writeFileSync(join(dir, `${name}.cmd`), `@ECHO off\r\nSETLOCAL\r\n"node" "%~dp0${name}-harness.js" %*\r\n`);
  } else {
    writeFileSync(join(dir, name), `#!/bin/sh\nexec "${process.execPath}" "${js}" "$@"\n`);
    chmodSync(join(dir, name), 0o755);
  }
}

function envWith(path, extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toUpperCase() !== 'PATH'));
  return { ...env, PATH: path, ...extra };
}

function server() {
  let hits = 0;
  const s = http.createServer((req, res) => {
    hits++;
    if (req.url === '/settings') {
      res.writeHead(200, { etag: '"s-7"', 'content-type': 'application/json' });
      res.end('{"fee":3}');
    } else {
      res.writeHead(503);
      res.end();
    }
  });
  return new Promise((ok) => s.listen(0, '127.0.0.1', () => ok({ s, hits: () => hits, base: `http://127.0.0.1:${s.address().port}` })));
}

export async function selfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'plane-launch-'));
  const srv = await server();
  try {
    const bin = join(tmp, 'bin');
    for (const h of ['claude', 'codex', 'pi']) plant(bin, h, 'good');
    const root = join(tmp, 'project');
    const role = join(root, 'roles', 'checker');
    mkdirSync(role, { recursive: true });
    writeFileSync(join(role, 'ROLE.md'), '# Role: checker\n\n## Purpose\n\nJudges the change. Read-only.\n');
    writeFileSync(join(role, 'reads.json'), JSON.stringify([{ name: 'settings', get: `${srv.base}/settings` }]));
    const outFile = join(tmp, 'fake-out.jsonl');
    const got = () => (existsSync(outFile) ? readFileSync(outFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
    const base = { project: root, env: envWith(bin, { FAKE_OUT: outFile }), egressPlaces: [] };
    const lines = [];
    const out = (l) => lines.push(l);

    // 1. --dry-run prints the line and runs nothing, not even the reads.
    for (const h of ['claude', 'codex', 'pi']) {
      lines.length = 0;
      assert.equal(await launch('roles/checker', { ...base, harness: h, 'dry-run': true, out }), 0);
      assert.match(lines[0], new RegExp(`^would run \\(in .+ · hosts: none · egress: none\\): .+${h}`));
      assert.ok(lines[0].includes('roles/checker/.start/<this start>.md'), lines[0]);
      assert.equal(lines[1], 'dry run: nothing read, nothing started');
    }
    assert.equal(srv.hits(), 0);
    assert.equal(existsSync(join(role, '.start')), false);
    assert.equal(existsSync(join(role, 'runs.jsonl')), false);
    assert.deepEqual(got(), []);

    // 2. Each harness: the start first, then the harness once, with the bundle as its system prompt,
    // in the project's folder, stdin closed, the exact arguments of its line.
    for (const h of ['claude', 'codex', 'pi']) {
      lines.length = 0;
      const code = await launch('roles/checker', { ...base, harness: h, model: 'vendor/model-1', out });
      assert.equal(code, 0);
      const run = got().at(-1);
      assert.equal(run.tag, 'good');
      assert.equal(run.stdin, 'closed');
      assert.equal(run.cwd.toLowerCase(), root.toLowerCase());
      assert.ok(run.prompt.startsWith('# Start: checker\n'), run.prompt);
      assert.ok(run.prompt.includes('Judges the change.') && run.prompt.includes('{"fee":3}') && run.prompt.includes('etag:"s-7"'));
      const record = readFileSync(join(role, 'runs.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1);
      assert.equal(record.launcher, h);
      const bundle = join(root, ...record.bundle.split('/'));
      assert.deepEqual(run.args, harnessArgs(h, bundle, { model: 'vendor/model-1', prompt: 'Start.' }));
      assert.match(lines[0], /^start bundle: roles\/checker\/\.start\/.+\.md$/);
      assert.match(lines[1], /^run \(in .+ · hosts: none · egress: none\): /);
    }
    assert.equal(srv.hits(), 3, 'one fresh read per start');
    assert.deepEqual(harnessArgs('pi', 'B', { prompt: 'Go.' }), ['-p', '--no-session', '-ne', '-nc', '--system-prompt', 'B', 'Go.']);
    assert.deepEqual(harnessArgs('claude', 'B', { prompt: 'Go.' }), ['-p', '--system-prompt-file', 'B', '--no-session-persistence', 'Go.']);
    assert.deepEqual(harnessArgs('codex', 'C:\\p\\b.md', { prompt: 'Go.' }), ['exec', '--ephemeral', '-c', 'model_instructions_file="C:\\\\p\\\\b.md"', 'Go.']);

    // 3. The prompt reaches the harness as one argument, as it is: no shell reads it.
    const hostile = `check "this"; & | $(touch pwned) \`touch pwned2\` %PATH% ^& 'x' > out.txt`;
    assert.equal(await launch('roles/checker', { ...base, harness: 'claude', prompt: hostile, out }), 0);
    assert.equal(got().at(-1).args.at(-1), hostile);
    for (const f of ['pwned', 'pwned2', 'out.txt']) assert.equal(existsSync(join(root, f)), false, `${f} was made`);

    // 4. The harness's exit code is the launch's.
    assert.equal(await launch('roles/checker', { ...base, env: envWith(bin, { FAKE_OUT: outFile, FAKE_EXIT: '7' }), harness: 'pi', out }), 7);

    // 5. Bad flags are usage errors, before anything runs.
    const usage = (opts, pattern) =>
      assert.rejects(launch('roles/checker', { ...base, out, ...opts }), (e) => e instanceof StartFailed && e.code === 2 && pattern.test(e.message));
    const hitsBefore = srv.hits();
    await usage({}, /--harness is required/);
    await usage({ harness: 'bash' }, /one of claude, codex, pi/);
    await usage({ harness: '../bin/claude' }, /one of claude, codex, pi/);
    for (const model of ['-x', 'a;b', '$(id)', 'a b', '']) await usage({ harness: 'pi', model }, /--model/);
    for (const prompt of ['-p', ' --help', '', 'a\0b']) await usage({ harness: 'pi', prompt }, /--prompt/);
    assert.equal(srv.hits(), hitsBefore);

    // 6. Not installed: one line, exit 2, nothing read.
    const before6 = srv.hits();
    await assert.rejects(launch('roles/checker', { ...base, env: envWith(join(tmp, 'empty')), harness: 'codex', out }), (e) => e.code === 2 && e.message === 'codex is not installed: no codex on PATH');
    assert.equal(srv.hits(), before6);

    // 7. A harness planted in the role folder, or in the project behind a relative PATH folder, is never run.
    plant(role, 'claude', 'role-folder');
    plant(root, 'claude', 'project');
    const path7 = ['.', 'roles/checker', role, bin].join(WIN ? ';' : ':');
    assert.equal(findHarness('claude', { env: { PATH: path7 }, avoid: [role] }).file.toLowerCase(), join(bin, WIN ? 'claude.cmd' : 'claude').toLowerCase());
    assert.equal(await launch('roles/checker', { ...base, env: envWith(path7, { FAKE_OUT: outFile }), harness: 'claude', out }), 0);
    assert.equal(got().at(-1).tag, 'good');
    // A PATH folder that leads into the project another way (a junction, a link) is skipped by its real path,
    // and so is a folder of the project itself, such as the node_modules/.bin a package script puts first.
    mkdirSync(join(role, 'bin'));
    plant(join(role, 'bin'), 'claude', 'role-folder');
    symlinkSync(join(role, 'bin'), join(tmp, 'jbin'), 'junction');
    plant(join(root, 'node_modules', '.bin'), 'claude', 'project-bin');
    const path7b = [join(tmp, 'jbin'), join(root, 'node_modules', '.bin'), bin].join(WIN ? ';' : ':');
    assert.equal(findHarness('claude', { env: { PATH: path7b }, avoid: [realpathSync.native(root)] }).file.toLowerCase(), join(bin, WIN ? 'claude.cmd' : 'claude').toLowerCase());
    assert.equal(await launch('roles/checker', { ...base, env: envWith(path7b, { FAKE_OUT: outFile }), harness: 'claude', out }), 0);
    assert.equal(got().at(-1).tag, 'good');
    rmSync(join(tmp, 'jbin'), { recursive: false, force: true });
    rmSync(join(role, 'bin'), { recursive: true });
    rmSync(join(root, 'node_modules'), { recursive: true });
    rmSync(join(role, WIN ? 'claude.cmd' : 'claude'));
    rmSync(join(role, 'claude-harness.js'));

    // A PATH folder given as a network or device path (\\?\C:\…, \\host\share) is skipped: its real path may lead back in.
    if (WIN) assert.equal(findHarness('claude', { env: { PATH: `\\\\?\\${bin}` }, avoid: [realpathSync.native(root)] }), null);
    assert.equal(findHarness('claude', { env: { PATH: `//localhost/c$/x;\\\\localhost\\c$\\x` }, avoid: [] }), null);

    // The hosts file the start uses is in the line, and a role folder's own hosts.json stops it before anything runs.
    writeFileSync(join(root, 'hosts.json'), '{}');
    lines.length = 0;
    await launch('roles/checker', { ...base, harness: 'pi', 'dry-run': true, out });
    assert.match(lines[0], /^would run \(in .+ · hosts: hosts\.json · egress: none\): /);
    // With a read that names a secret, the line names each secret and its hosts, never a value pasted in the list.
    writeFileSync(join(root, 'hosts.json'), JSON.stringify({ API_TOKEN: ['http://127.0.0.1:47242', 'sk-LIVE-plane-r3-0001'] }));
    const reads7 = readFileSync(join(role, 'reads.json'));
    writeFileSync(join(role, 'reads.json'), JSON.stringify([{ name: 'p', get: 'https://api.example.com/p?k={{API_TOKEN}}' }]));
    lines.length = 0;
    await launch('roles/checker', { ...base, harness: 'pi', 'dry-run': true, out });
    assert.match(lines[0], /^would run \(in .+ · hosts: API_TOKEN → http:\/\/127\.0\.0\.1:47242, \(not a host\) \(hosts\.json\) · egress: none\): /);
    // With rook-clock, the line your human approves is the hosts its egress takes: a host it sends to is named.
    const egressFile = join(tmp, 'stand-in-egress.mjs');
    writeFileSync(
      egressFile,
      [
        'export const send = async () => ({ status: 200, headers: {}, body: "" });',
        'export const hostLists = (j) => new Map(Object.entries(j).map(([k, v]) => [k, new Set(v.map((e) => { const u = new URL(e.includes("://") ? e : "https://" + e); return u.protocol + "//" + u.hostname + ":" + (u.port || "443"); }))]));',
        'export const listedValues = () => ({});',
        'export const hider = () => (t) => t;',
      ].join('\n'),
    );
    writeFileSync(join(root, 'hosts.json'), JSON.stringify({ API_TOKEN: ['http://my_box.localhost:47342'] }));
    lines.length = 0;
    await launch('roles/checker', { ...base, harness: 'pi', 'dry-run': true, out, egress: egressFile });
    assert.match(lines[0], /^would run \(in .+ · hosts: API_TOKEN → http:\/\/my_box\.localhost:47342 \(hosts\.json\) · egress: .+stand-in-egress\.mjs\): /);
    writeFileSync(join(role, 'reads.json'), reads7);
    writeFileSync(join(root, 'hosts.json'), '{}');
    writeFileSync(join(role, 'hosts.json'), '{}');
    const runs7 = got().length;
    await assert.rejects(launch('roles/checker', { ...base, harness: 'pi', 'dry-run': true, out }), (e) => e.code === 2 && /a role's own hosts\.json is not read/.test(e.message));
    await assert.rejects(launch('roles/checker', { ...base, harness: 'pi', out }), (e) => e.code === 2 && /a role's own hosts\.json is not read/.test(e.message));
    assert.equal(got().length, runs7);
    rmSync(join(role, 'hosts.json'));
    rmSync(join(root, 'hosts.json'));

    // 8. A start that fails starts no harness.
    const runsBefore = got().length;
    writeFileSync(join(role, 'reads.json'), JSON.stringify([{ name: 'settings', get: `${srv.base}/down` }]));
    await assert.rejects(launch('roles/checker', { ...base, harness: 'claude', out }), (e) => e.code === 1 && /^read settings: HTTP 503/.test(e.message));
    assert.equal(got().length, runsBefore);
    writeFileSync(join(role, 'reads.json'), JSON.stringify([{ name: 'settings', get: `${srv.base}/settings` }]));

    // 9. Windows: a .cmd launcher is started through the Node script it names, or refused when it names none.
    if (WIN) {
      assert.equal(scriptOfLauncher(join(bin, 'pi.cmd')).toLowerCase(), join(bin, 'pi-harness.js').toLowerCase());
      const npm = join(tmp, 'npm-style');
      mkdirSync(join(npm, 'node_modules', 'tool', 'bin'), { recursive: true });
      writeFileSync(join(npm, 'node_modules', 'tool', 'bin', 'tool.js'), '');
      writeFileSync(join(npm, 'tool.cmd'), '@ECHO off\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\tool\\bin\\tool.js" %*\r\n');
      assert.equal(scriptOfLauncher(join(npm, 'tool.cmd')).toLowerCase(), join(npm, 'node_modules', 'tool', 'bin', 'tool.js').toLowerCase());
      const odd = join(tmp, 'odd');
      mkdirSync(odd);
      writeFileSync(join(odd, 'codex.cmd'), '@ECHO off\r\nC:\\tools\\codex-real.exe %*\r\n');
      await assert.rejects(launch('roles/checker', { ...base, env: envWith(odd), harness: 'codex', out }), (e) => e.code === 2 && /names no Node script/.test(e.message));
    }

    // 10. The command line.
    const cli = (...args) =>
      new Promise((ok) =>
        execFile(process.execPath, [SCRIPT, ...args], { cwd: root, env: envWith(bin, { FAKE_OUT: outFile, FAKE_EXIT: '3' }), timeout: 30_000 }, (e, stdout, stderr) =>
          ok({ code: e ? e.code : 0, stdout, stderr }),
        ),
      );
    const dry = await cli('roles/checker', '--harness', 'pi', '--dry-run');
    assert.equal(dry.code, 0, dry.stderr);
    assert.match(dry.stdout, /^would run \(in .+ · hosts: none · egress: .+\): .+ -p --no-session -ne -nc --system-prompt "?roles\/checker\/\.start\/<this start>\.md"? Start\.\n/);
    const real = await cli('roles/checker', '--harness', 'codex', '--prompt', 'Check it.');
    assert.equal(real.code, 3, real.stderr);
    assert.equal(got().at(-1).args.at(-1), 'Check it.');
    const missing = await cli('roles/checker');
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /--harness is required/);
    const absent = await new Promise((ok) =>
      execFile(process.execPath, [SCRIPT, 'roles/checker', '--harness', 'codex'], { cwd: root, env: envWith(join(tmp, 'empty')), timeout: 30_000 }, (e, stdout, stderr) =>
        ok({ code: e ? e.code : 0, stdout, stderr }),
      ),
    );
    assert.equal(absent.code, 2);
    assert.equal(absent.stderr, 'codex is not installed: no codex on PATH\n', 'one line');
  } finally {
    srv.s.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}
