#!/usr/bin/env node
// browser-proxy.mjs · the browser's only way out. record-flow.mjs starts this on 127.0.0.1 and points the
// browser at it, so every request of every page (redirect hops, frames, popups, scripts, WebSockets) is
// checked with address-check.mjs before it is sent, and connects only to the addresses that were checked.
// The browser resolves no name itself, so a name cannot point somewhere else later in the run.
//
//   node browser-proxy.mjs --self-test
//
// A refused request gets no answer from that address: nothing reaches it, so nothing of it is recorded.

import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import net from 'node:net';
import { pathToFileURL } from 'node:url';
import { bare, pinned, vet } from './address-check.mjs';

const portOf = (url) => url.port || (url.protocol === 'https:' ? '443' : '80');
// Host and port, the same for http://x:3000 and ws://x:3000: a WebSocket arrives as a tunnel, with no scheme.
export const hostKey = (url) => `${url.hostname}:${portOf(url)}`;

// The addresses of a host, checked once for each host and port, so a name cannot change its answer later in
// the run. origins: what your human gave, the only local addresses allowed.
export function checker(origins, lookup, own) {
  const allowed = new Set(origins.map((o) => hostKey(new URL(o))));
  const checked = new Map();
  return async (url) => {
    const key = hostKey(url);
    if (!checked.has(key)) checked.set(key, await vet(url, allowed.has(key) ? url.origin : null, lookup, own));
    return checked.get(key);
  };
}

// onRefused(url, error) is called for each refused request.
export async function startProxy({ origins, onRefused }) {
  const check = checker(origins);
  const sockets = new Set();
  const track = (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    return socket;
  };
  const refused = (url, e) => {
    if (e.refused) onRefused(url, e);
  };

  const server = createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url);
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (url.protocol !== 'http:') {
      res.writeHead(400).end();
      return;
    }
    let addresses;
    try {
      addresses = await check(url);
    } catch (e) {
      refused(url, e);
      req.socket.destroy();
      return;
    }
    const { 'proxy-connection': _, ...headers } = req.headers;
    const up = request(
      { hostname: bare(url.hostname), port: portOf(url), path: url.pathname + url.search, method: req.method, headers, agent: false, lookup: pinned(addresses) },
      (answer) => {
        // A status under 100 passes the parser, and writeHead throws on it. A server must not be able to end
        // this process: the recording runs in it too. A 101 with no upgrade in it would only hold the socket.
        if (answer.statusCode < 200) {
          res.destroy();
          return;
        }
        try {
          res.writeHead(answer.statusCode, answer.rawHeaders);
        } catch {
          res.destroy();
          return;
        }
        answer.on('error', () => res.destroy());
        answer.pipe(res);
      },
    );
    // An upgrade the browser did not ask for: without this, its request would hang with no answer.
    up.on('upgrade', (_, socket) => {
      socket.destroy();
      res.destroy();
    });
    up.on('socket', track);
    up.on('error', () => res.destroy());
    res.on('close', () => up.destroy());
    req.pipe(up);
  });
  server.requestTimeout = 0;
  server.on('connection', track);

  // https and WebSockets ask for a tunnel. What goes through it stays encrypted, and only its address is checked.
  server.on('connect', async (req, client, head) => {
    let url;
    let addresses;
    try {
      url = new URL(`http://${req.url}`);
      addresses = await check(url);
    } catch (e) {
      if (url) refused(url, e);
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const up = track(net.connect({ host: bare(url.hostname), port: Number(portOf(url)), lookup: pinned(addresses) }));
    up.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      up.write(head);
      up.pipe(client);
      client.pipe(up);
    });
    up.once('error', () => client.destroy());
    up.once('close', () => client.destroy());
    client.once('close', () => up.destroy());
  });

  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return {
    address: `http://127.0.0.1:${server.address().port}`,
    check,
    close: () => {
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}

async function selfTest() {
  assert.equal(hostKey(new URL('http://localhost:3000/x')), 'localhost:3000');
  assert.equal(hostKey(new URL('https://localhost:3000/x')), 'localhost:3000');
  assert.equal(hostKey(new URL('http://example.test/')), 'example.test:80');
  assert.equal(hostKey(new URL('https://example.test/')), 'example.test:443');
  assert.equal(hostKey(new URL('http://example.test:443')), 'example.test:443');

  // A stand-in for DNS that changes its answer: nothing leaves this machine.
  let asked = 0;
  const rebind = async () => {
    asked += 1;
    return [{ address: asked === 1 ? '93.184.215.14' : '127.0.0.1', family: 4 }];
  };
  const own = () => [];
  const check = checker([], rebind, own);
  const url = new URL('http://rebind.example.test/');
  assert.deepEqual((await check(url)).map((a) => a.address), ['93.184.215.14']);
  assert.deepEqual((await check(url)).map((a) => a.address), ['93.184.215.14']);
  assert.equal(asked, 1);

  // The origin your human gave: its WebSocket tunnel too, but no other port.
  const loopback = async () => [{ address: '127.0.0.1', family: 4 }];
  const local = checker(['http://localhost:3000'], loopback, own);
  assert.equal((await local(new URL('http://localhost:3000/hmr'))).length, 1);
  await assert.rejects(local(new URL('http://localhost:2375/')), (e) => e.refused === true);
  console.log('self-test ok');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--self-test') await selfTest();
  else console.log('browser-proxy.mjs · used by record-flow.mjs. Run with --self-test to test it.');
}
