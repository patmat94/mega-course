// The reviewer's http tool, registered with a stand-in for Pi and sent to a local server.
// Run: node --test "mega-s04e01/starter/host-desk/roles/reviewer/test/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import register from '../extensions/http.mjs';

let tool;
register({ registerTool: (t) => (tool = t) });

const seen = [];
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    seen.push({ type: req.headers['content-type'] ?? null, body });
    res.end('ok');
  });
});

test('http tool content type', async (t) => {
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const url = `http://127.0.0.1:${server.address().port}/review`;
  t.after(() => server.close());
  const send = async (p) => {
    seen.length = 0;
    await tool.execute('id', { method: 'POST', url, ...p }, AbortSignal.timeout(5000));
    return seen[0];
  };

  await t.test('an object body goes out as JSON', async () => {
    const got = await send({ body: { findings: [] } });
    assert.equal(got.type, 'application/json');
    assert.equal(got.body, '{"findings":[]}');
  });

  await t.test('a string body that is a JSON object goes out as JSON, as written', async () => {
    const got = await send({ body: '{ "findings": [{ "hunk": "h-1", "verdict": "pass", "reason": "rename" }] }' });
    assert.equal(got.type, 'application/json');
    assert.equal(got.body, '{ "findings": [{ "hunk": "h-1", "verdict": "pass", "reason": "rename" }] }');
  });

  await t.test('a plain text body gets no JSON type', async () => {
    const got = await send({ body: 'hello' });
    assert.notEqual(got.type, 'application/json');
  });

  await t.test('a content type the model set is kept', async () => {
    const got = await send({ body: '{"a":1}', headers: { 'Content-Type': 'text/plain' } });
    assert.equal(got.type, 'text/plain');
  });
});
