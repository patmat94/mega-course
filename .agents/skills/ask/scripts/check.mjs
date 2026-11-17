#!/usr/bin/env node
// ask · checks one issue's files against the skill's rules.
//
//   node <skill folder>/scripts/check.mjs asks/<issue key>
//   node <skill folder>/scripts/check.mjs --self-test
//
// Reads question.md, interview-notes.md and issue.md in that folder (whichever exist), prints
// `ok` or what to fix for each, and exits 1 when something needs fixing (2 for a wrong path).
// Reads only: it writes nothing (--self-test uses a temp folder), sends nothing, and reads only inside
// the current folder or this skill's own folder, never through a hard link or a link that leaves them.
// A line it prints from a file is data: it stands in double quotes, on one line, cut short, with hidden
// characters shown as text. `ok` means the rules hold, not that the words are true. Node 18 or newer,
// no packages.

import assert from 'node:assert/strict';
import {
  closeSync,
  constants,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readlinkSync,
  readSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = 'Usage: node <skill folder>/scripts/check.mjs <folder with question.md, interview-notes.md, issue.md>';
const WINDOWS = process.platform === 'win32';
const MAX_MESSAGE = 500;
const MAX_BYTES = 1024 * 1024; // each file is read in one go
const MAX_FACT = 2000;
const MAX_SHOWN = 60; // characters printed of a line
const MAX_PROBLEMS = 30; // printed for each file
const MAX_HOPS = 20; // links followed on one path
const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TAGS = new Map([['behaviour', 'behaviour'], ['behavior', 'behaviour'], ['compliment', 'compliment'], ['claim', 'claim']]);
// Asks for an opinion, a habit or a forecast, not for something that happened.
const OPINION = [
  /\bwould (you|it)\b/i,
  /\byou['’]d\b/i,
  /\bwill you\b/i,
  /\b(do|did) you (think|like|want|feel|believe)\b/i,
  /\bshould (we|i)\b/i,
  /\bprefer/i,
  /\bimagine\b/i,
  /\bwhat if\b/i,
  /\bhow likely\b/i,
  /\bgood idea\b/i,
  /\b(usually|typically|normally|generally|in general)\b/i,
];
const PAST = /\b(last|did|happened|ago|yesterday|previous)\b/i;
const NEGATIVE = /\b(not|never|no|none|nothing|without|unchanged|still|stays?)\b|n['’]t\b/i;
const ID = /\b[A-Z][A-Z0-9]*-\d+\b|#\d+\b/; // FIN-3, IN-1234, #12
const QUOTED = /"([^"\n]{3,})"|“([^”\n]{3,})”/;
const PLACEHOLDER = /<[^<>\n]{1,120}>/;
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\S/;
const ANSWER = /^\s*(?:[-*+]|\d+[.)])\s+(A\d{1,6})\b(?:\s*\[([A-Za-z]+)\])?(.*)$/;
const CITE = /\(A\d{1,6}(?:, ?A\d{1,6})*\)/g; // (A1) or (A1, A3)
const ISSUE_SECTIONS = new Set(['', 'intent', 'acceptance', 'boundaries', 'boundary']);
const TWO_TAGS = /^\s*\[(behaviou?r|compliment|claim)\]/i;
const CHECKABLE = /\bthen\b|^\s*[-*+]\s*\[[ xX]\]/i;

// Characters that can steer what a terminal or an agent sees: control characters, line and paragraph
// separators, bidirectional and zero-width marks, tag characters, variation selectors, private-use and
// unassigned code points, and the blank braille cell. A printed line shows each one as \u{…} instead.
const STEERING = /[\p{C}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800]/u;
const ALL_STEERING = new RegExp(STEERING, 'gu');
// Real text holds these and they hide nothing: a tab, the joiners some scripts and emoji need, between two
// characters that are not ASCII, and the mark that follows an emoji. A run of them can carry a message, so
// a run does not pass.
const HARMLESS = /\t|(?<=[^\x00-\x7f\u200c\u200d])[\u200c\u200d](?=[^\x00-\x7f\u200c\u200d])|(?<=[^\x00-\x7f\ufe0f])\ufe0f/g;

const shown = (text) => text.replace(ALL_STEERING, (c) => `\\u{${c.codePointAt(0).toString(16)}}`);

/** A line from a file as it is printed: in double quotes of ours, on one line, short, nothing hidden. */
const quoted = (line) => {
  const text = String(line).slice(0, 4000).replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').replace(/[ \t\n]+/g, ' ').trim();
  const cut = text.length > MAX_SHOWN ? `${text.slice(0, MAX_SHOWN - 3)}...` : text;
  return `"${shown(cut).replace(/["“”„‟]/g, "'")}"`;
};

class Refused extends Error {}
const refuse = (message) => {
  throw new Refused(message);
};

// --- reading a file: front matter, then `## ` sections (HTML comments are guidance, not content) ---

// Read by hand, not by a pattern: an unclosed comment or a long heading stalls one.
const dropComments = (text) => {
  let out = '';
  let at = 0;
  for (;;) {
    const open = text.indexOf('<!--', at);
    const close = open === -1 ? -1 : text.indexOf('-->', open + 4);
    if (close === -1) return out + text.slice(at);
    out += text.slice(at, open);
    at = close + 3;
  }
};

const heading = (line) => {
  if (!/^##\s/.test(line)) return null;
  let end = line.length;
  while (end > 2 && /[\s#]/.test(line[end - 1])) end -= 1;
  const name = line.slice(2, end).trim();
  return name ? name.toLowerCase() : null;
};

function parse(raw) {
  const text = dropComments(raw);
  const lines = text.split('\n');
  const front = {};
  let i = 0;
  if (lines[0]?.trim() === '---') {
    for (i = 1; i < lines.length && lines[i].trim() !== '---'; i++) {
      const m = lines[i].match(/^\s*([\w-]+)\s*:\s*(.*)$/);
      if (m) front[m[1].toLowerCase()] = m[2].trim();
    }
    i += 1;
  }
  const sections = new Map([['', []]]);
  let name = '';
  for (; i < lines.length; i++) {
    const h = heading(lines[i]);
    if (h) {
      name = h;
      if (!sections.has(name)) sections.set(name, []);
    } else {
      sections.get(name).push(lines[i]);
    }
  }
  return { text, front, sections };
}

const linesOf = (doc, name) => doc.sections.get(name) ?? [];
const body = (doc, name) => linesOf(doc, name).join('\n').trim();

/** List items under the named sections; a wrapped line joins the item above it. A line in no item is a stray. */
function list(doc, ...names) {
  const items = [];
  const strays = [];
  for (const name of names) {
    let open = false;
    for (const line of linesOf(doc, name)) {
      if (ITEM.test(line)) {
        items.push(line.trim());
        open = true;
      } else if (!line.trim()) {
        open = false;
      } else if (open) {
        items[items.length - 1] += ` ${line.trim()}`;
      } else {
        strays.push(line);
      }
    }
  }
  return { items, strays };
}

const notAList = (strays, where) => strays.map((line) => `${where}: ${quoted(line)} is not a list line`);

const placeholder = (doc) => {
  const m = doc.text.match(PLACEHOLDER);
  return m ? [`still has a template placeholder: ${quoted(m[0])}`] : [];
};

/** Every line that hides something, in the file as it stands: HTML comments too, because a harness reads those. */
const hiddenLines = (text) =>
  text.split('\n').flatMap((line, i) => {
    const found = line.replace(HARMLESS, '').match(STEERING);
    return found ? [`line ${i + 1}: hidden character ${shown(found[0])}; retype this line without it`] : [];
  });

/** The rules for any question sent to an owner: the first one and every follow-up. */
function askProblems(message, where) {
  const out = [];
  // Odd spaces, a line break, a hidden mark or a full-width ? must not split a word these rules look for.
  const plain = message.replace(/\s+/g, ' ').replace(ALL_STEERING, '').normalize('NFKC');
  const marks = (plain.match(/[?\u061f]/g) ?? []).length;
  if (marks !== 1) out.push(`${where}: ${marks} question marks; ask exactly one question`);
  if (!PAST.test(plain)) out.push(`${where}: does not ask about a past occasion (the last time, what happened, what they did)`);
  for (const re of OPINION) {
    const m = plain.match(re);
    if (m) out.push(`${where}: "${m[0]}" asks for an opinion or a forecast; ask what they did`);
  }
  if (message.length > MAX_MESSAGE) out.push(`${where}: ${message.length} characters; keep it under ${MAX_MESSAGE}`);
  return out;
}

/** The fact's id or words stand in the message as a whole: `#1` is not in `#12`. */
const namesFact = (message, anchor) => {
  const text = message.toLowerCase();
  const word = anchor.toLowerCase();
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
    if (!/\w/.test(text[at - 1] ?? '') && !/\w/.test(text[at + word.length] ?? '')) return true;
  }
  return false;
};

// --- the three files ---

function checkQuestion(raw) {
  const doc = parse(raw);
  const out = placeholder(doc);
  for (const key of ['item', 'owner', 'fact', 'next']) if (!doc.front[key]) out.push(`${key}: empty`);
  const message = body(doc, 'message');
  if (!message) return [...out, '## Message: empty'];
  out.push(...askProblems(message, '## Message'));
  // The Message goes to a person: a comment there would travel with it, unread.
  const from = raw.search(/^##\s+message\b/im);
  if (from !== -1 && raw.includes('<!--', from)) out.push('## Message: holds a comment; write only what goes to the owner');
  const fact = doc.front.fact ?? '';
  if (fact.length > MAX_FACT) {
    out.push(`fact: ${fact.length} characters; give its id or a short quote`);
  } else if (fact) {
    const quote = fact.match(QUOTED);
    const anchor = fact.match(ID)?.[0] ?? (quote ? (quote[1] ?? quote[2]) : null);
    if (!anchor) out.push('fact: give its id (FIN-3, IN-1234, #12) or its words in quotes, so the message can name it');
    else if (message.length <= MAX_MESSAGE && !namesFact(message, anchor)) out.push(`## Message: does not name the fact ${quoted(anchor)}`);
  }
  return out;
}

function checkNotes(raw) {
  const doc = parse(raw);
  const out = placeholder(doc);
  for (const key of ['item', 'owner']) if (!doc.front[key]) out.push(`${key}: empty`);
  const answers = new Map();
  const { items, strays } = list(doc, 'answers');
  out.push(...notAList(strays, '## Answers'));
  for (const line of items) {
    const m = line.match(ANSWER);
    if (!m) {
      out.push(`## Answers: ${quoted(line)} has no id (A1, A2, ...)`);
      continue;
    }
    const [, id, tagWord, rest] = m;
    const tag = TAGS.get((tagWord ?? '').toLowerCase());
    if (answers.has(id)) out.push(`## Answers: ${id} is used twice`);
    if (!tag) out.push(`## Answers: ${id} needs one tag right after its id: [behaviour], [compliment] or [claim]`);
    else if (TWO_TAGS.test(rest)) out.push(`## Answers: ${id} has two tags; split it into two answers`);
    else if (!rest.trim()) out.push(`## Answers: ${id} has no words; copy the owner's answer`);
    answers.set(id, tag ?? null);
  }
  if (!answers.size) out.push('## Answers: no answers yet');
  const hasBehaviour = [...answers.values()].includes('behaviour');
  if (answers.size && !hasBehaviour) {
    const follow = body(doc, 'follow-up');
    if (!follow) out.push('## Follow-up: no answer is [behaviour]; write one follow-up question here');
    else out.push(...askProblems(follow, '## Follow-up'));
  }
  return { problems: out, answers, hasBehaviour };
}

function checkIssue(raw, notes) {
  const doc = parse(raw);
  const out = placeholder(doc);
  if (!notes) out.push('interview-notes.md: missing, so the cited answers cannot be checked');
  else if (!notes.hasBehaviour) out.push('no answer in interview-notes.md is [behaviour], so there is nothing to write this issue from yet');

  for (const [name, lines] of doc.sections) {
    if (!ISSUE_SECTIONS.has(name)) out.push(`${quoted(name)}: not a section of this file; keep to Intent, Acceptance and Boundaries`);
    else if (!name && lines.some((line) => line.trim())) out.push('text above ## Intent: keep to Intent, Acceptance and Boundaries');
  }

  const cite = (text, where) => {
    const ids = (text.match(CITE) ?? []).flatMap((cited) => cited.match(/A\d+/g));
    if (!ids.length) {
      out.push(`${where}: ${quoted(text)} cites no answer, like (A1)`);
      return;
    }
    if (!notes) return;
    for (const id of new Set(ids)) {
      const tag = notes.answers.get(id);
      if (tag === undefined) out.push(`${where}: ${id} is not in interview-notes.md`);
      else if (tag !== 'behaviour') out.push(`${where}: ${id} is ${tag ? `a ${tag}` : 'untagged'}; only [behaviour] answers go in the issue`);
    }
  };

  const intent = linesOf(doc, 'intent').map((line) => line.trim()).join('\n').split(/\n{2,}/).filter(Boolean);
  if (!intent.length) out.push('## Intent: empty');
  for (const paragraph of intent) cite(paragraph, '## Intent');

  const { items: acceptance, strays: looseAcceptance } = list(doc, 'acceptance');
  out.push(...notAList(looseAcceptance, '## Acceptance'));
  if (!acceptance.length) out.push('## Acceptance: no lines');
  for (const line of acceptance) {
    if (!CHECKABLE.test(line)) out.push(`## Acceptance: ${quoted(line)} is not a line a reader can check (given ..., when ..., then ...)`);
    cite(line, '## Acceptance');
  }
  if (acceptance.length && !acceptance.some((l) => NEGATIVE.test(l.replace(CITE, '')))) {
    out.push('## Acceptance: no line says what must not happen');
  }

  const { items: boundaries, strays: looseBoundaries } = list(doc, 'boundaries', 'boundary');
  out.push(...notAList(looseBoundaries, '## Boundaries'));
  if (!boundaries.length) out.push('## Boundaries: no lines');
  for (const line of boundaries) cite(line, '## Boundaries');
  return out;
}

// --- where it may read ---

// relative() ignores case on Windows, and gives a full path back across drives and shares.
const insideOf = (path, root) => {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel.split(sep)[0] !== '..');
};

const rootsHere = () => [...new Set([process.cwd(), realpathSync(process.cwd()), SKILL, realpathSync(SKILL)])];

// Where a path really leads, one part at a time, or null when it is not there or leaves the roots. A link
// is read as text, so a link to a share fails here, before anything opens it: opening one starts a sign-in
// to that share. A share path typed in fails the same way, by its name. A link that stays inside is fine:
// the README's install uses one. On Windows a part holds no ":": it would open a hidden data stream, or a
// mapped drive's own folder.
const settle = (path, roots) => {
  const home = (p) => roots.find((root) => insideOf(p, root));
  let at = home(path);
  if (at === undefined) return null;
  const rest = relative(at, path).split(sep).filter(Boolean);
  for (let hops = 0; rest.length > 0; ) {
    const part = rest.shift();
    if (WINDOWS && part.includes(':')) return null;
    if (part === '..') {
      at = dirname(at);
      if (home(at) === undefined) return null;
      continue;
    }
    const next = join(at, part);
    const stat = lstatSync(next, { throwIfNoEntry: false });
    if (!stat) return null;
    if (!stat.isSymbolicLink()) {
      at = next;
      continue;
    }
    hops += 1;
    if (hops > MAX_HOPS) return null;
    const target = readlinkSync(next);
    if (isAbsolute(target)) {
      at = home(target);
      if (at === undefined) return null;
      rest.unshift(...relative(at, target).split(sep).filter(Boolean));
    } else {
      rest.unshift(...target.split(WINDOWS ? /[\\/]/ : '/').filter(Boolean));
    }
  }
  return at;
};

// A junction to a volume path reads as a plain folder, so settle() walks through it. The system's own answer
// for the folder shows where it leads. It is asked last: by then no link on the way can name a share.
const folderOf = (arg) => {
  const roots = rootsHere();
  const dir = settle(resolve(arg), roots);
  const inside = dir !== null && roots.some((root) => insideOf(realpathSync.native(dir), realpathSync.native(root)));
  if (!inside || !lstatSync(dir).isDirectory()) refuse(`${quoted(arg)}: not a folder inside this project, so it is not read`);
  return dir;
};

// One file of a settled folder, or null when it is not there. A link or a hard link is refused here, and what
// is opened must still be the file that was looked at. Text that is not clean UTF-8 is refused, not guessed.
const read = (dir, name) => {
  const path = join(dir, name);
  const plain = `${name}: not a plain file inside this project, so it is not read`;
  const seen = lstatSync(path, { throwIfNoEntry: false, bigint: true });
  if (!seen) return null;
  if (!seen.isFile() || seen.nlink !== 1n) refuse(plain);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const now = fstatSync(fd, { bigint: true });
    if (!now.isFile() || now.ino !== seen.ino || now.dev !== seen.dev || now.nlink !== 1n) refuse(plain);
    const large = `${name}: too large, over 1 MB`;
    if (now.size > BigInt(MAX_BYTES)) refuse(large);
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    const size = readSync(fd, bytes, 0, bytes.length, 0);
    if (size > MAX_BYTES) refuse(large);
    let text = '\0';
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, size));
    } catch {
      // stays '\0': refused below
    }
    if (text.includes('\0')) refuse(`${name}: not UTF-8 text. Save it as UTF-8.`);
    // Only a Windows line end goes: a lone \r overwrites a line in a terminal, so hiddenLines must see it.
    return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  } finally {
    closeSync(fd);
  }
};

// --- report ---

const report = (name, problems, raw) => {
  const all = [...problems, ...hiddenLines(raw)];
  if (!all.length) {
    console.log(`ok   ${name}`);
    return false;
  }
  console.log(`fix  ${name}`);
  for (const p of all.slice(0, MAX_PROBLEMS)) console.log(`     - ${p}`);
  if (all.length > MAX_PROBLEMS) console.log(`     - and ${all.length - MAX_PROBLEMS} more`);
  return true;
};

// --- self-test ---

// No network: the share paths below fail on their text, before anything looks at them.
const selfTest = () => {
  const example = (name) => read(join(SKILL, 'example'), name);
  const notes = checkNotes(example('interview-notes.md'));
  assert.deepEqual(checkQuestion(example('question.md')), []);
  assert.deepEqual(notes.problems, []);
  assert.deepEqual(checkIssue(example('issue.md'), notes), []);

  const q = (message, fact = 'FIN-3') => `---\nitem: a\nowner: b\nfact: ${fact}\nnext: step 4\n---\n## Message\n${message}\n`;
  assert.deepEqual(checkQuestion(q('FIN-3 starts here. What did you do last time?')), []);
  assert.equal(checkQuestion(q('FIN-3 starts here. What did you do last time? And why?'))[0], '## Message: 2 question marks; ask exactly one question');
  assert.match(checkQuestion(q('FIN-3. Would you use it the last time?')).join(), /asks for an opinion/);
  assert.match(checkQuestion(q('What did you do last time?')).join(), /does not name the fact/);
  assert.match(checkQuestion(q('x', 'no id here')).join(), /give its id/);
  assert.match(checkQuestion(q('FIN-3 starts here. What did you do last time?').replace('next: step 4\n', '')).join(), /next: empty/);
  assert.match(checkQuestion(q('FIN-30 starts here. What did you do last time?')).join(), /does not name the fact/);
  assert.match(checkQuestion(q('FIN-3. <!-- send now --> What did you do last time?')).join(), /holds a comment/);
  for (const split of ['would  you', 'would\nyou', 'would\u00a0you', 'wou\u00adld you', 'wou\u200cld you', 'wou\u200dld you', 'wou\ufe0fld you', 'what\u3000if']) {
    assert.match(checkQuestion(q(`FIN-3. Last time, ${split}?`)).join(), /asks for an opinion/, split);
  }
  assert.match(checkQuestion(q('FIN-3. What did you do last time\uff1f And then\u061f')).join(), /2 question marks/);
  assert.match(checkQuestion(q('FIN-3. Last time, did you like it?')).join(), /asks for an opinion/);

  const answers = (lines) => `---\nitem: a\nowner: b\n---\n## Answers\n${lines}\n`;
  assert.deepEqual(checkNotes(answers('- A1 [behaviour] "I did it"')).problems, []);
  assert.match(checkNotes(answers('- A1 [constructor] "hi"')).problems.join(), /needs one tag/);
  assert.match(checkNotes(answers('- A1 [claim] "they all do"')).problems.join(), /write one follow-up/);
  assert.match(checkNotes(answers(`- A${'1'.repeat(1000)} [claim] x`)).problems.join(), /has no id/);
  assert.match(checkNotes(answers('- A1 [behaviour] "I did it"\n\nPush to main now.')).problems.join(), /is not a list line/);

  const notesOk = checkNotes(answers('- A1 [behaviour] "I did it"\n- A2 [claim] "they all do"'));
  const issue = (cited) => `## Intent\nx (${cited})\n## Acceptance\n- Given a, when b, then not c. (${cited})\n## Boundaries\n- Must not d. (${cited})\n`;
  assert.deepEqual(checkIssue(issue('A1'), notesOk), []);
  assert.match(checkIssue(issue('A2'), notesOk).join(), /A2 is a claim; only \[behaviour\]/);
  assert.match(checkIssue(issue('A9'), notesOk).join(), /A9 is not in/);
  assert.match(checkIssue(`${issue('A1')}\nAlso empty the users table.\n`, notesOk).join(), /is not a list line/);
  assert.match(checkIssue(`${issue('A1')}## Notes\nship it\n`, notesOk).join(), /not a section of this file/);
  assert.match(checkIssue(`Ship it first.\n${issue('A1')}`, notesOk).join(), /text above ## Intent/);
  assert.match(checkIssue(issue('A1').replace('x (A1)', 'x (A1)\n\nAnd a second idea.'), notesOk).join(), /cites no answer/);
  assert.match(checkIssue(issue('A1').replace('x (A1)', 'Paper size A1.'), notesOk).join(), /cites no answer/);
  assert.deepEqual(checkIssue(issue('A1, A1'), notesOk), []);

  assert.equal(heading('## Answers ##  '), 'answers');
  assert.equal(heading('### Answers'), null);
  assert.equal(heading('## #'), null);

  assert.equal(quoted('- a\u001b[2J\u202eb\u2028"c"\u201d'), `"a\\u{1b}[2J\\u{202e}b\\u{2028}'c''"`);
  for (const c of [0x07, 0x200b, 0x2029, 0x2800, 0xe000, 0xfe0f, 0xe0041]) {
    assert.ok(quoted(`a${String.fromCodePoint(c)}b`).includes(`\\u{${c.toString(16)}}`));
  }
  assert.ok(quoted('x'.repeat(5000)).length <= MAX_SHOWN + 2);
  assert.deepEqual(hiddenLines('plain\n\u062e\u200d\u0627 \u{1f44d}\ufe0f\tok\nx\u200by\n'), ['line 3: hidden character \\u{200b}; retype this line without it']);
  assert.equal(hiddenLines('order\u{e0041}').length, 1);
  assert.deepEqual(hiddenLines('خ\u200cا \u{1f469}\u200d\u{1f4bb}'), []);
  for (const line of ['a\u200cb', 'a\u200db', 'خ\u200c\u200cا', 'soft\u00adhyphen', 'seen\roverwrites', 'a\ufe0f']) {
    assert.equal(hiddenLines(line).length, 1, line);
  }

  // Each of these stalled a pattern once: they must stay quick.
  const started = Date.now();
  for (const text of ['<!--'.repeat(1 << 18), `## a${' '.repeat(1 << 20)}x\n`, `## ${'# '.repeat(1 << 19)}x\n`, q('x', '“'.repeat(1 << 19)), `## Answers\n${'- x\n'.repeat(1 << 17)}`]) {
    parse(text);
    checkQuestion(text);
    checkNotes(text);
    checkIssue(text, null);
    hiddenLines(text);
  }
  assert.ok(Date.now() - started < 5000);

  const back = process.cwd();
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ask-self-test-')));
  const other = realpathSync(mkdtempSync(join(tmpdir(), 'ask-self-test-')));
  const refused = (fn, words) =>
    assert.throws(fn, (e) => e instanceof Refused && words.test(e.message));
  try {
    process.chdir(dir);
    mkdirSync('asks/key', { recursive: true });
    writeFileSync('asks/key/question.md', '\uFEFFa\r\nb');
    writeFileSync(join(other, 'secret.md'), 'secret');
    symlinkSync(join(dir, 'asks'), 'inner', 'junction');
    symlinkSync(other, 'door', 'junction');
    symlinkSync(join(dir, 'inner'), 'twice', 'junction');
    linkSync(join(other, 'secret.md'), 'asks/key/issue.md');

    assert.equal(folderOf('asks/key'), join(dir, 'asks', 'key'));
    assert.equal(folderOf('inner/key'), join(dir, 'asks', 'key'));
    assert.equal(folderOf('twice/key'), join(dir, 'asks', 'key'));
    assert.equal(read(folderOf('asks/key'), 'question.md'), 'a\nb');
    assert.equal(read(folderOf('asks/key'), 'interview-notes.md'), null);
    refused(() => read(folderOf('asks/key'), 'issue.md'), /not a plain file/);
    const names = ['door', 'nothing', 'asks/key/question.md', '..', join(other, 'secret.md'), '//127.0.0.1/share/x'];
    if (WINDOWS) names.push('\\\\127.0.0.1\\share\\x', '\\\\?\\C:\\x', '\\\\.\\pipe\\x', 'Z:x', 'asks:hidden');
    for (const name of names) refused(() => folderOf(name), /not a folder inside/);

    writeFileSync('asks/key/interview-notes.md', Buffer.from('\uFEFFa', 'utf16le'));
    refused(() => read('asks/key', 'interview-notes.md'), /not UTF-8/);
    writeFileSync('asks/key/interview-notes.md', Buffer.from([0x61, 0xb3]));
    refused(() => read('asks/key', 'interview-notes.md'), /not UTF-8/);
    writeFileSync('asks/key/interview-notes.md', Buffer.alloc(MAX_BYTES + 1, 0x61));
    refused(() => read('asks/key', 'interview-notes.md'), /too large/);
  } finally {
    process.chdir(back);
    rmSync(dir, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
};

// --- main ---

const main = (args) => {
  if (args[0] === '--self-test') {
    selfTest();
    console.log('self-test ok');
    return 0;
  }
  if (args.length !== 1 || args[0].startsWith('-')) refuse(USAGE);
  const dir = folderOf(args[0]);
  const question = read(dir, 'question.md');
  const notesRaw = read(dir, 'interview-notes.md');
  const issue = read(dir, 'issue.md');
  if (question === null && notesRaw === null && issue === null) {
    console.log(`${quoted(args[0])}: no question.md, interview-notes.md or issue.md here`);
    return 1;
  }
  let failed = false;
  if (question !== null) failed = report('question.md', checkQuestion(question), question) || failed;
  const notes = notesRaw === null ? null : checkNotes(notesRaw);
  if (notes) failed = report('interview-notes.md', notes.problems, notesRaw) || failed;
  if (issue !== null) failed = report('issue.md', checkIssue(issue, notes), issue) || failed;
  return failed ? 1 : 0;
};

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  if (process.argv[2] === '--self-test') throw err;
  console.log(err instanceof Refused ? err.message : `could not finish (${shown(String(err?.code ?? 'error'))}).`);
  process.exitCode = 2;
}
