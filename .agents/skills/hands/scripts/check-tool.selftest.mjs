// check-tool.selftest.mjs: the checks behind `node check-tool.mjs --self-test`. Nothing is started or sent.
// check-tool.mjs hands in what it tests, so it exports nothing and stays a script. Run that, not this file.

import assert from 'node:assert/strict';

export function selfTest({ MAX_LINE, unchecked, counts, printable, ok, quoted, isLocal, plainUrl, isShare, parseStub, slowPatterns, validate, walk, matches, firstDiff, parseSpec, checkSpec, pickMessage, headerValue, namesField, saysNext }) {
  const quiet = console.log;
  console.log = () => {};
  try {
    // The stub: a named address on this machine, and nothing else.
    assert.deepEqual(parseStub('API=http://127.0.0.1:9000/send'), { name: 'API', address: 'http://127.0.0.1:9000/send' });
    assert.deepEqual(parseStub('SMTP=smtp://localhost:2525'), { name: 'SMTP', address: 'smtp://localhost:2525' });
    assert.deepEqual(parseStub('API=[::1]:9000'), { name: 'API', address: '[::1]:9000' });
    assert.deepEqual(parseStub('HOST=127.0.0.1'), { name: 'HOST', address: '127.0.0.1' });
    for (const bad of ['API', 'API=', '=http://127.0.0.1', 'API=https://api.example.test', 'API=http://127.0.0.1.example.test/', 'API=http://127.0.0.1@example.test/', 'API=http://localhost\\@example.test/', 'API=http://localhost/,http://example.test/', '1A=localhost', 'NODE_OPTIONS=localhost', 'path=localhost']) {
      assert.throws(() => parseStub(bad), /--stub/, bad);
    }
    assert.equal(isLocal('http://foo.localhost/'), false);
    assert.equal(isLocal('http://[::1]:8787/x'), true);
    assert.equal(plainUrl('http://a:b@127.0.0.1:1/x?token=c'), 'http://127.0.0.1:1/x');
    assert.equal(isShare('\\\\host\\share\\x'), true);
    assert.equal(isShare('//host/share/x'), true);
    assert.equal(isShare('C:\\x\\TOOL.md'), false);

    // What may be printed: one line, no control codes, no secrets, a limit.
    assert.equal(printable('a\n\u001b[2Kb\u202e'), 'a\\u{a}\\u{1b}[2Kb\\u{202e}');
    assert.equal(printable('a\u{e0041}\u200b\ufeff'), 'a\\u{e0041}\\u{200b}\\u{feff}');
    assert.equal(printable('x'.repeat(9999)).length, MAX_LINE + 1);
    assert.equal(printable('boot token=sk-live-FAKE-0123456789'), 'boot [hidden]');
    assert.equal(printable('ghp_abcdefghijklmnopqrstuvwxyz0123'), '[hidden]');
    assert.equal(quoted('say "hi"\nnow'), '"say \\"hi\\"\\nnow"');

    // A pattern under a clock, and a schema walk with limits.
    assert.equal(matches('^a+$', 'aaa'), true);
    assert.equal(matches('^b$', 'aaa'), false);
    assert.equal(matches('(', 'a'), null);
    assert.equal(matches('^(a+)+$', `${'a'.repeat(40)}!`), null);
    slowPatterns = 0;
    unchecked.clear();
    assert.deepEqual(validate({ $ref: '#' }, 1), []);
    assert.equal(unchecked.has('a schema too deep or too large to walk'), true);
    unchecked.clear();

    // TOOL.md: its blocks, a REPLACE left, and sideEffects as a true or false only.
    const tool = (check) =>
      parseSpec(
        [
          '```json input-schema',
          '{"type":"object","properties":{"to":{"type":"string","description":"Who."}},"required":["to"],"additionalProperties":false}',
          '```',
          '```json output-schema',
          '{"type":"object"}',
          '```',
          '```json check',
          JSON.stringify({ tool: 'send', budgetBytes: 10, good: { to: 'a' }, wrong: [{ field: 'to', args: { to: 1 } }], ...check }),
          '```',
          '',
        ].join('\r\n'),
      );
    const checked = (check) => {
      counts.reset();
      return { spec: checkSpec(tool(check), { spec: 'x' }), failed: counts.failed };
    };
    assert.equal(checked({ sideEffects: true }).spec.sideEffects, true);
    assert.equal(checked({ sideEffects: false }).failed, 0);
    assert.equal(checked({}).failed, 1);
    assert.equal(checked({ sideEffects: 'yes' }).failed, 1);
    assert.deepEqual(parseSpec('a REPLACE b\nc\nREPLACE').replaceLines, [1, 3]);
    assert.deepEqual(parseSpec('```json a \r\n1\r\n2\r\n```\r\n```json b\n3').blocks, { a: '1\n2' });
    assert.equal(parseSpec('## Description\r\n\r\nSends  one\r\nmail.\r\n\r\nNot this.\r\n').description, 'Sends one mail.');
    assert.equal(parseSpec('## Name\n\nx\n').description, null);
    assert.equal(parseSpec('## Description\n\n## Input\n').description, null);

    // The schema check.
    const schema = { type: 'object', properties: { n: { type: 'integer', maximum: 3 } }, required: ['n'], additionalProperties: false };
    assert.deepEqual(validate(schema, { n: 2 }), []);
    assert.equal(validate(schema, { n: 4 }).length, 1);
    assert.equal(validate(schema, { m: 1 }).length, 2);
    assert.equal(validate({ $ref: '#/$defs/a', $defs: { a: { type: 'string' } } }, 1).length, 1);
    assert.equal(validate({ anyOf: [{ type: 'string' }, { type: 'integer' }] }, 1).length, 0);
    assert.deepEqual(firstDiff({ required: ['a', 'b'] }, { required: ['b', 'a'] }), null);
    assert.equal(firstDiff({ a: { b: 1 } }, { a: { b: 2 } }).path, '/a/b');

    // An error for the model: the field, and what to send next, not from the echoed value.
    assert.equal(namesField('to: bad value', 'to'), true);
    assert.equal(namesField('total: bad', 'to'), false);
    assert.equal(saysNext('to: wrong. Send an address.', { args: { to: 'x' } }), true);
    assert.equal(saysNext('send is wrong', { args: { to: 'send' } }), false);

    // HTTP answers, as JSON and as a stream.
    assert.equal(pickMessage('{"jsonrpc":"2.0","id":3,"result":{}}', 'application/json', 3).id, 3);
    assert.equal(pickMessage('{"jsonrpc":"2.0","id":4,"result":{}}', 'application/json', 3), null);
    assert.equal(pickMessage('event: message\ndata: {"id":3,"result":{"a":1}}\n\n', 'text/event-stream', 3).result.a, 1);
    assert.equal(headerValue('send'), 'send');
    assert.equal(headerValue('zażółć'), `=?base64?${Buffer.from('zażółć').toString('base64')}?=`);
  } finally {
    console.log = quiet;
  }
  console.log('self-test ok');
  return 0;
}
