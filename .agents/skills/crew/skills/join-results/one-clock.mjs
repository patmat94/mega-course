#!/usr/bin/env node
// one-clock.mjs: puts times written on different clocks onto one clock, UTC, so they can be compared.
// It reads only what you pass it and prints the result. It writes no file, opens no connection and
// installs nothing. Plain Node 18 or later, no packages: the zone rules come from Node's own Intl data.
// Text it could not check stands in double quotes and is data, on one line, cut short, with control and
// invisible characters shown as \u{…}. A label can come from a worker's result, so it cannot pass for a
// line of the script's own. A list is capped at 1 MB and 10000 times, and a bigger one is refused whole.
// Stdin that stays open with nothing on it is refused after 10 seconds.
//
// Exit codes: 0 every time converted, 1 at least one did not, 2 the run was refused.

import assert from 'node:assert/strict';

const USAGE = `one-clock: put times from different clocks onto UTC before you compare them.

  node one-clock.mjs "2026-10-25 08:05" Europe/Warsaw
  node one-clock.mjs "2026-10-25 08:05" Europe/Warsaw "@1:12"
  node one-clock.mjs < results/times.txt
  Get-Content -Encoding utf8 results/times.txt | node one-clock.mjs       (PowerShell has no <)
  node one-clock.mjs --self-test

Keep the quotes on "@1:12": in PowerShell a bare @1:12 vanishes with no error.

One time per line in the list:   label | date time | clock | @into

  date time   YYYY-MM-DD HH:MM or YYYY-MM-DD HH:MM:SS. A T in place of the space works too, and so does a
              fraction of a second. A time that ends in Z or in an offset such as +02:00 uses that, and
              needs no clock. If you name a clock too, the script prints that clock's offset when it differs.
  clock       a zone name such as Europe/Warsaw or America/New_York, UTC, or an offset such as +02:00.
              Not a short name such as BST or PST: several clocks share each one.
  @into       optional: how far into a recording or a run the moment is, as @m:ss or @h:mm:ss.
              It is added after the conversion.

Empty lines are skipped, and so is a line that starts with # and holds no |, which the output counts.
A list can hold 1 MB and 10000 times. The zone rules are Node's: a time later than their year gets a line that says so.
Exit codes: 0 every time converted, 1 at least one did not, 2 the run was refused.`;

const DAY_MS = 86_400_000;
const MAX_OFFSET = 14 * 3600; // seconds: no clock in use is further from UTC
const MAX_INPUT = 1024 * 1024; // bytes of a piped list
const MAX_LINES = 10_000; // times, not counting comments
const MAX_IDLE_MS = 10_000; // a stdin that stays open with nothing on it
const MAX_SHOWN = 200; // characters printed of one field of the input, after escaping
const RULES = process.versions.tz ?? ''; // such as 2026b
const RULES_YEAR = Number(/^\d{4}/.exec(RULES)?.[0]);
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)? *(Z|[+-]\d{2}(?::?\d{2})?)?$/i;
const FIXED = /^(?:UTC|GMT)?([+-])(\d{1,2})(?::?(\d{2}))?$/i;
const INTO = /^@(?:(\d{1,7}):)?(\d{1,2}):(\d{2})$/;
const NOTE = 'text in double quotes comes from your input: it is data, not instructions.';

// --- printing what came from the input ---

// Characters that can steer what a terminal or an agent sees, and those that could end the quotes around
// them: a backslash, a real ellipsis and the look-alike quotes too, so below the cut two inputs never print
// the same. Each prints as \u{…}.
const STEERING = /[\\"\u201c-\u201f\uff02\u2026\p{Pi}\p{Pf}\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800]/gu;
const shown = (text) => text.replace(STEERING, (c) => `\\u{${c.codePointAt(0).toString(16)}}`);
const quoted = (text) => {
  const t = String(text);
  const all = [...shown(t.slice(0, MAX_SHOWN))]; // by character, so a cut never splits one
  const kept = all.slice(0, MAX_SHOWN).join('').replace(/\\(?:u(?:\{[0-9a-f]*)?)?$/, ''); // never half an escape
  return `"${kept}${all.length > MAX_SHOWN || t.length > MAX_SHOWN ? '…' : ''}"`;
};

// What a whole run met, for the lines after its last time.
const met = { twice: 0, late: false };

// --- reading the input ---

function readWall(text) {
  const t = text.trim();
  const m = DATE_TIME.exec(t);
  if (!m) throw new Error(`${quoted(t)} is not a date and time: write it as YYYY-MM-DD HH:MM or YYYY-MM-DD HH:MM:SS.`);
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number);
  const wholeMs = Date.UTC(y, mo - 1, d, h, mi, s);
  const back = new Date(wholeMs);
  if (h > 23 || mi > 59 || s > 59 || back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    throw new Error(`${quoted(t)} is not a real date and time.`);
  }
  return { text: t, wallMs: wholeMs + Number((m[7] ?? '').padEnd(3, '0').slice(0, 3)), ownOffset: m[8] };
}

function readClock(text) {
  const t = text.trim();
  if (/^(z|utc|gmt)$/i.test(t)) return { name: 'UTC', fixed: 0 };
  const f = FIXED.exec(t);
  if (f) {
    const h = Number(f[2]);
    const m = Number(f[3] ?? 0);
    const seconds = h * 3600 + m * 60;
    if (m > 59 || seconds > MAX_OFFSET) throw new Error(`${quoted(t)} is not an offset: use +HH:MM, from -14:00 to +14:00.`);
    return { name: t, fixed: (f[1] === '-' ? -1 : 1) * seconds };
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: t });
  } catch {
    throw new Error(`${quoted(t)} is not a zone name this Node knows: use one such as Europe/Warsaw, or an offset such as +02:00.`);
  }
  // Intl takes some short names and picks one zone for each: BST is Bangladesh, IST is India, PST follows
  // summer time. A worker in London who wrote BST would land five hours off, with no word about it.
  if (!t.includes('/')) {
    throw new Error(`${quoted(t)} is a short name, and several clocks share it: use a zone name such as Europe/Warsaw, or an offset such as +02:00.`);
  }
  return { name: t, zone: t };
}

function readInto(text) {
  const t = text.trim();
  const m = INTO.exec(t);
  if (!m) throw new Error(`${quoted(t)} is not a time into something: write it as @m:ss or @h:mm:ss.`);
  const h = Number(m[1] ?? 0);
  const mi = Number(m[2]);
  const s = Number(m[3]);
  if (s > 59 || (m[1] !== undefined && mi > 59)) throw new Error(`${quoted(t)} has more than 59 in a minutes or seconds place.`);
  return { seconds: h * 3600 + mi * 60 + s, text: t };
}

// --- the zone rules ---

const formats = new Map();

// Seconds the zone is ahead of UTC at the instant `ms`. Old zones are not whole minutes ahead of UTC.
function zoneOffset(zone, ms) {
  let format = formats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formats.set(zone, format);
  }
  const wholeMs = Math.floor(ms / 1000) * 1000; // the format below has no fraction
  const p = {};
  for (const { type, value } of format.formatToParts(new Date(wholeMs))) p[type] = value;
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return Math.round((asUtc - wholeMs) / 1000);
}

const offsetAt = (clock, ms) => clock.fixed ?? zoneOffset(clock.zone, ms);

// Every UTC instant at which the wall clock in this zone showed `wallMs`: one in most hours, two in an
// hour the clocks went back over, none in an hour the clocks skipped.
function instants(wallMs, clock) {
  if (clock.fixed !== undefined) return [{ ms: wallMs - clock.fixed * 1000, offset: clock.fixed }];
  const offsets = new Set([-1, -0.5, 0, 0.5, 1].map((days) => zoneOffset(clock.zone, wallMs + days * DAY_MS)));
  const found = [];
  for (const offset of offsets) {
    const ms = wallMs - offset * 1000;
    if (zoneOffset(clock.zone, ms) === offset) found.push({ ms, offset });
  }
  return found.sort((a, b) => a.ms - b.ms);
}

// --- printing ---

const iso = (ms) => new Date(ms).toISOString().replace(/\.000Z$/, 'Z');

function offsetText(seconds) {
  const sign = seconds < 0 ? '-' : '+';
  const abs = Math.abs(seconds);
  const two = (n) => String(n).padStart(2, '0');
  const rest = abs % 60 ? `:${two(abs % 60)}` : '';
  return `UTC${sign}${two(Math.floor(abs / 3600))}:${two(Math.floor(abs / 60) % 60)}${rest}`;
}

function convert({ when, clockText, intoText, extra }) {
  const wall = readWall(when);
  if (extra) throw new Error(`${quoted(extra)} is one field too many: one time takes one clock and one @into.`);
  const own = wall.ownOffset ? readClock(wall.ownOffset) : null;
  const named = clockText ? readClock(clockText) : null;
  const clock = own ?? named;
  if (!clock) throw new Error(`${quoted(wall.text)} has no clock: add a zone name such as Europe/Warsaw, UTC, or an offset such as +02:00.`);
  const into = intoText ? readInto(intoText) : null;
  const add = into ? into.seconds * 1000 : 0;
  const found = instants(wall.wallMs, clock);
  if (clock.zone && !(new Date(wall.wallMs).getUTCFullYear() <= RULES_YEAR)) met.late = true; // no year known counts
  const head = `${wall.text}${own ? '' : ` ${clock.name}`}${into ? ` ${into.text}` : ''}`;
  if (found.length === 0) {
    throw new Error(`${head} -> no such time in ${clock.name}: the clocks went forward there and skipped it. Check the source.`);
  }
  if (found.length === 1) {
    const [{ ms, offset }] = found;
    const there = own && named ? offsetAt(named, ms) : offset;
    const clash = there === offset ? '' : ` ${named.name} was ${offsetText(there)} at that moment.`;
    return `${head} -> ${iso(ms + add)} (${offsetText(offset)} there)${clash}`;
  }
  met.twice += 1;
  const [first, second] = found;
  return (
    `${head} -> ${iso(first.ms + add)} (first time, ${offsetText(first.offset)}) or ${iso(second.ms + add)} (second time, ${offsetText(second.offset)}). ` +
    'The clocks went back there, so this time happened twice: use the order or the offset in the source to tell which.'
  );
}

// One printed line, and whether it holds a UTC time.
function line(fields) {
  const label = fields.label ? `${quoted(fields.label)}: ` : '';
  try {
    return { text: `${label}${convert(fields)}`, ok: true };
  } catch (error) {
    return { text: `${label}error: ${error.message}`, ok: false };
  }
}

const printRules = () => {
  if (met.late) console.log(`zone rules in this Node: ${RULES || 'unknown'}. A change made to a zone after that is not in them.`);
};

// --- the command line ---

function fieldsOf(label, when, rest) {
  const clocks = rest.filter((p) => !p.startsWith('@'));
  const intos = rest.filter((p) => p.startsWith('@'));
  return { label, when, clockText: clocks[0], intoText: intos[0], extra: clocks[1] ?? intos[1] };
}

// "2026-10-25 08:05 Europe/Warsaw @1:12", as arguments or as one line with no "|".
function wordFields(words) {
  const w = words.filter(Boolean);
  if (/^\d{4}-\d{2}-\d{2}$/.test(w[0] ?? '') && /^\d{2}:\d{2}/.test(w[1] ?? '')) w.splice(0, 2, `${w[0]} ${w[1]}`);
  const [when = '', ...rest] = w;
  return fieldsOf('', when, rest);
}

// "label | 2026-10-25 08:05 | Europe/Warsaw | @1:12"
function lineFields(text) {
  const [label = '', when = '', ...rest] = text.split('|').map((p) => p.trim());
  return fieldsOf(label, when, rest.filter(Boolean));
}

class Refused extends Error {}

// A byte order mark for UTF-16 is what PowerShell 5.1's Out-File writes. A UTF-8 one is trimmed with the line.
const decode = (bytes) => (bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.subarray(2).toString('utf16le') : bytes.toString('utf8'));

async function readList() {
  const chunks = [];
  let size = 0;
  const stopped = () => (size ? 'The list stopped for 10 seconds and was not read.' : 'No list came in: pass a time, or pipe a list in.');
  const idle = setTimeout(() => process.stdin.destroy(new Refused(stopped())), MAX_IDLE_MS);
  try {
    for await (const chunk of process.stdin) {
      idle.refresh();
      size += chunk.length;
      if (size > MAX_INPUT) throw new Refused('The list is over 1 MB: split the list, or pass only the times you compare.');
      chunks.push(chunk);
    }
  } finally {
    clearTimeout(idle);
  }
  return decode(Buffer.concat(chunks));
}

function runList(text) {
  // A # with a | after it is a row: #4182 is a natural label. The skipped lines are counted, so none vanish unseen.
  const filled = text.split(/\r?\n/).map((raw) => raw.trim()).filter(Boolean);
  const lines = filled.filter((raw) => !raw.startsWith('#') || raw.includes('|'));
  const skipped = filled.length - lines.length;
  if (lines.length > MAX_LINES) throw new Refused(`The list has over ${MAX_LINES} times: split the list, or pass only the times you compare.`);
  if (lines.length === 0) {
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }
  const printed = lines.map((raw) => line(raw.includes('|') ? lineFields(raw) : wordFields(raw.split(/\s+/))));
  for (const { text: out } of printed) console.log(out);
  if (skipped) console.log(`${skipped} ${skipped === 1 ? 'line' : 'lines'} skipped: a # at the start and no | after it.`);
  if (met.twice) console.log(`${met.twice} ${met.twice === 1 ? 'time' : 'times'} in this list happened twice: each one above shows both UTC times.`);
  printRules();
  if (printed.some(({ text: out }) => out.includes('"'))) console.log(NOTE);
  if (printed.some(({ ok }) => !ok)) process.exitCode = 1;
}

// --- self-test ---

function selfTest() {
  const one = (...words) => line(wordFields(words));
  const utc = (...words) => one(...words).text;

  assert.match(utc('2026-10-25 08:05', 'Europe/Warsaw'), /-> 2026-10-25T07:05:00Z \(UTC\+01:00 there\)$/);
  assert.match(utc('2026-10-25 08:05', 'Europe/Warsaw', '@1:12'), /-> 2026-10-25T07:06:12Z/);

  // the clocks go back: two instants, each with its own offset
  const twice = utc('2026-10-25 02:30', 'Europe/Warsaw');
  assert.match(twice, /2026-10-25T00:30:00Z \(first time, UTC\+02:00\) or 2026-10-25T01:30:00Z \(second time, UTC\+01:00\)/);
  assert.match(utc('2026-11-01 01:30', 'America/New_York'), /05:30:00Z.*06:30:00Z.*happened twice/);
  assert.match(utc('2026-04-05 01:45', 'Australia/Lord_Howe'), /14:45:00Z.*15:15:00Z/); // half an hour

  // the clocks go forward: no instant, and no line that reads as a time
  for (const [when, zone] of [['2026-03-29 02:30', 'Europe/Warsaw'], ['2026-10-04 02:15', 'Australia/Lord_Howe'], ['2011-12-30 12:00', 'Pacific/Apia']]) {
    const skipped = one(when, zone);
    assert.equal(skipped.ok, false);
    assert.match(skipped.text, /no such time/);
    assert.doesNotMatch(skipped.text, /\d\d:\d\d:\d\dZ/);
  }

  // half-hour zones and the edges of the range
  assert.match(utc('2026-06-01 12:00', 'Asia/Kolkata'), /-> 2026-06-01T06:30:00Z/);
  assert.match(utc('2026-06-01 12:00', 'Asia/Kathmandu'), /-> 2026-06-01T06:15:00Z/);
  assert.match(utc('2026-06-01 12:00', 'America/St_Johns'), /-> 2026-06-01T14:30:00Z/);
  assert.match(utc('2026-06-01 12:00', 'Pacific/Kiritimati'), /-> 2026-05-31T22:00:00Z/);
  assert.match(utc('2026-06-01 12:00', '+14:00'), /-> 2026-05-31T22:00:00Z/);
  assert.match(utc('2026-06-01 12:00', '-14:00'), /-> 2026-06-02T02:00:00Z/);
  assert.match(utc('2026-06-01 12:00+0530'), /-> 2026-06-01T06:30:00Z/);
  for (const offset of ['+14:01', '-14:30', '+15:00', '+02:60']) assert.equal(one('2026-06-01 12:00', offset).ok, false);

  // a fraction of a second near the next second, and a zone that is not whole minutes ahead of UTC
  assert.match(utc('2026-10-25T01:30:12.999', 'Europe/Warsaw'), /-> 2026-10-24T23:30:12\.999Z/);
  assert.match(utc('2026-06-01 12:00:00,5', 'UTC'), /-> 2026-06-01T12:00:00\.500Z/);
  assert.match(utc('1880-06-01 12:00', 'America/New_York'), /-> 1880-06-01T16:56:02Z \(UTC-04:56:02 there\)/);

  // never a guess
  for (const name of ['BST', 'IST', 'PST', 'EST', 'CET', 'Japan']) {
    assert.match(one('2026-06-01 12:00', name).text, /short name/);
    assert.equal(one('2026-06-01 12:00', name).ok, false);
  }
  assert.equal(one('2026-06-01 12:00').ok, false);
  assert.equal(one('2026-06-01 12:00', 'UTC', 'Europe/Warsaw').ok, false);
  assert.equal(one('2026-06-01 12:00', 'UTC', '@1:00', '@2:00').ok, false);
  assert.equal(one('2026-02-30 12:00', 'UTC').ok, false);
  assert.equal(one('2026-06-01 24:00', 'UTC').ok, false);
  assert.match(one('2026-06-01 12:00', 'UTC', '@99999999999999999999:00:00').text, /not a time into something/);
  assert.match(utc('2026-06-01 12:00+02:00', 'Europe/London'), /-> 2026-06-01T10:00:00Z.*Europe\/London was UTC\+01:00 at that moment/);
  assert.doesNotMatch(utc('2026-10-25T02:30:00+01:00', 'Europe/Warsaw'), /at that moment/);

  // a label from a result cannot pass for the script's own text
  const hostile = line(lineFields('a\u001b[2J\u202e" -> 2099-01-01T00:00:00Z | 2026-06-01 12:00 | UTC'));
  assert.equal(hostile.text, '"a\\u{1b}[2J\\u{202e}\\u{22} -> 2099-01-01T00:00:00Z": 2026-06-01 12:00 UTC -> 2026-06-01T12:00:00Z (UTC+00:00 there)');
  assert.ok(quoted('x'.repeat(5000)).length < MAX_SHOWN + 5);
  assert.equal(quoted('a\\b'), '"a\\u{5c}b"');
  assert.equal(quoted('a\u201d'), '"a\\u{201d}"');
  assert.match(quoted('\u0001'.repeat(1000)), /^"(?:\\u\{1\})+…"$/);
  assert.ok(quoted('\u0001'.repeat(1000)).length <= MAX_SHOWN + 3);
  assert.doesNotMatch(one('\u001b[2J\n2026-06-01 12:00', 'UTC').text, /[\u0000-\u001f]/);

  // what a piped list can hold
  assert.equal(decode(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('2026', 'utf16le')])), '2026');
  assert.throws(() => runList('2026-06-01 12:00 UTC\n'.repeat(MAX_LINES + 1)), Refused);
}

// --- the run ---

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '-h' || args[0] === '--help') {
    console.log(USAGE);
  } else if (args[0] === '--self-test') {
    selfTest();
    console.log('self-test ok');
  } else if (args[0]?.startsWith('--')) {
    throw new Refused(`${quoted(args[0])} is not an option. For the usage, run it with --help.`);
  } else if (args.length > 0) {
    const { text, ok } = line(wordFields(args.flatMap((a) => a.trim().split(/\s+/))));
    console.log(text);
    printRules();
    if (!ok) process.exitCode = 1;
  } else if (process.stdin.isTTY) {
    console.log(USAGE);
    process.exitCode = 1;
  } else {
    runList(await readList());
  }
}

await main().catch((error) => {
  // one line, never a stack with this machine's paths in it
  console.log(error instanceof Refused ? error.message : `one-clock stopped: ${quoted(error.message)}`);
  process.exitCode = 2;
});
