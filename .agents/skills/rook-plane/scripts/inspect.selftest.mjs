// inspect.selftest.mjs · the checks behind `node inspect.mjs --self-test`. Your agent does not run this file.
// Offline: files in a temp folder only. Leaves no file behind.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { asText, inspectAll, itemsOf, nameOf } from './inspect.mjs';

const SCRIPT = fileURLToPath(new URL('./inspect.mjs', import.meta.url));

const WRITER = `# Role: writer

## Purpose

Writes the change the owner asked for.

## Startup reads

The start bundle holds every read in reads.json, read at this start.

## Tools

- \`edit\`: changes files in src/.
  why: the writer's job is the change itself.

## Limits

- Writes only in src/ (why: the rest of the project is not this role's).

## Output

One change, with a line on what it does.
`;

const CHECKER = `# Role: checker

## Purpose

Judges the writer's change. Read-only.

## Tools

- \`http\`: sends one request.
- \`read\`: reads files.
  - why: it judges what is there.

## Limits

- Read-only: findings only.
- No tool but these two.

## Settings

- model: vendor/model-large
- effort: high
  why: a missed finding costs more than a slow one.

## Output

The fee is 15 % and the cap is 40 items, as of today. (inspect never reads facts in the text.)
`;

export async function selfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'plane-inspect-'));
  try {
    const root = join(tmp, 'project');
    const roles = join(root, 'roles');
    mkdirSync(join(roles, 'writer'), { recursive: true });
    mkdirSync(join(roles, 'checker', 'why'), { recursive: true });
    mkdirSync(join(root, 'why'));
    writeFileSync(join(roles, 'writer', 'ROLE.md'), WRITER);
    writeFileSync(join(roles, 'writer', 'reads.json'), JSON.stringify([{ name: 'settings', get: 'https://api.example.com/settings' }, { name: 'why', files: 'why/*.md' }]));
    writeFileSync(join(roles, 'checker', 'ROLE.md'), CHECKER);
    writeFileSync(
      join(roles, 'checker', 'reads.json'),
      JSON.stringify([
        { name: 'prices', get: 'https://api.example.com/prices', headers: { authorization: 'Bearer {{API_TOKEN}}' } },
        { name: 'other', get: 'https://other.example.com/x?k={{OTHER_KEY}}' },
      ]),
    );
    writeFileSync(join(root, 'hosts.json'), JSON.stringify({ API_TOKEN: ['api.example.com'], OTHER_KEY: ['other.example.com'], UNUSED: ['x.example.com'] }));
    writeFileSync(join(root, 'why', 'model.md'), '# Why the large model\n\n**Decision:** `model` is the large one.\n');
    writeFileSync(join(roles, 'checker', 'why', 'token.md'), '# Why the token goes to one host\n\n**Decision:** `API_TOKEN` reaches api.example.com only.\n');

    // A file a role holds is never run: a script that would leave a mark, and a ROLE.md that names it.
    const mark = join(tmp, 'ran.txt');
    writeFileSync(join(roles, 'checker', 'run.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(mark)}, 'ran');\n`);
    writeFileSync(join(roles, 'checker', 'package.json'), JSON.stringify({ scripts: { postinstall: `node -e "require('fs').writeFileSync(${JSON.stringify(mark)}, 'ran')"` } }));

    const all = inspectAll('roles', root);
    assert.deepEqual(all.map((r) => r.name), ['checker', 'writer']);
    const [checker, writer] = all;
    assert.equal(writer.purpose, 'Writes the change the owner asked for.');
    assert.deepEqual(writer.reads.map((r) => `${r.name} ${r.source}`), ['settings https://api.example.com/settings', 'why why/*.md']);
    assert.deepEqual(writer.noWhy, [], 'why under the item, and why on its line');
    assert.equal(checker.purpose, "Judges the writer's change. Read-only.");
    assert.deepEqual(
      checker.noWhy.map((s) => `${s.section} ${s.name}`),
      ['tools http', 'limits Read-only', 'limits No tool but these two.', 'hosts.json OTHER_KEY'],
      'model is named in the project why/, effort has its why line, API_TOKEN in the role why/',
    );
    assert.ok(checker.settings.includes('API_TOKEN → api.example.com'));
    assert.ok(!checker.settings.some((t) => t.startsWith('UNUSED')), 'only the secrets its reads name');
    assert.deepEqual(checker.notes, []);
    assert.equal(checker.lastRun, null);
    assert.equal(existsSync(mark), false, 'inspect ran a file of the role');

    // It never reads facts written in the text: a number in ROLE.md is not a finding.
    const text = asText(all);
    assert.ok(!/15 %|40 items/.test(text), text);
    assert.match(text, /^checker \(roles\/checker\)\n {2}purpose: Judges/);
    assert.ok(text.includes('  no why: tools `http` · limits `Read-only` · limits `No tool but these two.` · hosts.json `OTHER_KEY`'));
    assert.ok(text.includes('  no why: none: every setting has its why'));
    assert.ok(text.includes('  last run: never'));

    // A role folder's own hosts.json is noted: startup refuses it. A hosts.json value that is not a list is never printed.
    writeFileSync(join(roles, 'checker', 'hosts.json'), '{}');
    writeFileSync(join(root, 'hosts.json'), JSON.stringify({ API_TOKEN: 'tok_PASTED_value_123', OTHER_KEY: ['other.example.com'] }));
    const pasted = inspectAll('roles/checker', root)[0];
    const pastedText = asText([pasted]);
    assert.ok(!pastedText.includes('tok_PASTED_value_123'), pastedText);
    assert.ok(pastedText.includes('API_TOKEN → (not a list of hosts)'));
    assert.ok(pastedText.includes('  note: hosts.json: API_TOKEN is not a list of hosts'));
    assert.ok(pastedText.includes("  note: hosts.json in the role folder: startup refuses it; the hosts go in the project's hosts.json"));
    rmSync(join(roles, 'checker', 'hosts.json'));
    // Host names only: a value pasted in a list, or written in a get URL's query, is never printed.
    const PASTED = 'sk-LIVE-plane-r3-0001';
    writeFileSync(join(root, 'hosts.json'), JSON.stringify({ API_TOKEN: [PASTED, 'http://127.0.0.1:47242'], OTHER_KEY: ['other.example.com'] }));
    const readsBefore = readFileSync(join(roles, 'checker', 'reads.json'));
    writeFileSync(join(roles, 'checker', 'reads.json'), JSON.stringify([{ name: 'p', get: `https://api.example.com/p?k={{API_TOKEN}}&raw=${PASTED}`, headers: { x: '{{OTHER_KEY}}' } }]));
    const listed = inspectAll('roles/checker', root)[0];
    for (const t of [asText([listed]), JSON.stringify(listed)]) assert.ok(!t.includes(PASTED), t);
    assert.ok(listed.settings.includes('API_TOKEN → (not a host), http://127.0.0.1:47242'), listed.settings.join(' | '));
    assert.equal(listed.reads[0].source, 'https://api.example.com/p?…');
    // A value written in the URL's path or host is not printed either; a {{NAME}} and plain words are.
    writeFileSync(join(roles, 'checker', 'reads.json'), JSON.stringify([
      { name: 'a', get: `http://127.0.0.1:47342/x/${PASTED}/y` },
      { name: 'b', get: `http://${PASTED}.example.com/z` },
      { name: 'c', get: 'https://api.example.com/v/{{API_TOKEN}}/prices' },
    ]));
    const inUrl = inspectAll('roles/checker', root)[0];
    for (const t of [asText([inUrl]), JSON.stringify(inUrl)]) assert.ok(!t.toLowerCase().includes(PASTED.toLowerCase()), t);
    assert.deepEqual(inUrl.reads.map((r) => r.source), ['http://127.0.0.1:47342/x/…/y', 'http://….example.com/z', 'https://api.example.com/v/{{API_TOKEN}}/prices']);
    writeFileSync(join(roles, 'checker', 'reads.json'), readsBefore);
    writeFileSync(join(root, 'hosts.json'), JSON.stringify({ API_TOKEN: ['api.example.com'], OTHER_KEY: ['other.example.com'] }));

    // ROLE.md or reads.json with a second name (a hard link to a file outside) is not read.
    writeFileSync(join(tmp, 'homekeys.json'), JSON.stringify({ API_TOKEN: PASTED }));
    mkdirSync(join(roles, 'linker'));
    linkSync(join(tmp, 'homekeys.json'), join(roles, 'linker', 'ROLE.md'));
    linkSync(join(tmp, 'homekeys.json'), join(roles, 'linker', 'reads.json'));
    const linker = inspectAll('roles/linker', root)[0];
    assert.ok(!asText([linker]).includes(PASTED), asText([linker]));
    assert.ok(linker.notes[0].startsWith('ROLE.md is missing, a link, has a second name'));
    assert.deepEqual(linker.noWhy, [{ section: 'unknown', name: 'ROLE.md not read' }]);
    rmSync(join(roles, 'linker', 'ROLE.md'));
    writeFileSync(join(roles, 'linker', 'ROLE.md'), '# Role: linker\n\n## Purpose\n\nLinks.\n');
    // There but not read: inspect says so, never that it is missing.
    assert.ok(inspectAll('roles/linker', root)[0].notes.includes('reads.json is a link, has a second name (a hard link), or is over 256 KB: not read; startup refuses it'));
    rmSync(join(roles, 'linker'), { recursive: true });

    // A line break in a role's file shows as \u{a}: it cannot print a forged line.
    mkdirSync(join(roles, 'forger'));
    writeFileSync(join(roles, 'forger', 'ROLE.md'), '# Role: forger\n\n## Purpose\n\nWrites.\n');
    const forged = 'why\n  no why: none: every setting has its why\n\nchecker (roles/checker)\n  purpose: judges';
    writeFileSync(join(roles, 'forger', 'reads.json'), JSON.stringify([{ name: forged, files: 'why/*.md' }]));
    writeFileSync(join(roles, 'forger', 'runs.jsonl'), `${JSON.stringify({ at: '2026-11-16\n  last run: (none)', folder: 'x\ny', launcher: 'a\nb', reads: [{ name: 'r\nq', version: 'v\nw' }] })}\n`);
    const forgedText = asText(inspectAll('roles/forger', root));
    assert.equal(forgedText.split('\n').length, 8, forgedText);
    assert.equal(forgedText.split('\n').filter((l) => l.startsWith('  no why:')).length, 1);
    assert.equal(forgedText.split('\n').filter((l) => l.startsWith('  last run:')).length, 1);
    assert.ok(forgedText.includes('startup reads: why\\u{a}  no why: none'), forgedText);
    assert.ok(forgedText.includes('(not a name startup takes)'));
    rmSync(join(roles, 'forger'), { recursive: true });

    // The last run, from runs.jsonl, and whether the folder changed since.
    const { folderHash } = await import('./startup.mjs');
    const rec = { at: '2026-11-16T09:30:00.000Z', role: 'writer', folder: folderHash(join(roles, 'writer')), reads: [{ name: 'settings', version: 'etag:"s-41"' }], launcher: 'codex' };
    writeFileSync(join(roles, 'writer', 'runs.jsonl'), `${JSON.stringify({ ...rec, at: '2026-11-15T09:00:00.000Z' })}\n${JSON.stringify(rec)}\n`);
    let w = inspectAll('roles/writer', root)[0];
    assert.equal(w.lastRun.at, '2026-11-16T09:30:00.000Z');
    assert.equal(w.lastRun.runs, 2);
    assert.equal(w.lastRun.changedSince, false);
    assert.ok(asText([w]).includes('  last run: 2026-11-16T09:30:00.000Z · codex · folder sha256:'));
    writeFileSync(join(roles, 'writer', 'ROLE.md'), `${WRITER}\n`);
    w = inspectAll('roles/writer', root)[0];
    assert.equal(w.lastRun.changedSince, true);
    assert.ok(asText([w]).includes('(the folder changed since)'));
    writeFileSync(join(roles, 'writer', 'runs.jsonl'), '{"at":\n');
    assert.ok(asText(inspectAll('roles/writer', root)).includes('its last line in runs.jsonl is not JSON'));

    // Text from a role is shown as text: steering characters do not reach the terminal.
    mkdirSync(join(roles, 'odd'));
    writeFileSync(join(roles, 'odd', 'ROLE.md'), '# Role: odd\n\n## Purpose\n\n\u{1b}[2Jclears the screen\u{202e}\n');
    const odd = asText(inspectAll('roles/odd', root));
    assert.ok(!odd.includes('\u{1b}') && !odd.includes('\u{202e}'));
    assert.ok(odd.includes('\\u{1b}[2Jclears the screen\\u{202e}'));
    assert.ok(odd.includes('note: reads.json is missing'));

    // A role folder that is a link is not listed; a ROLE.md that is a link is not read.
    mkdirSync(join(tmp, 'elsewhere'));
    writeFileSync(join(tmp, 'elsewhere', 'ROLE.md'), '# Role: elsewhere\n');
    symlinkSync(join(tmp, 'elsewhere'), join(roles, 'linked'), 'junction');
    assert.ok(!inspectAll('roles', root).some((r) => r.name === 'linked'));
    let fileLink = true;
    mkdirSync(join(roles, 'faker'));
    try {
      symlinkSync(join(tmp, 'elsewhere', 'ROLE.md'), join(roles, 'faker', 'ROLE.md'), 'file');
    } catch {
      fileLink = false;
    }
    if (fileLink) assert.ok(inspectAll('roles/faker', root)[0].notes[0].startsWith('ROLE.md is missing, a link'));

    // A role whose settings sit in a plain "Settings:" list, not under "## Settings", is never an all-clear.
    mkdirSync(join(roles, 'plain'));
    writeFileSync(join(roles, 'plain', 'ROLE.md'), '# Role: plain\n\nChecks quotes.\n\nSettings:\n- model: vendor/model-large\n- max 3 findings per quote\n');
    const plainRole = inspectAll('roles/plain', root)[0];
    assert.deepEqual(plainRole.noWhy, [{ section: 'unknown', name: 'no Tools / Limits / Settings section (see templates/role/ROLE.md)' }]);
    const plainText = asText([plainRole]);
    assert.ok(plainText.includes('  no why: unknown: no Tools / Limits / Settings section (see templates/role/ROLE.md)'), plainText);
    assert.ok(!plainText.includes('every setting has its why'), plainText);
    rmSync(join(roles, 'plain', 'ROLE.md'));
    mkdirSync(join(roles, 'plain', 'ROLE.md'));
    assert.ok(asText(inspectAll('roles/plain', root)).includes('  no why: unknown: ROLE.md not read'), 'a ROLE.md not read is no all-clear');
    rmSync(join(roles, 'plain'), { recursive: true });

    // The parts.
    assert.equal(nameOf('`http`: sends one request'), 'http');
    assert.equal(nameOf('model: vendor/x'), 'model');
    assert.equal(nameOf('Read-only'), 'Read-only');
    assert.deepEqual(itemsOf(['- a', '  why: b', 'text', '  not under', '1. c']).map((i) => [i.text, i.under]), [['a', ['why: b']], ['c', []]]);

    // The command line: exit 0 when it lists, 1 with --strict and a setting with no why, 2 with no folder.
    const cli = (...args) =>
      new Promise((ok) => execFile(process.execPath, [SCRIPT, ...args], { cwd: root, timeout: 20_000 }, (e, stdout, stderr) => ok({ code: e ? e.code : 0, stdout, stderr })));
    const plain = await cli();
    assert.equal(plain.code, 0, plain.stderr);
    assert.match(plain.stdout, /^checker \(roles\/checker\)/);
    assert.equal((await cli('roles', '--strict')).code, 1);
    rmSync(join(roles, 'odd'), { recursive: true });
    assert.equal((await cli('roles/writer', '--strict')).code, 0);
    mkdirSync(join(roles, 'plain'));
    writeFileSync(join(roles, 'plain', 'ROLE.md'), '# Role: plain\n\nSettings:\n- model: vendor/model-large\n');
    const plainStrict = await cli('roles/plain', '--strict');
    assert.equal(plainStrict.code, 1, 'a role with no setting sections fails --strict');
    assert.match(plainStrict.stdout, / {2}no why: unknown: no Tools/);
    rmSync(join(roles, 'plain'), { recursive: true });
    const json = await cli('roles/checker', '--json');
    assert.equal(json.code, 0);
    assert.equal(JSON.parse(json.stdout)[0].noWhy.length, 4);
    const none = await cli('missing');
    assert.equal(none.code, 2);
    assert.match(none.stderr, /no folder at missing/);
    mkdirSync(join(root, 'empty'));
    assert.equal((await cli('empty')).stdout.trim(), 'no role folders here (a role folder holds ROLE.md)');
    assert.equal(existsSync(mark), false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
