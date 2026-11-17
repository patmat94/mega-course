// check-decision.selftest.mjs: the checks behind `node check-decision.mjs --self-test`. No network: the share paths
// below are refused by name, before anything looks at them. It makes and removes its own files in the temp folder.
// check-decision.mjs hands in what it tests, so it exports nothing and stays a script. Run that, not this file.

import assert from 'node:assert/strict';
import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function selfTest({ WINDOWS, MAX_BYTES, MAX_SHOWN, FRONT_MATTER, hides, quoted, Stop, withoutComments, signOffReads, keyed, frontFields, speaksOfDecision, proseOf, headingOf, cites, answerState, review, checkRecord, verdict, listInForce }) {
  assert.equal(FRONT_MATTER.source.includes('\uFEFF'), false);
  assert.ok(FRONT_MATTER.test('\uFEFF---\nstatus: proposed\n---\n'));
  assert.ok(FRONT_MATTER.test('---\r\nstatus: proposed\r\n---\r\n'));

  assert.deepEqual(keyed('**Status:** Accepted'), ['status', 'Accepted']);
  assert.deepEqual(keyed('**Status**: Accepted'), ['status', 'Accepted']);
  assert.deepEqual(keyed('- status: Accepted # a note'), ['status', 'Accepted']);
  assert.deepEqual(keyed('Signed_by: `lena-p`'), ['signed-by', 'lena-p']);
  assert.deepEqual(keyed('status:'), ['status', '']);
  assert.equal(keyed('no key here'), null);

  const front = frontFields('change: |\n  status: accepted\nhistory:\n  - status: accepted\nstatus: proposed\nowner: a\nowner: b\nsigned-by:\n  lena-p');
  assert.equal(front.values.get('status'), 'proposed');
  assert.ok(front.unclear.has('owner'));
  assert.ok(front.unclear.has('signed-by'));
  assert.ok(!front.unclear.has('status'));
  assert.equal(front.odd, false);
  for (const line of ['"status": proposed', '? status', '{status: proposed}', '# status: proposed', `${String.fromCodePoint(0x200b)}status: proposed`]) {
    assert.equal(frontFields(`status: accepted\n${line}`).odd, true, line);
  }

  assert.equal(signOffReads('lena-p · 2026-01-03 · chat', '@Lena-P'), 'ok');
  assert.equal(signOffReads('lena-p · 2026-01-03 · chat relayed', 'lena-p'), 'ok');
  assert.equal(signOffReads('lena-p · 2026-01-03 · https://x.example/1', 'lena-p'), 'ok');
  for (const other of ['lena-p2', 'lena.p', 'sam', 'Lena']) assert.equal(signOffReads(`${other} · 2026-01-03 · chat`, 'lena-p'), 'other', other);
  for (const words of ['lena-p', 'lena-p · 2026-01-03', '@Lena-P, 2026-01-03, chat', 'lena-p[bot] · 2026-01-03 · chat', 'lena-p@mail.example · 2026-01-03 · chat', '', 'Lena Petrova · 2026-01-03 · chat', 'lena-p did not sign this', 'lena-p · NOT SIGNED YET · chat', 'lena-p · 9999-99-99 · chat', 'lena-p · 2026-02-30 · chat', 'lena-p · 2026-01-03 · maybe', 'lena-p · 2026-01-03 · chat she has not answered', 'lena-p · 2026-01-03 · https://x.example/1 she refused', 'lena-p · 2026-01-03 · chat · chat', '2026-01-03 · lena-p · chat', 'true · 2026-01-03 · chat', 'approved · 2026-01-03 · chat', 'chat · 2026-01-03 · chat']) {
    assert.equal(signOffReads(words, 'lena-p'), 'unclear', words);
  }

  assert.equal(cites('- `a/b.md:12` · behavior · x'), true);
  assert.equal(cites('- https://x.example/a.ts#L9 · claim'), true);
  assert.equal(cites('- `.github/CODEOWNERS:12` · claim'), true);
  for (const line of ['- no source', '- time 10:30', '- a.b: 12']) assert.equal(cites(line), false, line);

  const comments = (text) => withoutComments(text);
  assert.deepEqual(comments('a\n<!-- b -->\n<!-- d\ne -->\nf'), { text: 'a\n\n\nf', odd: [] });
  assert.equal(comments('<!-->b\n<!--->c').text, 'b\nc');
  assert.equal(comments('<!-- x --!>y').text, 'y');
  assert.equal(comments('we write `<!--` here\nkept').text, 'we write `<!--` here\nkept');
  assert.equal(comments('```\n<!--\n```\nkept').text, '```\n<!--\n```\nkept');
  for (const text of ['<!-- a -->b', 'a <!-- b -->', '  <!-- a -->', '<!-- never closes', '```\ncode\n```', '- ```\n  a\n  ```', '  ~~~', '<!-- a --!>']) {
    assert.ok(comments(text).odd.length > 0, text);
  }
  assert.equal(headingOf('## Options ##  '), 'Options');
  assert.equal(headingOf('#nope'), null);
  assert.equal(proseOf('a\n```\n<x>\n```\n`<y>`'), 'a\n');
  assert.equal(proseOf('```npm``` <z>'), ' <z>');

  const state = (section, chosen = '3') => answerState(section, chosen, 'lena-p');
  for (const words of ['"/answer 3"', '"/answer 3."', '"/answer 3. Fine, not now."', '"/answer 3!"', '"Not this quarter. /answer 3"', '"Decline, /answer 3."', '"/answer 3." From lena-p on #41, 2026-01-03, https://x.example/1', '"/answer 3." From @Lena-P in chat, 2026-01-03', '"/answer 3." From lena-p, 2026-01-03.']) {
    assert.equal(state(`- Asked: x\n- Answer: ${words}`), 'ok', words);
  }
  assert.equal(state('- Answer: waiting'), 'waiting');
  assert.equal(state('- Asked: x'), 'none');
  assert.equal(state('- Asked: x', ''), 'none');
  assert.equal(state('- Answer: "/answer 3"\n- Answer: waiting'), 'unclear');
  assert.equal(state('- Answer: "/answer 3"', ''), 'unclear');
  assert.equal(state('    - Answer: "/answer 3"'), 'unclear');
  assert.equal(state('- Asked: x\n\nA note.\n- Answer: "/answer 3"'), 'unclear');
  for (const words of ['- **Answer:** "/answer 3"', '* Answer: "/answer 3"', '+ Answer: "/answer 3"']) assert.equal(state(words), 'unclear', words);
  for (const words of ['/answer 3', '"/answer 2"', '"/answer 3?"', '"Why /answer 3?"', '"/answer 3 or 2"', '"/answer 3.5"', '"/answer 3-2"', '"/answer 3" "/answer 2"', '"/answer 3. No, /answer 2"', '"/answer 03"', '"Not /answer 3"', '"Option 3"', '3', 'still waiting', '(waiting)', 'waiting, /answer 3', 'none yet', '/answer', '/answer: 3', '/answer3', '', '"/answer 3" from sam', '"/answer 3" From sam, 2026-01-03', '"/answer 3" From lena-p, 2026-02-30', '"/answer 3" From lena-p, soon', '"/answer 3" # no', '"/answer 3" <!-- x -->', '"/answer 3" withdrawn', '~~"/answer 3"~~']) {
    assert.equal(state(`- Answer: ${words}`), 'unclear', words);
  }

  assert.equal(quoted('a\u001b[2J\u202eb\u2028"c"\u201d'), `"a\\u{1b}[2J\\u{202e}b\\u{2028}'c''"`);
  for (const c of [0x2033, 0xff02, 0x5f4, 0x2ba, 0x275d, 0x1f676, 0xab, 0xbb]) assert.ok(!quoted(`a${String.fromCodePoint(c)}b`).includes(String.fromCodePoint(c)), c.toString(16));
  for (const c of [0x07, 0x200b, 0x2029, 0x2800, 0xe000, 0xfe0f, 0xe0041]) {
    assert.ok(quoted(`a${String.fromCodePoint(c)}b`).includes(`\\u{${c.toString(16)}}`));
  }
  assert.ok(quoted('x'.repeat(5000)).length <= MAX_SHOWN + 3);
  assert.ok(quoted(String.fromCodePoint(0x200b).repeat(190)).length <= MAX_SHOWN + 3);
  assert.equal(hides(String.fromCodePoint(0x26a0, 0xfe0f, 0x20, 0x1f469, 0x200d, 0x1f4bb, 0x9, 0x62, 0xd)), false);
  assert.equal(hides(`a${String.fromCodePoint(0x200b)}b`), true);
  assert.equal(hides(`a${String.fromCodePoint(0x200d)}b`), true);
  assert.equal(hides(`a${String.fromCodePoint(0xad)}b`), true);
  assert.equal(hides(`a${String.fromCharCode(0xd)}b`), true);

  const BODY = [
    '# 0001 · A digest',
    '## The change',
    'Lena asked for a digest.',
    '## Evidence',
    '- `a/b.md:12` · behavior · People asked.',
    '## Options',
    '| # | Option | What you build | Cost of being wrong | Undo |',
    '|---|--------|----------------|---------------------|------|',
    '| 1 | As asked | All of it | Mail | Two-way: stop |',
    '| 2 | Smaller | Some of it | Time | Two-way: remove |',
    '| 3 | Decline | Nothing | A wait | Two-way: reopen |',
    '## Recommendation',
    'Option 2, because `a/b.md:12` shows it.',
    '## Success metric',
    '- Option 1: ten opens',
    '- Option 2: ten opens',
    '- Option 3: none, nothing ships.',
    '## Reopen threshold',
    'Ten asks.',
    "## Owner's answer",
    '- Asked: chat',
    '- Answer: "/answer 2"',
    '',
  ].join('\n');
  const good = ['change: a digest', 'owner: lena-p', 'request: chat', 'date: 2026-01-02', 'status: accepted', 'chosen: 2', 'signed-by: lena-p · 2026-01-03 · chat'];
  const sign = (fields, body = BODY) => `---\n${fields.join('\n')}\n---\n${body}`;
  const word = (fields, body) => verdict(sign(fields, body))[0];
  const set = (key, value) => good.map((line) => (line.startsWith(`${key}:`) ? `${key}: ${value}`.trimEnd() : line));
  const says = (body) => word(good, body);
  assert.equal(word(good), 'in force');
  assert.equal(review(sign(good)).problems.length, 0);
  for (const status of ['proposed', 'superseded', 'superseded by 0009', 'Deprecated', 'withdrawn', 'draft']) {
    assert.equal(word(set('status', status)), 'not in force', status);
  }
  for (const status of ['Accepted', 'Accepted (2026-01-03)', 'accepted on 2026-01-03', 'accepted*', '"accepted', '*accepted', `accepted${String.fromCodePoint(0x200b)}`, 'accepted # until the owner objects', 'accepted?', 'accepted, superseded by 0009', 'accepted until the owner objects', 'accepted/proposed', 'Proposed -> Accepted', 'RFC accepted', 'declined', 'approved', 'Rejected', 'done', 'Reverted the old rule, accepted', 'superseded-proposal accepted', 'Replaced 0004: accepted', 'deprecated? no. accepted']) {
    assert.equal(word(set('status', status)), 'read it', status);
  }
  for (const extra of ['superseded-by: 0009', 'superseded-by: []', 'superseded-by:', 'supersededBy: 0009', 'deprecated: true', 'draft: true', 'expires: 2020-01-01', 'signed: lena-p', 'owners: a, b', 'Status: proposed', 'status_: proposed']) {
    assert.equal(word([...good, extra]), 'read it', extra);
  }
  assert.equal(word([...good, 'superseded-by:', '  - 0009']), 'read it');
  assert.equal(word(set('signed-by', '')), 'not in force');
  assert.equal(word(good.filter((line) => !line.startsWith('signed-by'))), 'read it');
  assert.equal(word(good.filter((line) => !line.startsWith('owner'))), 'read it');
  assert.equal(word(good.filter((line) => !line.startsWith('status'))), 'read it');
  assert.equal(word(good.filter((line) => !line.startsWith('chosen'))), 'read it');
  assert.equal(word(set('owner', 'rook[bot]')), 'not in force');
  assert.equal(word(set('signed-by', 'lena-p[bot] · 2026-01-03 · chat')), 'read it');
  assert.equal(word(set('signed-by', 'sam · 2026-01-03 · chat')), 'read it');
  assert.equal(word(set('signed-by', 'lena-p · 2026-01-03 # she did not sign')), 'read it');
  assert.equal(word(set('signed-by', 'lena-p · 2026-01-01 · chat')), 'read it');
  assert.equal(word(set('signed-by', 'lena-p · 9999-12-31 · chat')), 'read it');
  assert.equal(word(set('date', 'soon')), 'read it');
  for (const owner of ['<handle of the person who decides>', 'tbd', 'unknown', 'claude', 'claude-code', 'claude.ai', 'dependabot', 'agent', 'me', 'admin', 'maintainers', 'gemini', 'github-copilot', 'gpt-4', 'rookbot', 'dependabot', 'release-bot', 'bot1', 'product-team', 'handle', 'copilot-swe-agent', 'lena-p, sam', 'Lena P (@lena-p)', '@acme/product', 'lena-p_']) {
    assert.equal(word(set('owner', owner)), 'read it', owner);
  }
  assert.equal(word(['change: |', '  status: accepted', '  signed-by: lena-p', 'status: proposed', 'owner: lena-p', 'signed-by:']), 'not in force');
  assert.equal(word(['status: accepted', ...good]), 'read it');
  assert.equal(word([...good.slice(0, 6), 'signed-by:', '  lena-p · 2026-01-03 · chat']), 'read it');
  assert.equal(word(['sta<!--', '-->tus: accepted', ...good.filter((line) => !line.startsWith('status'))]), 'read it');
  assert.equal(verdict('---\nnote: y\rstatus: proposed\nowner: lena-p\nsigned-by: lena-p\n---\n')[0], 'read it');
  const answering = (line) => BODY.replace('- Answer: "/answer 2"', line);
  for (const line of ['- Answer: waiting', '- Answer: still waiting', '- Answer: "/answer 3"', '- Answer: "/answer 2"\n- Answer: waiting', 'Use `<!--` here.\n- Answer: waiting\n`-->`\n- Answer: "/answer 2"']) {
    assert.equal(says(answering(line)), 'read it', line);
  }
  assert.equal(says(answering('- Answer: "/answer 2."')), 'in force');
  assert.equal(says(`${BODY}\n## What happened next\n\nThe agent replied.\n`), 'in force');
  assert.equal(says(`${BODY}\n<!-- A note of its own. -->\n`), 'in force');
  assert.equal(says(`${BODY}\n\`\`\`\ncode\n\`\`\`\n`), 'read it');
  assert.equal(word(set('chosen', '9')), 'read it');
  assert.equal(word(set('chosen', 'Decline')), 'read it');
  assert.equal(word(set('chosen', '02')), 'read it');
  assert.equal(says(BODY.replace("## Owner's answer", "## Owner's answer (example)\n- Answer: \"/answer 2\"\n## Owner's answer")), 'read it');
  for (const line of ['**Status:** Superseded by 0009', '**Status**: Retired', '> Superseded by [0009](0009.md)', '| Status | Proposed |', '### Status', 'This record is superseded by 0009.', 'This decision was withdrawn.', 'Obsolete: see 0009.', 'superseded_by: 0009', `${String.fromCodePoint(0xff33)}uperseded by 0009`, `${String.fromCodePoint(0x405)}uperseded by 0009`]) {
    assert.equal(says(`${BODY}\n${line}\n`), 'read it', line);
  }
  for (const line of ['<p hidden>', '<?x', 'a <b>c</b>', '&#83;uperseded', '~~old~~', 'a\n---', `${String.fromCodePoint(0xff40)}`, `a${String.fromCodePoint(0x430)}b`]) {
    assert.equal(says(`${BODY}\n${line}\n`), 'read it', line);
  }
  for (const line of ['We supersede nothing here.', 'This supersedes 0002.', 'ADR 3 was superseded by ADR 7.', 'Status quo stays for admins.', 'Status: reply sent.', 'The old API is deprecated upstream.', 'It should be\nretired after June.', 'Answers came from three calls.', 'A record is replaced on import.', 'x < 3 and y > 2', 'a=1&b=2', 'See <https://x.example/a>.', '`<div>` stays.', `\u{394}CTR, 40\u{b5}s`]) {
    assert.equal(says(BODY.replace('Ten asks.', line)), 'in force', line);
  }
  assert.equal(says(`${BODY}x${String.fromCodePoint(0xe0041)}\n`), 'read it');
  assert.ok(verdict(sign(good, `${BODY}x${String.fromCodePoint(0xe0041)}\n`))[1].includes('hidden characters on line'));
  const old = '**Status:** Accepted\n**Owner:** lena-p\n**Signed-by:** lena-p\n';
  for (const text of [`# old\n\n${old}`, `--- \nchange: |\n  status: accepted\n  owner: lena-p\n  signed-by: lena-p\n---\n`, `# old\n\n### Status\n\nProposed\n\n${old}`]) {
    assert.notEqual(verdict(text)[0], 'in force', text);
  }
  assert.equal(verdict(`# old\n\n${old}`)[0], 'read it');

  assert.ok(review('nothing').problems.some((problem) => problem.startsWith('no front matter')));
  assert.ok(review(`${sign(['status: maybe'])}# a`).problems.includes('front matter: status is proposed, accepted or superseded'));
  assert.ok(review(`${sign(['status: proposed', 'owner: rook[bot]'])}# a`).problems.some((problem) => problem.startsWith('owner: name one person')));
  assert.ok(review(`${sign(['status: proposed', 'signed-by: lena-p'])}# a`).problems.some((problem) => problem.startsWith('a proposed record is not signed')));
  assert.ok(review(sign(good, '## Options\n| 3 | a | b | c | d |\n| 3 | e | f | g | h |\n')).problems.some((problem) => problem.includes('two rows')));
  assert.ok(review(sign(set('status', 'superseded by 0009'))).problems.length === 0);
  assert.ok(speaksOfDecision('# a\n\n## Status\n\nAccepted\n'));

  // Each of these stalled a pattern or a pass once: they must stay quick.
  const size = 1 << 20;
  const started = Date.now();
  for (const text of [
    '<!--'.repeat(size / 4),
    `a${' '.repeat(size)}x`,
    `a${'_'.repeat(size)}x`,
    `---\nstatus: ${' '.repeat(size)}x\n---\n`,
    `---\nstatus: accepted${' '.repeat(size)}x\n---\n`,
    `---\n${'a:\n'.repeat(size / 3)}---\n`,
    `# a${' '.repeat(size)}x`,
    `# a${' #'.repeat(size / 2)}x`,
    `## Evidence\n- ${'a'.repeat(size)}`,
    `## Evidence\n- ${'a.'.repeat(size / 2)}`,
    `---\n${'\n--- x'.repeat(size / 6)}`,
  ]) {
    review(text);
    verdict(text);
  }
  assert.ok(Date.now() - started < 30000);

  const back = process.cwd();
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'bet-self-test-')));
  const other = realpathSync(mkdtempSync(join(tmpdir(), 'bet-self-test-')));
  const stops = (act, words) =>
    assert.throws(act, (error) => error instanceof Stop && words.test(error.message));
  try {
    process.chdir(dir);
    writeFileSync(join(other, 'a.md'), sign(good));
    mkdirSync('decisions');
    mkdirSync('decisions/older');
    writeFileSync('decisions/0001.md', sign(good));
    writeFileSync('decisions/0002.md', sign(['status: proposed', 'owner: lena-p', 'signed-by:']));
    writeFileSync('decisions/README.md', 'not a record');
    writeFileSync('decisions/INDEX.md', sign(good));
    writeFileSync('decisions/0003.md', Buffer.from(`\uFEFF${sign(good)}`, 'utf16le'));
    writeFileSync('decisions/0004.md', Buffer.alloc(MAX_BYTES + 1, 0x61));
    writeFileSync('decisions/0005.markdown', sign(good));
    writeFileSync('decisions/photo.png', 'x');
    symlinkSync(other, 'decisions/door.md', 'junction');
    linkSync(join(other, 'a.md'), 'decisions/hard.md');
    symlinkSync(other, 'door', 'junction');
    linkSync(join(other, 'a.md'), 'hard.md');

    const list = listInForce('decisions').printed;
    assert.match(list.find((line) => line.includes('0001')), /^in force /);
    assert.match(list.find((line) => line.includes('0002')), /^not in force /);
    assert.match(list.find((line) => line.includes('0003')), /^skipped .*not UTF-8/);
    assert.match(list.find((line) => line.includes('0004')), /^skipped .*too large/);
    assert.match(list.find((line) => line.includes('0005')), /^in force /);
    assert.match(list.find((line) => line.includes('INDEX')), /^in force /);
    assert.match(list.find((line) => line.includes('door')), /^skipped .*link/);
    assert.match(list.find((line) => line.includes('hard')), /^skipped .*hard link/);
    assert.match(list.find((line) => line.includes('older')), /^skipped .*folder/);
    assert.ok(!list.some((line) => line.includes('README')));
    assert.equal(list.at(-1), '3 of 8 in force, 5 skipped, other files not read: 1.');

    const names = ['..', '../a.md', 'decisions/../../a.md', join(other, 'a.md')];
    if (WINDOWS) names.push('\\\\server.invalid\\share\\a.md', '//server.invalid/share/a.md', '\\\\?\\C:\\a.md', 'Z:a.md', 'decisions/0001.md:hidden');
    for (const name of names) {
      stops(() => checkRecord(name), /outside the folder/);
      stops(() => listInForce(name), /outside the folder/);
    }
    stops(() => listInForce('door'), /is a link/);
    stops(() => checkRecord('door/a.md'), /is a link/);
    stops(() => checkRecord('hard.md'), /hard link/);
    stops(() => checkRecord('decisions'), /not a file/);
    stops(() => checkRecord('nothing.md'), /Cannot find/);
    assert.match(listInForce('nothing').printed[0], /^No folder/);
    assert.equal(checkRecord('decisions/0002.md').code, 1);
  } finally {
    process.chdir(back);
    rmSync(dir, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
}
