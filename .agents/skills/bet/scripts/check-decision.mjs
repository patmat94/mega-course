#!/usr/bin/env node
// check-decision.mjs: checks a decision record made from templates/DECISION.md, or lists
// which records in a folder are in force. Plain Node 18 or later, no packages.
//
//   node check-decision.mjs decisions/0012-weekly-digest.md
//   node check-decision.mjs --in-force decisions/
//   node check-decision.mjs --self-test
//
// It reads files inside the folder you run it from and nothing else: never through a link, never a hard
// link, never a share. It installs nothing and makes no network calls. It writes nothing, except that
// --self-test makes and removes its own files in the temp folder. A value it prints from a file is data:
// it stands in double quotes, on one line, with hidden characters shown as text.
// It reads the words of a sign-off. It cannot prove who wrote them. It reads the shape of a record, and only the usual
// words for a retired one: it does not know what a record means, so a person or an agent still reads it.
// Only a record that passes the whole check, in the exact shape of the template, can be "in force". "Not in force" is
// for a plainly open or retired record, one with an empty sign-off and one owned by a bot. All else says `read it`.
// The folder you run it from counts as it is, link or not. A process that swaps folders during a run is
// noticed when the swap shows, and that is all a read-only check can do.
//
// Exit code 0: ok. 1: the record needs fixing. 2: the check could not run.

import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

const USAGE = [
  'Usage:',
  '  node check-decision.mjs <record.md>          check one record',
  '  node check-decision.mjs --in-force <folder>  list which records in a folder are in force',
  '  node check-decision.mjs --self-test          check this script',
].join('\n');

const WINDOWS = process.platform === 'win32';
const MAX_BYTES = 1024 * 1024; // a record is a page or two
const MAX_RECORDS = 2000; // files it reads in one folder
const MAX_TOTAL = 64 * 1024 * 1024; // bytes it reads in one folder
const MAX_LISTED = 200; // lines printed by --in-force
const MAX_PROBLEMS = 50; // lines printed by a check
const MAX_SHOWN = 200; // characters printed of a value
const MAX_OUTPUT = 32 * 1024; // characters printed in all
const MAX_KEY = 80; // a "key: value" line has a short key

const FRONT_MATTER = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const TAG = /\b(behaviou?r|compliment|claim)\b/i;
const NOT_PLACEHOLDER = /^<\/?(https?:|mailto:|(br|p|b|i|em|strong|code|kbd|sub|sup|details|summary)\b)/i;
const EMPTY = new Set(['', '-', '—', '–', 'none', 'n/a', 'null', '~']);
const QUIET_NAMES = new Set(['template.md', 'readme.md', 'index.md']); // not a record unless a line says so
const RECORD = /\.(?:md|markdown|mdx|txt)$/i;
const DOC_LIKE = /\.(?:md[. ]+|adoc|asciidoc|rst|mkd|mkdn|mdown|html?|org|docx?|pdf)$/i;
const SIGN_OFF = ['signed-by', 'signed', 'signed-off-by']; // older logs use these, and only signed-by binds
const WATCHED = ['status', 'owner', 'chosen', 'signed-by'];
const TEMPLATE_KEYS = new Set(['change', 'owner', 'request', 'date', ...WATCHED]);
const OPEN = /^(?:proposed|draft|open|pending|wip|rfc)$/i;
const OVER = /^(?:superseded|deprecated|withdrawn|replaced|reverted)(?:\s+by\s+\S+)?$/i;
const SUPERSEDED = /^superseded(?:\s+by\s+\S+)?$/;
const HANDLE = /^@?[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const NOT_A_NAME = /^(?:[\d-]+|true|false|yes|no|ok|signed|approved|chat)$/i; // has a handle's shape, names nobody
const BOT = /\[bot\]$/i; // github-actions[bot]: release-bot may be a person, so that one is a question
const NOT_PEOPLE = new Set(['tbd', 'tba', 'todo', 'unknown', 'unassigned', 'owner', 'owners', 'nobody', 'someone', 'anyone', 'everyone', 'team', 'product', 'assistant', 'me', 'admin', 'root', 'ci', 'system', 'maintainer', 'maintainers', 'dependabot', 'renovate', 'github-actions', 'handle', 'accepted', 'pending', 'proposed', 'placeholder', 'person']);
// An agent's own name, alone or with a tail of a product's words. Claude Dupont and a Devin are people, so a name
// alone settles nothing past this list. The real guard is the owner rule 2 finds.
const AGENT_NAME = /^(?:anthropic|aider|chatgpt|claude|codex|copilot|coderabbitai|cursor|gemini|github|gpt\d*|mergify|openai)(?:[-_.](?:actions|agent|ai|app|assist|assistant|bot|cli|code|copilot|swe|\d[\w.-]*))*$|^devin[-_.]ai\b|(?:^|[-_.])agent\d*$|-team$/i;
// A name that ends in bot, unless it is a surname.
const BOT_NAME = /bot\d*$/i;
const SURNAME = /(?:^|[-_.])(?:abbot|cabot|ribot|sabot|talbot|thibot)\d*$/i;
// A code fence of any depth, in a list or a quote too.
const ANY_FENCE = /^[\s>*+\-\d.)]*(?:`{3,}|~{3,})/;
const UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/;
// Shapes that show on a page as something other than their source: a tag and a character reference.
const RAW_HTML = /<(?!https?:|mailto:)[A-Za-z/!?]/;
const CHARACTER_REFERENCE = /&(?:#|[A-Za-z][A-Za-z0-9]*;)/;
// The usual words for a record that no longer binds, with their marks taken out first. These find a banner or a
// status line, not every way to say it: the reader of a record still reads it.
const RETIRED_WORD = 'superseded|deprecated|retired|obsolete|withdrawn|rescinded|revoked|reverted|cancell?ed';
const STATUS_LINE = new RegExp(String.raw`^[^\p{L}\d]*(?:current\s+)?(?:status|state)[ \t]*(?:[:|=\u2236\u2192-][ \t|]*(?:${RETIRED_WORD}|replaced|proposed|draft|open|pending|rejected|declined)\b|$)`, 'iu');
const RETIRES_AT_START = new RegExp(String.raw`^[^\p{L}\d]*(?:(?:note|update)[^\p{L}\d]*)?(?:superseded[\s-]*by|replaced\s+by\s+\S*\d|(?:${RETIRED_WORD})(?=[^\p{L}]*$|[^\p{L}]+(?:by|on|see|do\s+not|in\s+favou?r)\b))`, 'iu');
const SAYS_RETIRED = new RegExp(String.raw`\bthis\s+(?:record|decision)\s+(?:(?:is|was|has(?:\s+since)?\s+been)\s+(?:now\s+)?(?:${RETIRED_WORD}|replaced)\b|no\s+longer\s+applies)|[(\[](?:${RETIRED_WORD})[)\]]`, 'iu');
// A line that starts as an Answer does, in any list, quote or table. Letters a person reads as others: wide ones, and
// Cyrillic in a Latin word.
const ANSWER_LINE = /^[^\p{L}]*answer\s*(?:\([^)]*\)\s*)?[:|\uFF1A]/iu;
const WIDE_TEXT = /[\uFF10-\uFF19\uFF21-\uFF3A\uFF40-\uFF5A\uFF5E]/;
const MIXED_SCRIPTS = /\p{Script=Latin}\p{Script=Cyrillic}|\p{Script=Cyrillic}\p{Script=Latin}/u;
const SECTIONS = [
  'The change',
  'Evidence',
  'Options',
  'Recommendation',
  'Success metric',
  'Reopen threshold',
  "Owner's answer",
];

// Characters that can steer what a terminal or an agent sees: control characters, line and paragraph
// separators, bidirectional and zero-width marks, tag characters, variation selectors, private-use and
// unassigned code points, and the blank braille cell. A printed value shows each one as \u{…} instead.
const STEERING = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800]/u;
const ALL_STEERING = new RegExp(STEERING, 'gu');
// Real text holds these, and here they hide no text: a tab, the carriage return of a line end, the joiners
// inside emoji and some scripts, and the mark that makes a symbol an emoji.
const HARMLESS = /\t|\r$|(?<=\P{ASCII})[\u200c\u200d](?=\P{ASCII})|(?<=\p{Extended_Pictographic})\ufe0f/gu;
const QUOTES = /["\p{Pi}\p{Pf}\u02ba\u02dd\u02ee\u05f4\u2033\u2036\u275d\u275e\u2e42\u3003\u301d-\u301f\uff02\u{1f676}\u{1f677}]/gu;

const shown = (text) => String(text).replace(ALL_STEERING, (c) => `\\u{${c.codePointAt(0).toString(16)}}`);
const hides = (line) => STEERING.test(line.replace(HARMLESS, ''));

// A value from a file as it is printed: short, on one line, with no closing quote of its own.
const quoted = (text) => {
  const wide = shown(text.slice(0, MAX_SHOWN)).replace(QUOTES, "'");
  const cut = text.length > MAX_SHOWN || wide.length > MAX_SHOWN ? '…' : '';
  return `"${wide.slice(0, MAX_SHOWN)}${cut}"`;
};

// Keeps lines up to a limit and up to the output limit, and says what it left out.
function capped(all, limit, more) {
  const kept = [];
  let size = 0;
  for (const line of all) {
    size += line.length + 1;
    if (kept.length === limit || size > MAX_OUTPUT) break;
    kept.push(line);
  }
  return all.length > kept.length ? [...kept, more(all.length - kept.length)] : kept;
}

// Stops the check with exit code 2 and a message on stderr.
class Stop extends Error {}
function quit(message) {
  throw new Stop(message);
}

const outside = (path) => `${quoted(path)} is outside the folder you ran this from. Run the check from your project folder.`;

function inside(base, full) {
  const rel = relative(base, full);
  return !(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel));
}

// True when a path really ends inside this folder. The system's own answer: a junction to a volume path
// looks like a plain folder to lstat, and only this sees through it.
function staysInside(path) {
  try {
    return inside(realpathSync.native(process.cwd()), realpathSync.native(path));
  } catch {
    return false;
  }
}

// Where a path lands inside this folder, worked out from its name alone. A share path is refused here,
// before anything looks at it, because looking would open a sign-in to the share. On Windows the rest
// holds no ":": a drive letter with no slash can be a mapped share, and after a file name it opens a
// hidden data stream.
function located(path) {
  const rel = relative(process.cwd(), resolve(path));
  const up = rel === '..' || rel.startsWith(`..${sep}`);
  if (up || isAbsolute(rel) || (WINDOWS && rel.includes(':'))) quit(outside(path));
  return rel;
}

// Steps down from this folder one part at a time and stops at a link, before anything follows it.
// Gives the path's own stat, or undefined when it is not there.
function walk(rel) {
  let at = process.cwd();
  let stat = lstatSync(at, { bigint: true });
  for (const part of rel.split(sep).filter(Boolean)) {
    at = join(at, part);
    try {
      stat = lstatSync(at, { bigint: true });
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined;
      quit(`${quoted(relative(process.cwd(), at))} cannot be read.`);
    }
    if (stat.isSymbolicLink()) quit(`${quoted(relative(process.cwd(), at))} is a link. Point at the file itself.`);
  }
  if (!staysInside(at)) quit(`${quoted(rel)} is a link. Point at the file itself.`);
  return stat;
}

// Why a path is not a record this script opens, or undefined when it may open it.
function refused(stat) {
  if (stat.isSymbolicLink()) return 'it is a link';
  if (!stat.isFile()) return 'it is not a file';
  if (stat.nlink > 1n) return 'it is a hard link';
  if (stat.size > BigInt(MAX_BYTES)) return 'it is too large: over 1 MB';
  return undefined;
}

// Reads the file `seen` describes, and only that file: not a link swapped in since. Gives { text } or
// { why }. Text that is not clean UTF-8 is refused: a lossy read would hide what the bytes say.
function readRecord(full, seen) {
  let fd;
  try {
    fd = openSync(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  } catch {
    return { why: 'cannot read it' };
  }
  try {
    const now = fstatSync(fd, { bigint: true });
    if (now.ino !== seen.ino || now.dev !== seen.dev) return { why: 'it changed while this ran' };
    const why = refused(now);
    if (why) return { why };
    const bytes = Buffer.alloc(Number(now.size));
    const got = readSync(fd, bytes, 0, bytes.length, 0);
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, got));
    return text.includes('\0') ? { why: 'it is not UTF-8 text' } : { text };
  } catch {
    return { why: 'it is not UTF-8 text' };
  } finally {
    closeSync(fd);
  }
}

const linesOf = (text) => text.split(/\r\n|\r|\n/);

// Where a comment ends on this line, or -1.
function commentEnd(line, from) {
  const plain = line.indexOf('-->', from);
  const bang = line.indexOf('--!>', from);
  if (plain === -1 && bang === -1) return -1;
  return plain !== -1 && (bang === -1 || plain < bang) ? plain + 3 : bang + 4;
}

// Takes out comments, read by hand: a long run of spaces or marks stalls a pattern, here and below. Only a
// comment that starts a line outside a fence counts, so `<!--` written as code hides nothing. As in a page,
// "<!-->" is a whole comment, and one that never closes runs to the end. Gives the text that is left, and the
// shapes a page and this reader can read in different ways, which no binding record has: the template's own
// comments stand on lines of their own.
function withoutComments(text) {
  const kept = [];
  const odd = new Set();
  let open = false;
  let fence = null;
  for (const line of text.split('\n')) {
    if (open) {
      const end = commentEnd(line, 0);
      if (end === -1) continue;
      open = false;
      if (line.slice(end).trim() !== '' || line.includes('--!>')) odd.add('text after a comment on its line');
      kept.push(line.slice(end));
      continue;
    }
    const found = fenceMark(line);
    if (fence) {
      kept.push(line);
      if (closes(found, fence)) fence = null;
      continue;
    }
    if (ANY_FENCE.test(line)) odd.add('a code fence');
    if (found) {
      fence = found.mark;
      kept.push(line);
      continue;
    }
    const start = line.startsWith('<!--') ? 4 : undefined;
    if (start === undefined) {
      if (line.includes('<!--')) odd.add('a comment that does not start its line');
      kept.push(line);
      continue;
    }
    const short = line.startsWith('>', start) ? start + 1 : line.startsWith('->', start) ? start + 2 : -1;
    const end = short === -1 ? commentEnd(line, start) : short;
    if (end === -1) {
      open = true;
      continue;
    }
    if (line.slice(end).trim() !== '' || line.includes('--!>')) odd.add('text after a comment on its line');
    kept.push(line.slice(end));
  }
  if (open) odd.add('a comment that never closes');
  if (fence) odd.add('a code fence that never closes');
  return { text: kept.join('\n'), odd: [...odd] };
}

const isEmpty = (value) => value === undefined || EMPTY.has(value.trim().toLowerCase());

const EDGE = /[*_`"'\s]/;
function clean(value) {
  const comment = value.search(/\s#/);
  const text = comment === -1 ? value : value.slice(0, comment);
  let from = 0;
  let to = text.length;
  while (from < to && EDGE.test(text[from])) from += 1;
  while (to > from && EDGE.test(text[to - 1])) to -= 1;
  return text.slice(from, to);
}

const handle = (value) => value.trim().replace(/^@/, '').toLowerCase();

// Tomorrow, so a clock a little behind the owner's does not fail an answer of today.
const tomorrow = () => new Date(Date.now() + 864e5).toISOString().slice(0, 10);

// A date that exists, as YYYY-MM-DD.
function realDate(text) {
  const found = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!found) return false;
  const [year, month, day] = found.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// A sign-off in its parts: "lena-p · 2026-11-03 · <link>".
const signOffParts = (signed) => signed.split('·').map((part) => part.trim());

// How a sign-off reads against its owner: "ok", "other" (the template's shape, with someone else's handle), or
// "unclear". The shape is exact: handle · real date · one link, "chat" or "chat relayed".
function signOffReads(signed, owner) {
  const [who, date, where, ...more] = signOffParts(signed);
  if (!HANDLE.test(who) || NOT_A_NAME.test(who)) return 'unclear';
  if (more.length > 0 || date === undefined || where === undefined || !realDate(date)) return 'unclear';
  if (!/^(?:chat(?: relayed)?|https?:\/\/\S+)$/.test(where)) return 'unclear';
  return handle(who) === handle(owner) ? 'ok' : 'other';
}

const isBot = (owner) => BOT.test(owner.trim());
const isPerson = (owner) => HANDLE.test(owner) && !isBot(owner) && !NOT_PEOPLE.has(handle(owner)) && !AGENT_NAME.test(handle(owner)) && (!BOT_NAME.test(handle(owner)) || SURNAME.test(handle(owner)));

// One "key: value" line as [key, value], or null: "Status: Accepted", "**Status:** Accepted", "- status: x".
function keyed(line) {
  const colon = line.indexOf(':');
  if (colon < 1 || colon > MAX_KEY) return null;
  const name = line.slice(0, colon).trim().replace(/^[-*]\s+/, '').replace(/^[*_]+|[*_]+$/g, '').trim();
  if (!/^[A-Za-z][A-Za-z _-]*$/.test(name)) return null;
  return [name.toLowerCase().replace(/[\s_]+/g, '-'), clean(line.slice(colon + 1))];
}

// The fields of a record. A key that stands twice, or whose value runs over several lines, goes in `unclear`.
function fieldsFrom(pairs) {
  const values = new Map();
  const unclear = new Set();
  for (const [key, value] of pairs) {
    if (values.has(key)) unclear.add(key);
    else values.set(key, value);
  }
  return { values, unclear };
}

// Front matter: only the top-level keys, with their values as written. What stands indented under a key (a list, a
// block of text) is that key's value, however much it reads like a key of its own, so that key goes in
// `unclear`. So does a key the template watches with a comment on its line, because the comment can change what the
// line means. Any other line makes the block `odd`: a reader of real YAML could see a key this one does not.
function frontFields(block) {
  const pairs = [];
  const running = new Set();
  let odd = false;
  let last;
  for (const line of linesOf(block)) {
    if (line.trim() === '') continue;
    if (hides(line)) odd = true;
    if (/^\s/.test(line) || line.startsWith('- ')) {
      if (last === undefined) odd = true;
      else running.add(last);
      continue;
    }
    const key = /^([A-Za-z][A-Za-z0-9_-]*):(?:\s|$)/.exec(line)?.[1];
    last = key;
    if (key === undefined) {
      odd = true;
      continue;
    }
    pairs.push([key, line.slice(key.length + 1).trim()]);
    if (WATCHED.includes(key) && /\s#/.test(line)) running.add(key);
  }
  const fields = fieldsFrom(pairs);
  for (const key of running) fields.unclear.add(key);
  const extra = [...fields.values.keys()].filter((key) => !TEMPLATE_KEYS.has(key));
  return { ...fields, odd, extra };
}

// Reads a record in its parts. Comments come out of the body only: in front matter one could split a key.
// With no front matter there are no fields: such a record is never in force.
function partsOf(raw) {
  const meta = raw.match(FRONT_MATTER);
  const { text: body, odd } = withoutComments(meta ? raw.slice(meta[0].length) : raw.replace(/^\uFEFF/, ''));
  return { meta, fields: meta ? frontFields(meta[1]) : { values: new Map(), unclear: new Set(), odd: false, extra: [] }, body, odd };
}

// How many headings have these words, outside code.
function headingCount(body, name) {
  let count = 0;
  for (const [line, fenced] of marked(body)) {
    const heading = fenced ? null : headingOf(line);
    if (heading && headingKey(heading) === name) count += 1;
  }
  return count;
}

// True when the change line or a line of the body may say the record is retired, whatever its status says: a banner,
// a status of its own, or the words people use. A false hit costs one question. It finds the usual words, not every
// way to say it.
function bodyRetires(text) {
  for (const line of linesOf(text)) {
    const bare = line.replace(/[*_~`]/g, '');
    if (STATUS_LINE.test(bare) || RETIRES_AT_START.test(bare) || SAYS_RETIRED.test(bare)) return true;
  }
  return false;
}

// What a page and this reader could read in different ways, each once. A binding record holds none of these. It needs
// none: the template is headings, bullets and a table.
function bodyTrouble(body) {
  const trouble = new Set();
  const lines = linesOf(body);
  const prose = proseOf(body);
  if (lines.filter((line) => ANSWER_LINE.test(line)).length > 1) trouble.add('more than one Answer line');
  if (RAW_HTML.test(prose)) trouble.add('HTML');
  if (CHARACTER_REFERENCE.test(prose)) trouble.add('a character reference');
  if (WIDE_TEXT.test(body)) trouble.add('wide letters or marks');
  for (const line of lines) {
    if (MIXED_SCRIPTS.test(line)) trouble.add('a word that mixes alphabets');
    if (line.includes('~~')) trouble.add('struck-out text');
    if (UNDERLINE.test(line)) trouble.add('a heading or a rule made of a line of marks');
    const heading = headingOf(line);
    if (heading && /\banswer\b/i.test(heading) && headingKey(heading) !== "owner's answer") trouble.add('a heading with the word answer that is not the template\'s');
  }
  return [...trouble];
}

// True when a file with no shape of its own still speaks of a decision.
const speaksOfDecision = (text) =>
  linesOf(text).some((line) => {
    const key = keyed(line)?.[0];
    return key === 'status' || key === 'owner' || key === 'decision' || SIGN_OFF.includes(key) || /^(?:status|decision)\b/i.test(headingOf(line) ?? '');
  });

// A fence mark on this line, or null. A backtick mark with a backtick after it is inline code.
function fenceMark(line) {
  const found = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  if (!found) return null;
  const rest = line.slice(found[0].length);
  return found[1][0] === '`' && rest.includes('`') ? null : { mark: found[1], rest };
}
// A fence closes only on the same mark, at least as long, with nothing after it.
const closes = (found, mark) => found && found.mark[0] === mark[0] && found.mark.length >= mark.length && !found.rest.trim();

// Each line of the text, and whether it stands in a fenced block.
function* marked(text) {
  let fence = null;
  for (const line of linesOf(text)) {
    const found = fenceMark(line);
    if (fence) {
      yield [line, true];
      if (closes(found, fence)) fence = null;
    } else if (found) {
      fence = found.mark;
      yield [line, true];
    } else {
      yield [line, false];
    }
  }
}

// The text outside code: fenced blocks and `inline code` taken out, so `Promise<void>` is not a placeholder.
function proseOf(text) {
  const kept = [];
  for (const [line, fenced] of marked(text)) {
    if (!fenced) kept.push(line.replace(/`[^`]*`/g, ''));
  }
  return kept.join('\n');
}

// The words of a Markdown heading, or null: "## Options ##" gives "Options".
function headingOf(line) {
  const mark = /^#{1,6}\s+/.exec(line);
  if (!mark) return null;
  const text = line.slice(mark[0].length).trimEnd();
  let end = text.length;
  while (end > 0 && text[end - 1] === '#') end -= 1;
  return text.slice(0, end).trimEnd() || null;
}

const headingKey = (heading) => heading.toLowerCase().replace(/[\u2018\u2019]/g, "'");

// Splits Markdown into sections by heading. Returns a lookup by the words of a heading. A section keeps its lines
// as they stand, so a line that a trim would move is not read as something else, and leaves its code out.
function sections(body) {
  const found = new Map();
  let current;
  for (const [line, fenced] of marked(body)) {
    const heading = fenced ? null : headingOf(line);
    if (heading) {
      current = headingKey(heading);
      if (!found.has(current)) found.set(current, []);
    } else if (current !== undefined && !fenced) {
      found.get(current).push(line);
    }
  }
  return (name) => found.get(name.toLowerCase())?.join('\n').replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd();
}

// True when a line cites a source: path:12, CODEOWNERS:12, or #L12 at the end of a link.
function cites(line) {
  if (/#L\d/.test(line)) return true;
  for (let colon = line.indexOf(':'); colon !== -1; colon = line.indexOf(':', colon + 1)) {
    if (!/\d/.test(line[colon + 1] ?? '')) continue;
    let at = colon;
    while (at > 0 && /[\w./-]/.test(line[at - 1])) at -= 1;
    if (/[A-Za-z]/.test(line.slice(at, colon))) return true;
  }
  return false;
}

// The numbered rows of the Options table, as lists of cells.
function optionRows(table) {
  return table
    .split(/\r?\n/)
    .filter((row) => /^\s*\|\s*\d+\s*\|/.test(row))
    .map((row) =>
      row
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim()),
    );
}

// The number in an answer of the template's shape, or '': the owner's words in double quotes with /answer N first
// or last in them, then nothing, or who wrote them, where, when and a link. A question is no answer.
function answerNumber(words, owner) {
  const close = words.indexOf('"', 1);
  if (words[0] !== '"' || close === -1) return '';
  const said = words.slice(1, close);
  if (said.includes('?') || said.toLowerCase().split('/answer').length !== 2) return '';
  const number = (/^\/answer (\d+)(?:[.!,:;](?: .*)?| [-\u2013\u2014] .*)?$/i.exec(said) ?? /^.*[.,!:;] \/answer (\d+)[.!]?$/i.exec(said))?.[1] ?? '';
  const tail = words.slice(close + 1);
  if (tail === '') return number;
  const from = /^ From (\S+?)(?: (?:on|in) [^,"?<]{1,80})?, (\d{4}-\d{2}-\d{2})(?:, https?:\/\/\S+)?\.?$/.exec(tail);
  return from && handle(from[1]) === handle(owner) && realDate(from[2]) ? number : '';
}

// What the Owner's answer section says: "ok" (one Answer line of the template's shape, its number the choice),
// "waiting", "none" or "unclear". Only an Asked line and an Answer line stand in it, each as the template has it.
function answerState(section, chosen, owner) {
  const lines = section.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.some((line) => !line.startsWith('- Asked:') && !line.startsWith('- Answer:'))) return 'unclear';
  const answers = lines.filter((line) => line.startsWith('- Answer:'));
  if (answers.length === 0) return 'none';
  if (answers.length > 1) return 'unclear';
  const words = answers[0].slice('- Answer:'.length).trim();
  if (words === 'waiting') return 'waiting';
  return chosen !== '' && answerNumber(words, owner) === chosen ? 'ok' : 'unclear';
}

// Every line of a file that hides text, by line number. A byte order mark at the very start hides nothing.
function hiddenLines(text) {
  return text
    .replace(/^\uFEFF/, '')
    .split('\n')
    .flatMap((line, i) => (hides(line) ? [{ at: i + 1, line }] : []));
}

// What a record needs fixed, with the fields the summary line prints.
function review(raw) {
  const { meta, fields, body, odd } = partsOf(raw);
  const hidden = hiddenLines(raw).map(({ at, line }) => `line ${at}: hidden characters: ${quoted(line)}`);
  if (!meta) return { problems: [...hidden, 'no front matter: start the file with the --- block from templates/DECISION.md'] };
  const get = (key) => fields.values.get(key);
  const part = sections(body);
  const problems = hidden;

  for (const key of ['change', 'owner', 'request', 'date']) {
    if (isEmpty(get(key))) problems.push(`front matter: ${key} is empty`);
  }
  if (!isEmpty(get('date')) && !realDate(get('date'))) problems.push('front matter: date reads as YYYY-MM-DD');
  for (const key of fields.unclear) problems.push(`front matter: ${quoted(key)} stands twice, runs over several lines or has a comment`);
  for (const key of fields.extra) problems.push(`front matter: ${quoted(key)} is not in the template`);
  if (fields.odd) problems.push('front matter: every line must be one plain key: value');
  for (const tag of proseOf(withoutComments(raw).text).match(/<[^\s<>][^<>\n]*>/g) ?? []) {
    if (!NOT_PLACEHOLDER.test(tag)) problems.push(`placeholder left: ${quoted(tag)}`);
  }
  for (const name of SECTIONS) {
    const value = part(name);
    if (value === undefined) problems.push(`missing section: ## ${name}`);
    else if (value === '') problems.push(`empty section: ## ${name}`);
    if (headingCount(body, headingKey(name)) > 1) problems.push(`two sections: ## ${name}`);
  }

  // Evidence: one bullet per source, each cited by file and line and tagged.
  const evidenceText = part('Evidence') ?? '';
  const evidence = evidenceText.split(/\r?\n/).filter((line) => /^\s*[-*]\s+/.test(line));
  if (evidenceText !== '' && evidence.length === 0) {
    problems.push('evidence: write one bullet per source, each with a file:line');
  }
  for (const line of evidence) {
    const item = line.trim();
    if (!cites(item)) problems.push(`evidence without a file:line: ${quoted(item)}`);
    if (!TAG.test(item)) problems.push(`evidence without a tag (behavior, compliment or claim): ${quoted(item)}`);
  }

  // Options: a table row per option, numbered, with every column filled.
  const options = new Map();
  for (const cells of optionRows(part('Options') ?? '')) {
    if (options.has(cells[0])) problems.push(`option ${quoted(cells[0])}: two rows have this number`);
    options.set(cells[0], cells[1] ?? '');
    if (cells.length < 5 || cells.slice(0, 5).some((cell) => cell === '')) {
      problems.push(`option ${quoted(cells[0])}: fill every column (option, what you build, cost of being wrong, undo)`);
    }
  }
  const names = [...options.values()];
  if (options.size < 3) problems.push('options: list at least three');
  if (!names.some((name) => /smaller/i.test(name))) problems.push('options: keep a Smaller option');
  if (!names.some((name) => /decline/i.test(name))) problems.push('options: keep a Decline option');

  // Recommendation: one option, with a reason.
  const recommendation = part('Recommendation') ?? '';
  const pick = recommendation.match(/option\s+(\d+)/i);
  if (recommendation !== '' && !pick) {
    problems.push('recommendation: name one option, as "Option 2, because ..."');
  }
  if (pick && !options.has(pick[1])) {
    problems.push(`recommendation: option ${quoted(pick[1])} is not in the options table`);
  }
  if (recommendation !== '' && !/\bbecause\b/i.test(recommendation)) {
    problems.push('recommendation: give the reason after "because"');
  }

  // Status: a proposal is never signed; an accepted (or later superseded) record is signed by its owner.
  const status = get('status') ?? '';
  const decided = status === 'accepted' || SUPERSEDED.test(status);
  const owner = get('owner') ?? '';
  const chosenRaw = get('chosen') ?? '';
  const chosen = /^\d{1,4}$/.test(chosenRaw) ? chosenRaw : '';
  const signedBy = get('signed-by') ?? '';
  const answer = part("Owner's answer") ?? '';

  if (!isEmpty(owner) && !isPerson(owner)) problems.push('owner: name one person by their handle, not a bot, a team or a placeholder');
  if (status === 'proposed') {
    if (!isEmpty(signedBy)) {
      problems.push('a proposed record is not signed: leave signed-by empty until the owner answers');
    }
    if (!isEmpty(chosenRaw)) {
      problems.push('a proposed record has no choice yet: leave chosen empty until the owner answers');
    }
  } else if (decided) {
    for (const shape of [...odd, ...bodyTrouble(body)]) problems.push(`the body holds ${shape}: use the template's shape`);
    if (status === 'accepted' && bodyRetires(`${get('change') ?? ''}\n${body}`)) problems.push('status says accepted, but a line may say it is retired');
    if (isEmpty(signedBy)) {
      problems.push('accepted needs signed-by: owner · YYYY-MM-DD · link to their answer');
    } else {
      const reads = isEmpty(owner) ? 'ok' : signOffReads(signedBy, owner);
      if (reads === 'other') {
        problems.push(`signed-by does not start with the owner (${quoted(owner)}): only the owner signs`);
      } else if (reads === 'unclear') {
        problems.push('signed-by reads as: owner · YYYY-MM-DD · link to their answer, "chat" or "chat relayed"');
      }
      const dated = signOffParts(signedBy)[1] ?? '';
      if (!realDate(dated)) problems.push('signed-by needs the date of the answer, as YYYY-MM-DD');
      else if (dated < (get('date') ?? '') || dated > tomorrow()) problems.push('signed-by: the date of the answer falls before this record or after today');
    }
    if (!options.has(chosen)) {
      problems.push('accepted needs chosen: the number of the option the owner picked');
    } else if (!/decline/i.test(options.get(chosen))) {
      // A per-option line ("- Option 2: ...") must not say none; a single metric must not be none.
      const metric = part('Success metric') ?? '';
      const ownLines = metric.split(/\r?\n/).filter((line) => new RegExp(`option\\s+${chosen}\\b`, 'i').test(line));
      const perOption = /option\s+\d+\s*:/i.test(metric);
      const hasMetric = perOption
        ? ownLines.some((line) => !/:\s*none\b/i.test(line))
        : metric !== '' && !/^none\b/i.test(metric);
      if (!hasMetric) problems.push(`option ${chosen} builds something, so it needs a success metric`);
    }
    if (answerState(answer, chosen, owner) !== 'ok') {
      problems.push('accepted needs one line as the template has it: - Answer: "/answer 2. Their words." From <owner> on <where>, YYYY-MM-DD, <link>. Its number must match chosen');
    }
  } else {
    problems.push('front matter: status is proposed, accepted or superseded');
  }
  return { problems, status, decided, owner, chosen, signedBy };
}

function checkRecord(path) {
  const rel = located(path);
  const stat = walk(rel);
  if (stat === undefined) quit(`Cannot find ${quoted(path)}.`);
  const why = refused(stat);
  if (why) quit(`${quoted(path)}: ${why}. Point at the file itself.`);
  const { text, why: cannot } = readRecord(join(process.cwd(), rel), stat);
  if (cannot) quit(`${quoted(path)}: ${cannot}. Save it as UTF-8 and run this again.`);

  const { problems, status, decided, owner, chosen, signedBy } = review(text);
  const name = quoted(path);
  if (problems.length > 0) {
    const printed = capped(problems.map((problem) => `- ${problem}`), MAX_PROBLEMS, (more) => `- and ${more} more`);
    return { code: 1, printed: [`${name}: ${problems.length} to fix`, ...printed] };
  }
  const state = status === 'accepted' ? status : quoted(status);
  return {
    code: 0,
    printed: [
      decided
        ? `ok · ${name} · ${state}, option ${chosen}, signed by ${quoted(signedBy)}`
        : `ok · ${name} · proposed, waiting for ${quoted(owner)}`,
    ],
  };
}

// Whether one record binds: [the word the list shows, what it adds]. Only a record that passes the whole check is in
// force, and only a record that plainly does not bind is "not in force". All else is "read it".
function verdict(raw) {
  const { meta, fields, body } = partsOf(raw);
  const get = (key) => fields.values.get(key);
  const status = get('status');
  const signed = get('signed-by');
  const owner = get('owner');
  const hiddenAt = hiddenLines(raw)[0]?.at;
  const ask = 'read it, and ask your human whether it binds';
  const says = (word, detail) => [word, detail];

  if (!meta) return says('read it', `no front matter: ${ask}`);
  const hiddenValue = [status, owner, signed].find((value) => value !== undefined && STEERING.test(value));
  if (hiddenValue !== undefined) return says('read it', `hidden characters in its status, owner or sign-off: ${quoted(hiddenValue)}: ${ask}`);
  if (hiddenAt) return says('read it', `hidden characters on line ${hiddenAt}: tell your human, and ${ask}`);
  if (fields.odd) return says('read it', `a front matter line is not plain key: value: ${ask}`);
  if (WATCHED.some((key) => fields.unclear.has(key))) return says('read it', `a key stands twice, runs over several lines or has a comment: ${ask}`);
  if (isEmpty(status)) return says('read it', `no status: ${ask}`);
  if (OVER.test(status)) return says('not in force', quoted(status));
  if (OPEN.test(status)) return says('not in force', `${quoted(status)}${isEmpty(signed) ? ', not signed' : ''}`);
  if (status !== 'accepted') return says('read it', `status ${quoted(status)}: ${ask}`);
  if (fields.extra.length > 0) return says('read it', `accepted, but ${quoted(fields.extra[0])} is not a key of the template: ${ask}`);
  if (signed === undefined) return says('read it', `accepted, with no signed-by field: ${ask}`);
  if (bodyRetires(`${get('change') ?? ''}\n${body}`)) return says('read it', `its text may say it is retired: ${ask}`);
  if (isEmpty(signed)) return says('not in force', 'accepted, but nobody signed it');
  if (isEmpty(owner)) return says('read it', `signed by ${quoted(signed)}, with no owner named: ${ask}`);
  if (isBot(owner)) return says('not in force', `its owner ${quoted(owner)} is a bot account`);
  if (!isPerson(owner)) return says('read it', `owner ${quoted(owner)} is not one person's handle: ${ask}`);
  const reads = signOffReads(signed, owner);
  if (reads === 'other') return says('read it', `signed by ${quoted(signed)}, not by its owner ${quoted(owner)}: ${ask}`);
  if (reads === 'unclear') return says('read it', `sign-off ${quoted(signed)} is not owner · date · link: ${ask}`);

  const { problems } = review(raw);
  if (problems.length > 0) return says('read it', `it does not pass the check, ${problems.length} to fix: ${ask}`);
  return says('in force', `signed by ${quoted(signed)}`);
}

const RANK = { 'in force': 0, skipped: 1, 'read it': 2, 'not in force': 3 };

function listInForce(folder) {
  const rel = located(folder);
  const stat = walk(rel);
  if (stat === undefined) return { code: 0, printed: [`No folder ${quoted(folder)} yet: nothing is decided in writing yet.`] };
  const full = join(process.cwd(), rel);
  let entries;
  try {
    entries = readdirSync(full, { withFileTypes: true });
  } catch {
    quit(`${quoted(folder)} is not a folder you can read.`);
  }
  // The folder must be the one this began with: after the listing, and before and after each read.
  const same = () => {
    const now = walk(rel);
    if (now?.ino !== stat.ino || now?.dev !== stat.dev) quit(`${quoted(folder)} changed while this ran. Run this again.`);
  };
  same();

  // Newest name first, so the limit leaves out the oldest. The list prints in name order.
  entries.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  const rows = [];
  const add = (word, name, detail) => rows.push([word, `${quoted(name)} · ${detail}`]);
  let total = 0;
  let skipped = 0;
  let others = 0;
  let inForce = 0;
  let read = 0;
  let spent = 0n;
  const skip = (name, why) => {
    skipped += 1;
    add('skipped', name, `${why}: not read, do not open it yourself, tell your human`);
  };
  for (const entry of entries) {
    const { name } = entry;
    const record = RECORD.test(name);
    if (entry.isDirectory()) {
      if (name === '.git') continue;
      skipped += 1;
      add('skipped', name, /^[A-Za-z0-9_-][\w.-]*$/.test(name) ? 'a folder: run --in-force on it too' : 'a folder: not read, tell your human');
      continue;
    }
    if (!record && !entry.isSymbolicLink()) {
      if (DOC_LIKE.test(name) || !name.includes('.')) skip(name, 'not a kind of file this reads');
      else others += 1;
      continue;
    }
    const quiet = QUIET_NAMES.has(name.toLowerCase());
    if (read === MAX_RECORDS) {
      total += 1;
      skip(name, 'over the limit of this run');
      continue;
    }
    const path = join(full, name);
    let seen;
    try {
      seen = lstatSync(path, { bigint: true });
    } catch {
      total += 1;
      skip(name, 'cannot read it');
      continue;
    }
    const why = entry.isSymbolicLink() || !staysInside(path) ? 'it is a link' : refused(seen);
    if (why || spent + seen.size > BigInt(MAX_TOTAL)) {
      total += 1;
      skip(name, why ?? 'over the limit of this run');
      continue;
    }
    read += 1;
    spent += seen.size;
    same();
    const { text, why: cannot } = readRecord(path, seen);
    same();
    if (cannot) {
      total += 1;
      skip(name, cannot);
      continue;
    }
    if (quiet && !speaksOfDecision(text)) continue;
    total += 1;
    const [word, detail] = verdict(text);
    if (word === 'in force') inForce += 1;
    add(word, name, detail);
  }
  if (rows.length === 0 && others === 0) return { code: 0, printed: [`No records in ${quoted(folder)}: nothing is decided in writing yet.`] };
  if (rows.length === 0) return { code: 0, printed: [`No records in ${quoted(folder)}, and other files not read: ${others}. Tell your human.`] };

  // Over the limit, the lines that bind nothing go first. Past that, the list says it is not whole.
  const print = (all) => all.map(([word, detail]) => `${word.padEnd(14)}${detail}`);
  rows.reverse();
  const long = rows.length > MAX_LISTED || print(rows).join('\n').length > MAX_OUTPUT;
  const ordered = long ? [...rows].sort((a, b) => RANK[a[0]] - RANK[b[0]]) : rows;
  const printed = capped(print(ordered), MAX_LISTED, (more) => `and ${more} more lines not shown: ask your human before you rely on this list`);
  const extras = [skipped > 0 ? `${skipped} skipped` : '', others > 0 ? `other files not read: ${others}` : ''].filter(Boolean);
  printed.push(`${inForce} of ${total} in force${extras.length > 0 ? `, ${extras.join(', ')}` : ''}.`);
  return { code: 0, printed };
}

async function selfTest() {
  const { selfTest: checks } = await import('./check-decision.selftest.mjs');
  return checks({ WINDOWS, MAX_BYTES, MAX_SHOWN, FRONT_MATTER, hides, quoted, Stop, withoutComments, signOffReads, keyed, frontFields, speaksOfDecision, proseOf, headingOf, cites, answerState, review, checkRecord, verdict, listInForce });
}

async function main(args) {
  const [first, second] = args;
  if (first === '--help' || first === '-h') {
    console.log(USAGE);
    return 0;
  }
  if (first === '--self-test' && args.length === 1) {
    await selfTest();
    console.log('self-test ok');
    return 0;
  }
  if (first === '--in-force' && args.length !== 2) quit(USAGE);
  if (first !== '--in-force' && (first === undefined || first.startsWith('-') || args.length !== 1)) quit(USAGE);
  const { code, printed } = first === '--in-force' ? listInForce(second) : checkRecord(first);
  console.log(printed.join('\n'));
  return code;
}

// Exit codes go through process.exitCode, so the output is never cut off on a pipe.
try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof Stop) console.error(error.message);
  else if (process.argv[2] === '--self-test' && process.argv.length === 3) throw error;
  else console.error(`The check could not run (${shown(error?.code ?? 'error')}).`);
  process.exitCode = 2;
}
