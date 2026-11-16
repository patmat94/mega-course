// Checks scripts/wire.mjs against two local servers: a secret is not carried across a redirect to a new host,
// is carried to the same host, and every hop is logged.  node wire-check.mjs  → exit 0 when all hold.
import http from 'node:http';
import assert from 'node:assert/strict';
import { wire, SECRET_HOSTS } from './starter/host-desk/roles/payout-runner/scripts/wire.mjs';
const a = http.createServer((q, s) => { if (q.url === '/r') { s.writeHead(307, { location: 'http://127.0.0.2:8792/x' }); return s.end(); } if (q.url === '/same') { s.writeHead(307, { location: '/ok' }); return s.end(); } s.end(JSON.stringify({ ok: q.url, key: q.headers['x-k'] ?? null })); }).listen(8791, '127.0.0.1');
const b = http.createServer((q, s) => s.end(JSON.stringify({ leaked: q.headers['x-k'] ?? null }))).listen(8792, '127.0.0.2');
SECRET_HOSTS.K = ['127.0.0.1:8791'];
const rows = []; const log = (r) => rows.push(r);
const x = await wire('POST', 'http://127.0.0.1:8791/r', { headers: { 'x-k': 'S3' }, body: { a: 1 }, secrets: { K: 'S3' }, log });
assert.equal(x.blocked, true);
const y = await wire('POST', 'http://127.0.0.1:8791/same', { headers: { 'x-k': 'S3' }, body: { a: 1 }, secrets: { K: 'S3' }, log });
assert.equal(y.status, 200); assert.equal(y.hops, 1);
assert.equal(rows.length, 4); assert.ok(rows[1].blocked);
console.log('wire-check: 3 checks pass'); a.close(); b.close();
