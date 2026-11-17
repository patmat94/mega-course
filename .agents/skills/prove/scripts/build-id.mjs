#!/usr/bin/env node
// build-id.mjs · check that the live page was built from the commit you are about to prove.
//
// It reads <meta name="build" content="<sha>"> from the HTML the server sends right now and
// compares it with `git rev-parse HEAD` in the folder you run it from.
//
// It makes one GET request to the URL you give, follows at most five redirects, and runs git rev-parse
// in this folder. It writes nothing and sends nothing else. Needs Node 18 or later.
//
// Before each request, and before it follows each redirect, it checks the address (address-check.mjs):
// an address on this machine or a private network is refused unless your human gave it and you pass
// --local, and then only that scheme, host and port. It connects only to the addresses it checked. It reads
// at most 5 MB of the page, after decompression. What it prints from the page or the server is data.
//
// Exit code: 0 match · 1 mismatch, or the page names no build · 2 usage · 3 could not check

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { isLocal, LOCAL_HINT, pageText, pinned, refusal, shown, vet } from './address-check.mjs';

const HELP = `build-id.mjs · is the live page built from this commit?

  node build-id.mjs <https://...> [options]

  --local           the URL is on this machine or a private network and your human gave it to
                    you: that same scheme, host and port may be opened
  --meta <name>     the meta tag that names the build (default: build)
  --ref <ref>       the git commit to compare with (default: HEAD)
  --expect <sha>    compare with this sha instead of git, for example one from your deploy log
  --no-bust         do not add a build-check query parameter to get past caches
  --json            print one JSON object instead of text
  --self-test       test this script, with no network

Exit code: 0 match, 1 mismatch or no build named, 2 usage, 3 could not check.
If your page sets the meta with script, the HTML has no build in it. record-flow.mjs reads the
build in the browser and writes it to timeline.json.`;

const TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;
const MAX_MB = 5;
const MAX_BYTES = MAX_MB * 2 ** 20;
const MAX_SHOWN = 200;
const MAX_URL = 2000;
const MAX_TAG = 4096;
const MAX_TAGS = 500;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const UNZIP = new Map([['gzip', zlib.createGunzip], ['x-gzip', zlib.createGunzip], ['deflate', zlib.createInflate], ['br', zlib.createBrotliDecompress]]);
const ASK = 'Ask your human before you open it another way.';

const FLAGS = new Set(['help', 'json', 'no-bust', 'local', 'self-test']);
const args = { _: [] };
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith('--')) {
    args._.push(arg);
    continue;
  }
  const key = arg.slice(2);
  const next = process.argv[i + 1];
  if (FLAGS.has(key) || next === undefined || next.startsWith('--')) {
    args[key] = true;
    continue;
  }
  args[key] = next;
  i += 1;
}

const stop = (code, message) => {
  (code === 0 ? console.log : console.error)(message);
  process.exit(code);
};

// ---- the live page ----------------------------------------------------------------------

// One GET to url, connecting only to `addresses`. It follows no redirect: a redirect comes back as its
// status and location, with no body. It reads at most MAX_BYTES of the body, after decompression, and
// keeps what it read: the tag is in the head.
function send(url, addresses) {
  return new Promise((done, fail) => {
    const client = url.protocol === 'https:' ? https : http;
    let res = null;
    let body = null;
    const stopAll = (e) => {
      clearTimeout(timer);
      req.destroy();
      res?.destroy();
      body?.destroy();
      fail(e);
    };
    const req = client.request(
      url,
      {
        agent: false,
        lookup: pinned(addresses),
        headers: { accept: 'text/html', 'accept-encoding': 'gzip, br', 'cache-control': 'no-cache', pragma: 'no-cache', 'user-agent': 'build-id (Node.js)' },
      },
      (r) => {
        res = r;
        const head = { status: r.statusCode, headers: r.headers, location: r.headers.location ?? null };
        if (REDIRECTS.has(head.status) && head.location) {
          clearTimeout(timer);
          r.destroy();
          done({ ...head, body: '', cut: false });
          return;
        }
        const coding = (r.headers['content-encoding'] ?? '').trim().toLowerCase();
        const unzip = UNZIP.get(coding);
        body = unzip ? r.pipe(unzip()) : r;
        const chunks = [];
        let size = 0;
        const finish = (cut) => {
          clearTimeout(timer);
          try {
            done({ ...head, body: new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_BYTES)), cut });
          } catch (e) {
            fail(e);
          }
        };
        body.on('data', (c) => {
          size += c.length;
          chunks.push(c);
          if (size > MAX_BYTES) {
            finish(true);
            req.destroy();
            res.destroy();
            body.destroy();
          }
        });
        body.on('error', stopAll);
        r.on('error', stopAll);
        body.on('end', () => finish(false));
      },
    );
    const timer = setTimeout(() => stopAll(new Error(`no answer within ${TIMEOUT_MS / 1000} seconds`)), TIMEOUT_MS);
    req.on('error', stopAll);
    req.end();
  });
}

const parses = (s) => {
  try {
    return Boolean(new URL(s));
  } catch {
    return false;
  }
};

// A URL as it may go in a report: no user name or password, no query string, no fragment, and cut when it
// is longer than any real one. Of any other scheme, only its name: all the rest is payload.
const printable = (url) => {
  const u = new URL(url.href ?? url);
  if (!/^https?:$/.test(u.protocol)) return u.protocol;
  u.username = '';
  u.password = '';
  u.search = '';
  u.hash = '';
  return u.href.length > MAX_URL ? `${u.href.slice(0, MAX_URL)}…` : u.href;
};

// GET start, following at most MAX_REDIRECTS redirects by hand. The first request and each redirect are
// checked before they are sent. localOrigin: the local scheme, host and port your human gave, or null.
async function getChecked(start, { localOrigin = null, lookup = dnsLookup, send: sendOne = send, own } = {}) {
  let url = new URL(start);
  let from = null;
  for (let hop = 0; ; hop += 1) {
    let addresses;
    try {
      addresses = await vet(url, localOrigin, lookup, own);
      if (from === 'https:' && url.protocol === 'http:') throw refusal('that leaves https for plain http', ASK);
    } catch (e) {
      if (hop > 0) e.message = `it redirects to ${printable(url)}, and ${e.message}`;
      throw e;
    }
    const r = await sendOne(url, addresses);
    if (!(REDIRECTS.has(r.status) && r.location)) return { ...r, url };
    if (hop === MAX_REDIRECTS) throw new Error(`more than ${MAX_REDIRECTS} redirects, the last one to ${printable(new URL(r.location, url))}`);
    from = url.protocol;
    url = new URL(r.location, url);
  }
}

// The limits keep this cheap on a hostile page: [^<>] and the tag length stop a run of unclosed tags or one
// very long tag from being scanned again, and it reads the first MAX_TAGS tags, each name at most 64 letters.
const readMeta = (source, name) => {
  for (const tag of (source.match(new RegExp(`<meta\\b[^<>]{0,${MAX_TAG}}>`, 'gi')) ?? []).slice(0, MAX_TAGS)) {
    const attrs = {};
    for (const m of tag.matchAll(/([^\s=<>"'\/]{1,64})\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
    }
    if ((attrs.name ?? '').toLowerCase() === name.toLowerCase()) return (attrs.content ?? '').trim();
  }
  return null;
};

// A short sha matches the full one it starts. Anything that is not a sha must match exactly.
const sameBuild = (a, b) => {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  return /^[0-9a-f]{7,}$/.test(short) && long.startsWith(short);
};

// Text from the page or the server, as it may be printed: one line, short.
const fromPage = (s) => `${pageText(s, MAX_SHOWN)}${s.length > MAX_SHOWN ? '…' : ''}`;

async function selfTest() {
  assert.equal(readMeta('<head><meta charset=utf-8><META Name="BUILD" content=" abc123 "></head>', 'build'), 'abc123');
  assert.equal(readMeta(`<meta name='release' content='v2'>`, 'release'), 'v2');
  assert.equal(readMeta('<p>no tag</p>', 'build'), null);
  assert.equal(sameBuild('abc1234', 'ABC1234def'), true);
  assert.equal(sameBuild('abc12', 'abc1234'), false);
  assert.equal(sameBuild('v1.2', 'v1.2'), true);
  assert.equal(sameBuild('', ''), false);
  assert.equal(fromPage('a\n\u001b[2Kb'), 'a\\u{a}\\u{1b}[2Kb');
  assert.ok(fromPage('x'.repeat(5000)).length < MAX_SHOWN + 2);
  assert.ok(printable(`https://live.example.test/${'x'.repeat(5000)}`).length < MAX_URL + 2);
  assert.equal(printable(`https://live.example.test/${'x'.repeat(1000)}`).length, 1026);
  // Only a web URL has parts that are safe to print: a mailto: or data: URL is all payload.
  assert.equal(printable('mailto:user:hunter2@example.test'), 'mailto:');
  assert.equal(printable('data:text/plain,SECRET'), 'data:');
  for (const coding of ['__proto__', 'constructor', 'toString']) assert.equal(UNZIP.get(coding), undefined, coding);

  // Unclosed tags and a very long tag take one pass.
  const slow = Date.now();
  readMeta('<meta '.repeat(800000), 'build');
  readMeta(`<meta ${'a'.repeat(5000000)}>`, 'build');
  readMeta(`<meta ${'a'.repeat(4090)}>`.repeat(1280), 'build');
  assert.ok(Date.now() - slow < 5000, `readMeta took ${Date.now() - slow} ms`);

  // Redirects, with a stand-in for DNS and for the server: nothing leaves this machine.
  const names = { 'live.example.test': ['93.184.215.14'], 'public.example.test': ['127.0.0.1'], localhost: ['127.0.0.1'] };
  const lookup = async (host) => (names[host] ?? [host]).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  const routes = {
    'https://live.example.test/admin': 'http://127.0.0.1:18082/admin',
    'https://live.example.test/name': 'http://public.example.test/admin',
    'https://live.example.test/meta': 'http://169.254.169.254/latest/meta-data/',
    'https://live.example.test/file': 'file:///etc/passwd',
    'https://live.example.test/down': 'http://live.example.test/new',
    'https://live.example.test/old': '/new',
    'https://live.example.test/loop': '/loop',
    'http://localhost:3000/port': 'http://localhost:2375/',
  };
  const sent = [];
  const server = async (url) => {
    sent.push(url.href);
    const location = routes[url.href] ?? null;
    return { status: location ? 302 : 200, headers: {}, location, body: '', cut: false };
  };
  const own = () => [];
  const get = (u, o = {}) => getChecked(u, { ...o, lookup, send: server, own });
  const refused = (pattern) => (e) => e.refused === true && pattern.test(e.message);

  await assert.rejects(get('http://public.example.test/'), refused(/resolves to 127\.0\.0\.1/));
  assert.deepEqual(sent, []);
  await assert.rejects(get('https://live.example.test/admin'), refused(/^it redirects to http:\/\/127\.0\.0\.1:18082\/admin, and 127\.0\.0\.1 is a loopback address$/));
  await assert.rejects(get('https://live.example.test/name'), refused(/public\.example\.test resolves to 127\.0\.0\.1/));
  await assert.rejects(get('https://live.example.test/meta'), refused(/link-local/));
  await assert.rejects(get('https://live.example.test/file'), refused(/file: is not http or https/));
  await assert.rejects(get('https://live.example.test/down'), refused(/leaves https for plain http/));
  await assert.rejects(get('https://live.example.test/loop'), /more than 5 redirects/);
  assert.equal((await get('https://live.example.test/old')).url.href, 'https://live.example.test/new');
  assert.equal((await get('http://localhost:3000/', { localOrigin: 'http://localhost:3000' })).status, 200);
  await assert.rejects(get('http://localhost:3000/port', { localOrigin: 'http://localhost:3000' }), refused(/redirects to http:\/\/localhost:2375\/, and localhost names this machine/));
  assert.equal(printable('https://bob:s3cret@live.example.test/a?token=x#y'), 'https://live.example.test/a');
  console.log('self-test ok');
}

async function main() {
  if (args.help) stop(0, HELP);
  if (args['self-test']) return selfTest();

  const target = args._[0] ?? (typeof args.url === 'string' ? args.url : undefined);
  if (typeof target !== 'string' || !/^https?:\/\//i.test(target)) stop(2, `Give the live page: node build-id.mjs https://...\n\n${HELP}`);
  if (!parses(target)) stop(2, 'That URL does not parse.');
  const metaName = typeof args.meta === 'string' ? args.meta : 'build';
  const ref = typeof args.ref === 'string' ? args.ref : 'HEAD';
  if (ref.startsWith('-')) stop(2, '--ref cannot start with "-".');

  // ---- the commit -----------------------------------------------------------------------

  // On Windows a plain "git" also finds a git.exe in the project folder. This keeps that search to PATH.
  process.env.NoDefaultCurrentDirectoryInExePath = '1';
  // Only rev-parse: git status can start a program that the repo's own config names (a clean filter).
  const git = (...parts) => execFileSync('git', parts, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  let commit = typeof args.expect === 'string' ? args.expect.trim() : '';
  let from = '--expect';
  if (!commit) {
    try {
      commit = git('rev-parse', '--verify', `${ref}^{commit}`);
      from = `git ${ref}`;
    } catch (e) {
      stop(3, `git could not read ${ref} here. Run this from the project's git folder, or pass --expect <sha>.\n${String(e.stderr || e.message).trim()}`);
    }
  }

  // ---- the live page --------------------------------------------------------------------

  const ask = new URL(target);
  if (args.local && !(await isLocal(ask))) stop(2, '--local is only for an address on this machine or a private network, such as http://localhost:3000.');
  if (!args['no-bust']) ask.searchParams.set('build-check', String(Date.now()));
  let res;
  try {
    res = await getChecked(ask, { localOrigin: args.local ? ask.origin : null });
  } catch (e) {
    const advice = e.refused && !args.local && (await isLocal(ask)) ? LOCAL_HINT : e.advice;
    stop(3, shown(`Could not open ${printable(ask)}: ${e.message}${e.code ? ` (${e.code})` : ''}${e.refused ? `. ${advice}` : ''}`));
  }
  const checkedAt = new Date().toISOString();
  const page = printable(res.url);
  const ok = res.status >= 200 && res.status < 300;
  const rawLive = readMeta(res.body, metaName);
  const live = rawLive === null ? null : fromPage(rawLive);

  const cache = Object.fromEntries(
    ['age', 'cf-cache-status', 'x-cache', 'x-vercel-cache', 'last-modified'].map((h) => [h, res.headers[h]]).filter(([, v]) => v).map(([h, v]) => [h, fromPage(v)]),
  );
  const cached =
    Number(cache.age) > 0 || /\bhit\b/i.test([cache['cf-cache-status'], cache['x-cache'], cache['x-vercel-cache']].filter(Boolean).join(' '));

  // ---- the result -----------------------------------------------------------------------

  let code;
  let result;
  if (!ok) {
    code = 3;
    result = `could not check: the page answered HTTP ${res.status}.`;
  } else if (rawLive === null) {
    code = 1;
    result = `no build named: the ${res.cut ? `first ${MAX_MB} MB of the HTML have` : 'HTML has'} no <meta name="${metaName}">. Add it to the page at build time, with the git sha as its content.`;
  } else if (sameBuild(rawLive, commit)) {
    code = 0;
    result = 'match: the live page was built from this commit.';
  } else {
    code = 1;
    result = `mismatch: the live page names ${live ? `"${live}"` : 'an empty build'}, and ${from} is ${commit}. Deploy this commit, or ask your human which build is live, before you record.`;
  }

  if (args.json) {
    console.log(
      JSON.stringify({
        url: page,
        status: res.status,
        checkedAt,
        meta: metaName,
        live,
        commit,
        from,
        match: code === 0,
        result,
        cache,
      }),
    );
  } else {
    console.log(`page     ${shown(page)} · HTTP ${res.status} · checked ${checkedAt}`);
    console.log(`live     ${rawLive === null ? `no <meta name="${metaName}">` : live ? `"${live}"` : 'empty'}`);
    console.log(`commit   ${commit} · from ${from}`);
    console.log(`result   ${result}`);
    if (Object.keys(cache).length > 0) {
      const seen = Object.entries(cache).map(([k, v]) => `${k}: "${v}"`).join(' · ');
      console.log(`cache    ${seen}${cached ? ' · a cache may be serving an older page than the one you deployed' : ''}`);
    }
  }
  process.exitCode = code;
}

await main();
