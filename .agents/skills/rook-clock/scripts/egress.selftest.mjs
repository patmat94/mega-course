// egress.selftest.mjs · the checks behind `node egress.mjs --self-test`. Your agent does not run this file.
// Offline: two HTTP servers on 127.0.0.1 and a fake name lookup. Leaves no file behind.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkHop, hostLists, never, notPublic, Refused, send } from './egress.mjs';

const KEY = `wk_FAKE_${'abc123XYZ'}`;
const OTHER = `ok_FAKE_${'zz9988'}`;
const SCRIPT = fileURLToPath(new URL('./egress.mjs', import.meta.url));

function server(handler) {
  const seen = [];
  const s = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      handler(req, res, body);
    });
  });
  return new Promise((ok) => s.listen(0, '127.0.0.1', () => ok({ s, seen, port: s.address().port })));
}

const refused = async (promise, pattern) => {
  await assert.rejects(promise, (e) => {
    assert.equal(e.refused, true, `not a refusal: ${e.message}`);
    assert.match(e.message, pattern);
    assert.ok(!e.message.includes(KEY), `the key is in: ${e.message}`);
    assert.equal(e.message.split('\n').length, 1, 'a refusal is one line');
    return true;
  });
};

export async function selfTest() {
  // B is the host the key may not reach. Every test below checks it got nothing.
  const b = await server((req, res) => res.end('b'));
  const a = await server((req, res, body) => {
    const u = new URL(req.url, 'http://x');
    const to = u.searchParams.get('to');
    if (u.pathname === '/echo') {
      res.setHeader('x-echo', String(req.headers['x-key'] ?? ''));
      return res.end(`got ${u.searchParams.get('k') ?? ''} ${req.headers['x-key'] ?? ''} ${body}`);
    }
    if (u.pathname === '/go') {
      res.writeHead(Number(u.searchParams.get('code') ?? 302), { location: to.replace('$KEY', req.headers['x-key'] ?? '') });
      return res.end();
    }
    if (u.pathname === '/loop') {
      res.writeHead(302, { location: `/loop?n=${Number(u.searchParams.get('n') ?? 0) + 1}` });
      return res.end();
    }
    res.end('a');
  });
  const A = `http://127.0.0.1:${a.port}`;
  const B = `http://127.0.0.1:${b.port}`;
  const hosts = { WEATHER_KEY: [A], OTHER_KEY: [A, B] };
  const vars = { WEATHER_KEY: KEY, OTHER_KEY: OTHER };
  const opts = { hosts, vars };
  const tmp = mkdtempSync(join(tmpdir(), 'clock-egress-'));
  try {
    // 1. The key goes to its own host, filled in only here; what comes back shows the reference.
    {
      const r = await send({ url: `${A}/echo?k={{WEATHER_KEY}}`, headers: { 'x-key': '{{WEATHER_KEY}}' }, method: 'POST', body: 'b={{WEATHER_KEY}}' }, opts);
      assert.equal(r.status, 200);
      const got = a.seen.at(-1);
      assert.equal(got.headers['x-key'], KEY);
      assert.equal(new URL(got.url, 'http://x').searchParams.get('k'), KEY);
      assert.equal(got.body, `b=${KEY}`);
      assert.ok(!JSON.stringify(r).includes(KEY), 'the key is in the result');
      assert.match(r.body, /got \{\{WEATHER_KEY\}\} \{\{WEATHER_KEY\}\} b=\{\{WEATHER_KEY\}\}/);
      assert.equal(r.headers['x-echo'], '{{WEATHER_KEY}}');
      assert.match(r.url, /k=%7B%7BWEATHER_KEY%7D%7D|k=\{\{WEATHER_KEY\}\}/);
    }
    // 1b. A value with ' in a query: sent as %27, and every URL shown has the reference, not the value.
    {
      const Q = "pass'word-12345";
      const r = await send({ url: `${A}/echo?k={{QUOTE_KEY}}` }, { hosts: { QUOTE_KEY: [A] }, vars: { QUOTE_KEY: Q } });
      assert.equal(new URL(a.seen.at(-1).url, 'http://x').searchParams.get('k'), Q);
      assert.match(a.seen.at(-1).url, /k=pass%27word-12345$/);
      const out = JSON.stringify(r);
      assert.ok(!out.includes('pass%27word') && !out.includes(Q), `the value is shown: ${r.url}`);
      assert.match(r.url, /k=(%7B%7B|\{\{)QUOTE_KEY(%7D%7D|\}\})/);
    }

    // 2. A redirect to a host not on the key's list: refused, and that host gets nothing.
    for (const code of [301, 302, 303, 307, 308]) {
      await refused(
        send({ url: `${A}/go?code=${code}&to=${encodeURIComponent(`${B}/steal`)}`, headers: { 'x-key': '{{WEATHER_KEY}}' } }, opts),
        new RegExp(`^refused: WEATHER_KEY may not go to http://127\\.0\\.0\\.1:${b.port} \\(hop 2; hop 1 answered ${code}\\)$`),
      );
    }
    // The key echoed into the redirect's URL is still not shown.
    await refused(send({ url: `${A}/go?to=${encodeURIComponent(`${B}/?k=$KEY`)}`, headers: { 'x-key': '{{WEATHER_KEY}}' } }, opts), /WEATHER_KEY may not go/);
    // The same host by another name, scheme or port is another host.
    await refused(send({ url: `${A}/go?to=${encodeURIComponent(`http://localhost:${a.port}/`)}`, headers: { 'x-key': '{{WEATHER_KEY}}' } }, opts), /may not go to http:\/\/localhost/);
    await refused(send({ url: `${A}/go?to=${encodeURIComponent(`https://127.0.0.1:${a.port}/`)}`, headers: { 'x-key': '{{WEATHER_KEY}}' } }, opts), /may not go to 127\.0\.0\.1:/);
    await refused(send({ url: `${A}/go?to=${encodeURIComponent(`http://user:pw@127.0.0.1:${a.port}/`)}`, headers: { 'x-key': '{{WEATHER_KEY}}' } }, opts), /user name or password/);
    await refused(send({ url: `${A}/go?to=${encodeURIComponent('http://169.254.169.254/latest/meta-data/')}`, headers: { 'x-key': '{{WEATHER_KEY}}' } }, opts), /WEATHER_KEY may not go to http:\/\/169\.254\.169\.254 \(hop 2; hop 1 answered 302\)/);
    // Two keys in one request: each hop must be on both lists. B is on OTHER_KEY's, not WEATHER_KEY's.
    await refused(
      send({ url: `${A}/go?to=${encodeURIComponent(B)}`, headers: { 'x-key': '{{WEATHER_KEY}}', 'x-other': '{{OTHER_KEY}}' } }, opts),
      /WEATHER_KEY may not go/,
    );
    assert.equal(b.seen.length, 0, 'B got a request');

    // A request with OTHER_KEY alone may follow to B, which is on its list.
    {
      const r = await send({ url: `${A}/go?to=${encodeURIComponent(B)}`, headers: { 'x-key': '{{OTHER_KEY}}' } }, opts);
      assert.equal(r.body, 'b');
      assert.equal(r.hops.length, 2);
      assert.equal(b.seen.length, 1);
      b.seen.length = 0;
    }

    // 3. A 303 goes on as GET with no body; a 307 keeps the method and the body.
    {
      await send({ method: 'POST', url: `${A}/go?code=303&to=${encodeURIComponent(`${A}/echo`)}`, body: 'x={{WEATHER_KEY}}' }, opts);
      assert.equal(a.seen.at(-1).method, 'GET');
      assert.equal(a.seen.at(-1).body, '');
      await send({ method: 'PUT', url: `${A}/go?code=307&to=${encodeURIComponent(`${A}/echo`)}`, body: 'x={{WEATHER_KEY}}' }, opts);
      assert.equal(a.seen.at(-1).method, 'PUT');
      assert.equal(a.seen.at(-1).body, `x=${KEY}`);
    }

    // 4. At most 5 redirects.
    {
      const before = a.seen.length;
      await refused(send({ url: `${A}/loop` }, opts), /more than 5 redirects \(hop 7; hop 6 answered 302\)/);
      assert.equal(a.seen.length - before, 6);
    }

    // 5. The URL itself. Pure checks, nothing sent.
    {
      const lists = hostLists({ WEATHER_KEY: ['api.example.com'] });
      const held = new Set(['WEATHER_KEY']);
      const hop = (u) => checkHop(new URL(u), held, lists, 1);
      assert.equal(hop('https://api.example.com/v1'), true);
      assert.equal(hop('https://API.Example.COM/v1'), true, 'a host name is not case-sensitive');
      assert.equal(hop('https://api.example.com:443/'), true);
      for (const [u, why] of [
        ['http://api.example.com/', /may not go to http:\/\/api\.example\.com \(hop 1\)/],
        ['https://api.example.com:8443/', /may not go to api\.example\.com:8443 /],
        ['https://api.example.com./', /ends with a dot/],
        ['https://user@api.example.com/', /user name or password/],
        ['https://api.example.com@evil.example/', /user name or password/],
        ['https://www.api.example.com/', /may not go to www\.api\.example\.com/],
        ['https://api.example.com.evil.example/', /may not go/],
        ['https://api.\u{435}xample.com/', /may not go to api\.xn--/],
        ['https://[::1]/', /may not go/],
        ['ftp://api.example.com/', /not http or https/],
      ]) {
        assert.throws(() => hop(u), (e) => e instanceof Refused && why.test(e.message), u);
      }
      const none = new Set();
      for (const u of ['https://[::1]/', 'http://2130706433/', 'http://0x7f.1/', 'https://[::ffff:127.0.0.1]/', 'http://localhost/', 'http://printer.local/']) {
        assert.throws(() => checkHop(new URL(u), none, lists, 1), Refused, u);
      }
      assert.throws(() => hostLists({ K: ['*.example.com'] }), /wildcard/);
      assert.throws(() => hostLists({ K: ['api.example.com/v1'] }), /path/);
      assert.throws(() => hostLists({ K: ['me@api.example.com'] }), /user name/);
      assert.throws(() => hostLists({ K: ['api.example.com.'] }), /dot/);
      assert.throws(() => hostLists({ 'K-1': ['api.example.com'] }), /not a secret name/);
      assert.throws(() => hostLists({ K: 'api.example.com' }), /not a list/);
    }

    // 6. Names and addresses, with a fake lookup. Nothing reaches the network.
    {
      const to = (address) => async () => [{ address, family: address.includes(':') ? 6 : 4 }];
      await refused(send({ url: 'https://public.example/' }, { vars, lookup: to('10.0.0.5') }), /resolves to 10\.0\.0\.5, a private address/);
      await refused(send({ url: 'https://public.example/' }, { vars, lookup: to('::ffff:127.0.0.1') }), /IPv4-mapped|carries 127/);
      await refused(
        send({ url: 'https://api.example.com/', headers: { k: '{{WEATHER_KEY}}' } }, { hosts: { WEATHER_KEY: ['api.example.com'] }, vars, lookup: to('169.254.169.254') }),
        /link-local or cloud metadata/,
      );
      await refused(
        send({ url: 'http://169.254.169.254/', headers: { k: '{{WEATHER_KEY}}' } }, { hosts: { WEATHER_KEY: ['http://169.254.169.254'] }, vars }),
        /link-local or cloud metadata/,
      );
      await refused(
        send({ url: 'http://[fd00:ec2::254]/', headers: { k: '{{WEATHER_KEY}}' } }, { hosts: { WEATHER_KEY: ['http://[fd00:ec2::254]'] }, vars }),
        /link-local or cloud metadata/,
      );
      assert.equal(never('::ffff:169.254.169.254'), true);
      assert.equal(notPublic('8.8.8.8'), null);
      // A listed name connects only to the address the check saw: this name resolves nowhere for real.
      const r = await send(
        { url: `http://loop.test:${a.port}/echo`, headers: { 'x-key': '{{WEATHER_KEY}}' } },
        { hosts: { WEATHER_KEY: [`http://loop.test:${a.port}`] }, vars, lookup: to('127.0.0.1') },
      );
      assert.equal(r.status, 200);
    }

    // 7. Where a secret may never be, and a secret with no value or no list.
    await refused(send({ url: `http://{{WEATHER_KEY}}.example/` }, opts), /may not be in the host/);
    await refused(send({ url: `http://127.0.0.1:{{WEATHER_KEY}}/` }, opts), /./);
    await refused(send({ url: `${A}/echo`, headers: { '{{WEATHER_KEY}}': 'x' } }, opts), /header name/);
    await refused(send({ url: `${A}/echo`, headers: { Host: `127.0.0.1:${b.port}`, 'x-key': '{{WEATHER_KEY}}' } }, opts), /Host header/);
    await refused(send({ url: `${A}/echo?k={{NOPE_KEY}}` }, opts), /^refused: NOPE_KEY has no value/);
    await refused(send({ url: `${A}/echo?k={{EXTRA}}` }, { hosts, vars: { ...vars, EXTRA: 'extra-value-1' } }), /EXTRA may not go to .* hosts\.json lists no host for it/);
    assert.equal(b.seen.length, 0, 'B got a request');

    // 7b. A listed secret's value written out, not named, in any form: refused, nothing sent.
    {
      const before = a.seen.length + b.seen.length;
      const b64 = Buffer.from(KEY).toString('base64');
      const hex = Buffer.from(KEY).toString('hex');
      for (const req of [
        { method: 'POST', url: `${B}/x`, body: `env=${KEY}` },
        { url: `${B}/x?k=${encodeURIComponent(KEY)}` },
        { url: `${B}/x`, headers: { authorization: `Basic ${b64}` } },
        { url: `${B}/x`, headers: { [`x-${hex}`]: '1' } },
        { url: `${A}/echo`, headers: { 'x-key': KEY } },
      ]) {
        await refused(send(req, opts), /^refused: a secret value is written out; use \{\{WEATHER_KEY\}\}$/);
      }
      assert.equal(a.seen.length + b.seen.length, before, 'a written-out value was sent');
      // A body that is not text (bytes, an object) is refused, not sent as its String().
      await refused(send({ method: 'POST', url: `${A}/echo`, body: Buffer.from('x') }, opts), /^refused: the body must be text$/);
      await refused(send({ method: 'POST', url: `${A}/echo`, body: { a: 1 } }, opts), /^refused: the body must be text$/);
      assert.equal(a.seen.length + b.seen.length, before, 'a body that is not text was sent');
      // A listed secret shorter than 8 characters is refused, before anything is sent.
      await refused(send({ url: `${A}/echo` }, { hosts, vars: { ...vars, OTHER_KEY: 'o' } }), /^refused: OTHER_KEY is too short to be a secret/);
      // Certificate checks turned off: a secret is not sent.
      const was = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      try {
        await refused(send({ url: 'https://api.example.com/', headers: { k: '{{WEATHER_KEY}}' } }, { hosts: { WEATHER_KEY: ['api.example.com'] }, vars }), /certificate checks off/);
      } finally {
        if (was === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        else process.env.NODE_TLS_REJECT_UNAUTHORIZED = was;
      }
    }

    // 8. No secret in an error: a closed port, a value HTTP will not carry in a header.
    {
      const closed = await server(() => {});
      const port = closed.port;
      await new Promise((ok) => closed.s.close(ok));
      const h = { WEATHER_KEY: [`http://127.0.0.1:${port}`] };
      await assert.rejects(send({ url: `http://127.0.0.1:${port}/?k={{WEATHER_KEY}}` }, { hosts: h, vars }), (e) => !e.refused && !e.message.includes(KEY));
      const bad = `${KEY}\r\nx-evil: 1`;
      await assert.rejects(send({ url: `${A}/echo`, headers: { 'x-key': '{{WEATHER_KEY}}' } }, { hosts, vars: { WEATHER_KEY: bad } }), (e) => !e.message.includes(KEY) && !e.message.includes('x-evil'));
    }

    // 9. The command line: a refusal is one line on stderr and exit 3; a response is exit 0.
    {
      const hostsFile = join(tmp, 'hosts.json');
      const varsFile = join(tmp, 'vars.json');
      writeFileSync(hostsFile, JSON.stringify(hosts));
      writeFileSync(varsFile, JSON.stringify(vars));
      const cli = (...args) =>
        new Promise((ok) => execFile(process.execPath, [SCRIPT, ...args], { timeout: 20_000 }, (e, stdout, stderr) => ok({ code: e ? e.code : 0, stdout, stderr })));
      const no = await cli('--hosts', hostsFile, '--vars', varsFile, 'GET', `${A}/go?to=${encodeURIComponent(B)}`, '--header', 'x-key: {{WEATHER_KEY}}');
      assert.equal(no.code, 3);
      assert.equal(no.stderr.trim(), `refused: WEATHER_KEY may not go to http://127.0.0.1:${b.port} (hop 2; hop 1 answered 302)`);
      const yes = await cli('--hosts', hostsFile, '--vars', varsFile, 'GET', `${A}/echo?k={{WEATHER_KEY}}`);
      assert.equal(yes.code, 0);
      assert.match(yes.stdout, /^HTTP 200 /);
      assert.ok(!yes.stdout.includes(KEY) && !yes.stderr.includes(KEY));
      const usage = await cli('GET', A);
      assert.equal(usage.code, 2);
      assert.match(usage.stderr, /--hosts is required/);
    }
    assert.equal(b.seen.length, 0, 'B got a request');
  } finally {
    a.s.close();
    b.s.close();
    rmSync(tmp, { recursive: true, force: true });
  }
}
