// judge-reviewer.mjs · the first Judge: replays sealed Cases against the Host Desk reviewer and prints one bare line
// per case. The Cases live outside this repo (default ~/mega-sealed/reviewer, or JUDGE_SEALED), so the agent that
// changes the reviewer does not edit what judges it.
//
//   node agents/judge/judge-reviewer.mjs                    every sealed case against the reviewer in this repo
//   node agents/judge/judge-reviewer.mjs --desk <host-desk>  against another copy (a proposed Revision)
//   node agents/judge/judge-reviewer.mjs --case 01           only cases whose id starts with 01
//   node agents/judge/judge-reviewer.mjs --fake-pi expect    harness check, no model: a stand-in posts each case's
//                                                           expected verdicts (all pass); --fake-pi flip flips the first (all fail)
//
// A Trial, per case: copy the Revision (roles/reviewer, roles/plane-start.mjs, why/) into a temp desk; start a stub of
// the course on 127.0.0.1 that serves the case's settings and patch and records POST /review; point only the role's
// course URLs (ROLE.md, reads.json) and its hosts at the stub, give it a throwaway ATTEMPT; run the role's own run.mjs.
// The verdict is the first POST /review the course would have taken (a JSON body naming every hunk), compared hunk by hunk.
//
// Output: `pass <case> rev <hash>` | `fail <case> rev <hash> <hunk> expected <v> got <v>, …` | `error <case> <why>`.
// Exit 0 every case passed, 1 a case failed, 2 a case could not run (or the seal is broken).
// A real run starts Pi with MODEL (default anthropic/claude-sonnet-5-5) on your Anthropic key: about 10-20 s per case.
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const SEALED = resolve(process.env.JUDGE_SEALED ?? join(homedir(), 'mega-sealed', 'reviewer'));
const DESK = resolve(arg('--desk', join(REPO, 'mega-s04e01', 'starter', 'host-desk')));
const ONLY = arg('--case', '');
const FAKE = arg('--fake-pi', '');
const MODEL = process.env.MODEL ?? 'anthropic/claude-sonnet-5-5';
const CASE_TIMEOUT_MS = Number(process.env.JUDGE_CASE_TIMEOUT_MS ?? 240_000);
// Long temp path: rook-plane's startup compares paths, and this PC's TEMP is a short name (KEEP.md, rook-plane).
const TMP = realpathSync.native(tmpdir());

const sha = (b) => createHash('sha256').update(b).digest('hex');

/** Every file under dir, as [relative path with /, bytes], sorted; skips run output. */
function filesOf(dir, base = dir) {
  const out = [];
  for (const n of readdirSync(dir).sort()) {
    if (n === '.start' || n === 'runs.jsonl' || n === 'node_modules' || n === 'test') continue;
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...filesOf(p, base));
    else out.push([relative(base, p).replace(/\\/g, '/'), readFileSync(p)]);
  }
  return out;
}

/** The Revision: the reviewer's folder, plane-start.mjs and the house notes, hashed as one exact state. */
function revisionOf(desk) {
  const parts = [
    ...filesOf(join(desk, 'roles', 'reviewer')).map(([p, b]) => [`roles/reviewer/${p}`, b]),
    ['roles/plane-start.mjs', readFileSync(join(desk, 'roles', 'plane-start.mjs'))],
    ...filesOf(join(desk, 'why')).map(([p, b]) => [`why/${p}`, b]),
  ];
  const h = createHash('sha256');
  for (const [p, b] of parts) h.update(`${p}\0${sha(b)}\n`);
  return h.digest('hex').slice(0, 12);
}

/** The sealed cases, each checked against MANIFEST.json. Throws when the seal does not hold. */
function loadCases() {
  const man = JSON.parse(readFileSync(join(SEALED, 'MANIFEST.json'), 'utf8'));
  const ids = readdirSync(join(SEALED, 'cases')).sort();
  const extra = ids.filter((id) => !(id in man.cases));
  if (extra.length) throw new Error(`case not in MANIFEST.json: ${extra.join(', ')}`);
  return Object.keys(man.cases)
    .sort()
    .filter((id) => id.startsWith(ONLY))
    .map((id) => {
      const bytes = readFileSync(join(SEALED, 'cases', id, 'case.json'));
      if (sha(bytes) !== man.cases[id]) throw new Error(`case ${id} changed since it was sealed (hash differs from MANIFEST.json)`);
      return JSON.parse(bytes);
    });
}

/** The course, as far as the reviewer sees it, for one case. Records every review POST. */
function startStub(c, attempt) {
  const posts = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const send = (status, obj) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (req.headers.authorization !== `Bearer ${attempt}`) return send(401, { status: 'refused', message: 'Bearer attempt missing or wrong.' });
      const path = new URL(req.url, 'http://x').pathname.replace(/\/+$/, '');
      if (req.method === 'GET' && path.endsWith('/settings')) return send(200, c.settings);
      if (req.method === 'GET' && path.endsWith('/patch')) return send(200, c.patch);
      if (req.method === 'POST' && path.endsWith('/review')) {
        const json = /application\/json/i.test(req.headers['content-type'] ?? '');
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch {}
        const named = new Set((parsed?.findings ?? []).map((f) => f?.hunk));
        const valid = json && Array.isArray(parsed?.findings) && c.patch.hunks.every((h) => named.has(h.id));
        posts.push({ valid, body: parsed ?? body });
        // Like the course: a malformed body does not count; the first valid review is taken, later ones read it back.
        if (!valid) return send(400, { status: 'refused', message: json ? 'Name every hunk of the patch, once each.' : 'Send the findings as JSON.' });
        const first = posts.findIndex((p) => p.valid) === posts.length - 1;
        return send(200, { status: 'received', message: 'Review received. (Judge replay: the verdict is not told to the reviewer.)', already: !first });
      }
      send(404, { status: 'refused', message: `no ${req.method} ${path} in this replay` });
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, posts, port: server.address().port })));
}

/** A temp desk holding a copy of the Revision, wired to the stub. */
function trialDesk(port, attempt) {
  const t = mkdtempSync(join(TMP, 'judge-reviewer-'));
  const origin = `http://127.0.0.1:${port}`;
  cpSync(join(DESK, 'roles', 'reviewer'), join(t, 'roles', 'reviewer'), {
    recursive: true,
    filter: (src) => !/[\\/](\.start|runs\.jsonl|test)$/.test(src),
  });
  cpSync(join(DESK, 'roles', 'plane-start.mjs'), join(t, 'roles', 'plane-start.mjs'));
  cpSync(join(DESK, 'why'), join(t, 'why'), { recursive: true });
  for (const f of ['ROLE.md', 'reads.json']) {
    const p = join(t, 'roles', 'reviewer', f);
    if (!existsSync(p)) continue; // the given S04E02 reviewer has no reads.json
    writeFileSync(p, readFileSync(p, 'utf8').split('https://hq.mega.dev').join(origin));
  }
  // The http tool matches a host as host:port; rook-plane's egress wants the origin for plain http.
  writeFileSync(join(t, 'roles', 'reviewer', 'hosts.json'), JSON.stringify({ ATTEMPT: [`127.0.0.1:${port}`, origin] }, null, 2));
  writeFileSync(join(t, 'vars.json'), JSON.stringify({ ATTEMPT: attempt, NODE_USE_SYSTEM_CA: '1' }, null, 2));
  // rook-plane reads `files` only inside a git repo, and only files git would commit.
  writeFileSync(join(t, '.gitignore'), 'vars.json\n**/.start/\n');
  return t;
}

/** A stand-in for `pi` that posts the case's expected verdicts (or flips one): checks the harness without a model. */
function fakePi(dir, c, origin, mode) {
  const findings = Object.entries(c.expect).map(([hunk, verdict], i) => ({
    hunk,
    verdict: mode === 'flip' && i === 0 ? (verdict === 'flag' ? 'pass' : 'flag') : verdict,
    reason: 'fake-pi',
  }));
  const js = join(dir, 'fake-pi.mjs');
  writeFileSync(
    js,
    `import { readFileSync } from 'node:fs';\nconst vars = JSON.parse(readFileSync(${JSON.stringify(join(dir, '..', 'vars.json'))}, 'utf8'));\n` +
      `const r = await fetch(${JSON.stringify(`${origin}/challenges/x/review`)}, { method: 'POST', headers: { authorization: 'Bearer ' + vars.ATTEMPT, 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify({ findings }))} });\nconsole.log(r.status, await r.text());\n`,
  );
  writeFileSync(join(dir, 'pi.cmd'), `@node "${js}"\r\n`);
  writeFileSync(join(dir, 'pi'), `#!/bin/sh\nexec node "${js}"\n`, { mode: 0o755 });
}

function git(cwd, ...args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));
  return new Promise((ok) => spawn('git', args, { cwd, env, stdio: 'ignore', windowsHide: true }).on('close', ok));
}

async function trial(c, rev) {
  const attempt = `judge-${randomBytes(12).toString('hex')}`;
  const stub = await startStub(c, attempt);
  const t = trialDesk(stub.port, attempt);
  try {
    await git(t, 'init', '-q');
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));
    Object.assign(env, { MODEL, TEMP: TMP, TMP, PLANE_STARTUP: join(REPO, '.agents', 'skills', 'rook-plane', 'scripts', 'startup.mjs') });
    if (FAKE) {
      const bin = join(t, 'fake-bin');
      mkdirSync(bin);
      fakePi(bin, c, `http://127.0.0.1:${stub.port}`, FAKE);
      env.PATH = `${bin}${process.platform === 'win32' ? ';' : ':'}${env.PATH ?? env.Path}`;
      delete env.Path;
    }
    const out = await new Promise((ok) => {
      const child = spawn(process.execPath, [join(t, 'roles', 'reviewer', 'run.mjs')], { cwd: t, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let text = '';
      child.stdout.on('data', (d) => (text += d));
      child.stderr.on('data', (d) => (text += d));
      const timer = setTimeout(() => child.kill(), CASE_TIMEOUT_MS);
      child.on('close', (code) => {
        clearTimeout(timer);
        ok({ code, text });
      });
      child.on('error', (e) => ok({ code: -1, text: e.message }));
    });
    const taken = stub.posts.find((p) => p.valid);
    if (!taken) {
      const last = out.text.trim().split('\n').slice(-2).join(' ').slice(0, 200);
      return `error ${c.id} rev ${rev} no valid review reached the course (${stub.posts.length} POST, exit ${out.code}): ${last}`;
    }
    const got = Object.fromEntries(taken.body.findings.map((f) => [f.hunk, String(f.verdict).toLowerCase()]));
    const wrong = Object.entries(c.expect).filter(([h, v]) => got[h] !== v);
    if (wrong.length === 0) return `pass ${c.id} rev ${rev}`;
    return `fail ${c.id} rev ${rev} ${wrong.map(([h, v]) => `${h} expected ${v} got ${got[h] ?? 'none'}`).join(', ')}`;
  } finally {
    stub.server.close();
    rmSync(t, { recursive: true, force: true });
  }
}

async function main() {
  if (!existsSync(join(SEALED, 'MANIFEST.json'))) {
    console.log(`error seal no sealed cases at ${SEALED} (set JUDGE_SEALED)`);
    return 2;
  }
  let cases;
  try {
    cases = loadCases();
  } catch (e) {
    console.log(`error seal ${e.message}`);
    return 2;
  }
  if (cases.length === 0) {
    console.log(`error seal no case id starts with "${ONLY}"`);
    return 2;
  }
  const rev = revisionOf(DESK);
  let worst = 0;
  for (const c of cases) {
    let line;
    try {
      line = await trial(c, rev);
    } catch (e) {
      line = `error ${c.id} rev ${rev} ${e?.message ?? e}`;
    }
    console.log(line);
    worst = Math.max(worst, line.startsWith('pass') ? 0 : line.startsWith('fail') ? 1 : 2);
  }
  return worst;
}

process.exitCode = await main();
