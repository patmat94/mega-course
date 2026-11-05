#!/usr/bin/env node
// check-tool.mjs: check one tool on a running MCP server against its TOOL.md.
//
//   node check-tool.mjs --spec TOOL.md                                         checks TOOL.md only
//   node check-tool.mjs --spec TOOL.md --cmd "node server.mjs"                 also prints the plan
//   node check-tool.mjs --spec TOOL.md --cmd "node server.mjs" --yes           runs it over stdio
//   node check-tool.mjs --spec TOOL.md --url http://localhost:8787/mcp --yes   runs it over HTTP
//   node check-tool.mjs --spec TOOL.md --cmd "node server.mjs" --yes --stub MAIL_API_URL=http://127.0.0.1:9000 --stub-log stub.log
//                                                                              a tool with side effects
//   node check-tool.mjs --self-test
//
// Node 18 or newer, no dependencies. It reads the TOOL.md you name and writes no file. It starts the
// command or calls the URL only with --yes, because the tool runs for real. A tool whose TOOL.md says
// "sideEffects": true runs only against a stub on this machine.
// What it prints from the server or from TOOL.md is data, on one line; messages stand in double quotes.
// It speaks MCP 2026-07-28 (server/discover) and falls back to the 2025-11-25 initialize handshake.
// It does not sign in.
// Exit code: 0 every check passed, 1 a check failed, 2 nothing was sent, 3 the script broke (a call may have gone out).

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';

const MODERN = '2026-07-28';
const LEGACY = '2025-11-25';
const CLIENT = { name: 'check-tool', version: '1.0.0' };
const META = {
  'io.modelcontextprotocol/protocolVersion': MODERN,
  'io.modelcontextprotocol/clientInfo': CLIENT,
  'io.modelcontextprotocol/clientCapabilities': {},
};
// MCP tool names: 1 to 128 characters, letters, digits, underscore, hyphen and dot.
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
// Words that tell the model what to send next. Lenient on purpose: a good error can be worded many ways.
const NEXT =
  /\b(send|use|pass|give|provide|set|call|try|retry|again|instead|expected|expects?|must|should|needs?|one of|at most|at least|up to|no more than|between|allowed|accepts?)\b/i;
const LONG_ERROR_BYTES = 600;
const WINDOWS = process.platform === 'win32';
// The full path: a bare name is looked up in the current folder first on Windows.
const TASKKILL = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
const STUB = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/;
// A scheme or none, a name for this machine, a port, a plain path: nothing another URL parser reads differently.
const STUB_ADDRESS = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:\/[A-Za-z0-9._~\/-]*)?$/i;
const STUB_NEVER = /^(?:PATH|PATHEXT|COMSPEC|SYSTEMROOT|NODE_OPTIONS|NODE_PATH|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_\w+)$/i;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const MAX_LINE = 500;
const MAX_MESSAGE = 16 * 1024 * 1024;
const MAX_SPEC = 1024 * 1024;
const MAX_WALK = 200_000;
const MAX_DEPTH = 200;
const PATTERN_MS = 500;
const MAX_SLOW_PATTERNS = 3;
const MAX_SAMPLE_VALUES = 100;
// Control codes, invisible characters, and the marks that turn text around or break a line.
const UNSAFE = /[\p{C}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u{2800}]/gu;
const SECRET = /\b[sprk]k[-_][A-Za-z0-9_-]{8,}|\bgh[pousr]_[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]*-----|\b\w*(?:KEY|TOKEN|SECRET|PASSWORD)\s*[=:]\s*\S+/gi;
const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD/i;

const USAGE = `check-tool: check one tool on a running MCP server against its TOOL.md.

  node check-tool.mjs --spec <TOOL.md> [--cmd "<command>" | --url <endpoint>] [--yes] [--stub NAME=ADDRESS --stub-log <file>]

  --spec <path>      the tool's TOOL.md (required)
  --cmd "<command>"  start this stdio server, in the current folder
  --url <endpoint>   call this Streamable HTTP endpoint, such as http://localhost:8787/mcp
  --yes              really start or call it; without it nothing is started or sent
  --stub NAME=ADDRESS  the address on this machine of a stub that stands in for the upstream, such as
                     MAIL_API_URL=http://127.0.0.1:9000. Needed when TOOL.md says "sideEffects": true.
                     --cmd gives the server this variable; with --url, start the server with it yourself.
                     Give it once per upstream
  --stub-log <file>  the file your stub writes each request to. Needed with --stub for a tool with side
                     effects: the check fails when the good sample is not in what the run added to it
  --tool <name>      use this tool name instead of the one in the check block
  --budget <bytes>   use this budget instead of budgetBytes in the check block
  --timeout <s>      seconds to wait for each answer (default 30)
  --self-test        run the script's own tests; nothing is started or sent

Exit code: 0 every check passed, 1 a check failed, 2 nothing was sent, 3 the script broke (a call may have gone out).`;

// ---------- report ----------

let passed = 0;
let failed = 0;
const unchecked = new Set();
// Every line may hold text from the server or TOOL.md: one line, no control or invisible characters, no secrets, a limit.
const printable = (text) => redact(cut(String(text), MAX_LINE)).replace(UNSAFE, (c) => `\\u{${c.codePointAt(0).toString(16)}}`);
const say = (tag, text) => console.log(`  ${tag.padEnd(4)}  ${printable(text)}`);
const ok = (text) => {
  passed += 1;
  say('ok', text);
};
const fail = (text) => {
  failed += 1;
  say('FAIL', text);
};
const note = (text) => say('note', text);
const info = (text) => say('info', text);
const section = (title) => console.log(`\n${printable(title)}`);

// ---------- helpers ----------

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const bytes = (s) => Buffer.byteLength(s, 'utf8');
const cut = (s, n = 200) => (s.length > n ? `${s.slice(0, n)}…` : s);
const flat = (s) => s.replace(/\s+/g, ' ').trim();
const quoted = (s, n = 200) => JSON.stringify(cut(String(s), n));
function redact(text) {
  let out = text.replace(SECRET, '[hidden]');
  for (const [name, value] of Object.entries(process.env)) {
    if (SECRET_NAME.test(name) && value && value.length >= 8) out = out.split(value).join('[hidden]');
  }
  return out;
}
const show = (v, n = 120) => cut(v === undefined ? 'nothing' : JSON.stringify(v), n);
const ptr = (key) => String(key).replace(/~/g, '~0').replace(/\//g, '~1');
const at = (path) => path || '(root)';
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const canon = (v) =>
  Array.isArray(v) ? v.map(canon) : isObject(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const withoutDialect = (schema) => {
  if (!isObject(schema)) return schema;
  const { $schema, ...rest } = schema;
  return rest;
};
const textItems = (result) =>
  (Array.isArray(result.content) ? result.content : [])
    .filter((c) => isObject(c) && c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text);
const textOf = (result) => textItems(result).join('\n');

function isLocal(url) {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

// The endpoint as it may be printed: no sign-in, no query.
function plainUrl(url) {
  try {
    const { origin, pathname } = new URL(url);
    return `${origin}${pathname}`;
  } catch {
    return '(not a URL)';
  }
}

const isShare = (path) => /^[\\/]{2}/.test(path);

function parseStub(value) {
  const m = STUB.exec(value);
  if (!m) throw new Error(`--stub needs NAME=ADDRESS, such as MAIL_API_URL=http://127.0.0.1:9000. It got: ${printable(value)}`);
  if (STUB_NEVER.test(m[1])) throw new Error(`--stub ${m[1]}: this variable runs programs, so it cannot name a stub.`);
  if (!STUB_ADDRESS.test(m[2])) throw new Error(`--stub ${m[1]}: ${printable(m[2])} is not a plain address on this machine. A stub runs on localhost, 127.0.0.1 or [::1].`);
  return { name: m[1], address: m[2] };
}

function fileSize(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

// Ends a shell and every process it started. On Windows a kill reaches only the shell, and the server it
// started keeps running.
function killTree(pid, signal) {
  if (!pid) return;
  if (WINDOWS) {
    spawnSync(TASKKILL, ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    // The group is gone.
  }
}

function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------- JSON Schema: the keywords tool schemas use ----------
// A keyword this script does not know is named at the end, never passed in silence.

const KNOWN = new Set([
  'type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const',
  'minLength', 'maxLength', 'pattern', 'format',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minItems', 'maxItems', 'uniqueItems', 'minProperties', 'maxProperties',
  'allOf', 'anyOf', 'oneOf', 'not', '$ref', '$defs', 'definitions',
  '$schema', '$id', '$comment', 'title', 'description', 'default', 'examples', 'deprecated', 'readOnly', 'writeOnly',
]);

// The schemas are not ours: the walk has limits, and a pattern runs under a clock.
let walked = 0;
let depth = 0;
let slowPatterns = 0;

function validate(schema, value) {
  walked = 0;
  return validateAt(schema, value, schema, '');
}

function validateAt(schema, value, root, path) {
  const errors = [];
  walk(schema, value, root, path, errors);
  return errors;
}

function walk(schema, value, root, path, errors) {
  if (walked >= MAX_WALK || depth >= MAX_DEPTH) {
    unchecked.add('a schema too deep or too large to walk');
    return;
  }
  walked += 1;
  depth += 1;
  walkOne(schema, value, root, path, errors);
  depth -= 1;
}

function walkOne(schema, value, root, path, errors) {
  if (schema === true || schema === undefined) return;
  if (schema === false) {
    errors.push(`${at(path)}: not allowed`);
    return;
  }
  if (!isObject(schema)) return;
  for (const key of Object.keys(schema)) if (!KNOWN.has(key)) unchecked.add(key);
  if (typeof schema.$ref === 'string') {
    const target = resolveRef(root, schema.$ref);
    if (target === undefined) unchecked.add(`$ref ${schema.$ref}`);
    else walk(target, value, root, path, errors);
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => isType(value, t))) {
      errors.push(`${at(path)}: expected ${types.join(' or ')}, got ${typeName(value)}`);
      return;
    }
  }
  if ('const' in schema && !same(value, schema.const)) errors.push(`${at(path)}: expected ${show(schema.const, 60)}`);
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => same(e, value))) {
    errors.push(`${at(path)}: expected one of ${show(schema.enum, 80)}`);
  }
  if (typeof value === 'string') checkString(schema, value, path, errors);
  if (typeof value === 'number') checkNumber(schema, value, path, errors);
  if (Array.isArray(value)) checkArray(schema, value, root, path, errors);
  if (isObject(value)) checkObject(schema, value, root, path, errors);
  if (Array.isArray(schema.allOf)) for (const sub of schema.allOf) walk(sub, value, root, path, errors);
  if (Array.isArray(schema.anyOf) && !schema.anyOf.some((sub) => validateAt(sub, value, root, path).length === 0)) {
    errors.push(`${at(path)}: matches none of anyOf`);
  }
  if (Array.isArray(schema.oneOf)) {
    const n = schema.oneOf.filter((sub) => validateAt(sub, value, root, path).length === 0).length;
    if (n !== 1) errors.push(`${at(path)}: matches ${n} of oneOf, not exactly one`);
  }
  if (schema.not !== undefined && validateAt(schema.not, value, root, path).length === 0) {
    errors.push(`${at(path)}: matches the schema under not`);
  }
}

function checkString(schema, value, path, errors) {
  const where = at(path);
  const length = [...value].length;
  if (typeof schema.minLength === 'number' && length < schema.minLength) errors.push(`${where}: shorter than ${schema.minLength} characters`);
  if (typeof schema.maxLength === 'number' && length > schema.maxLength) errors.push(`${where}: longer than ${schema.maxLength} characters`);
  if (typeof schema.pattern === 'string' && matches(schema.pattern, value) === false) {
    errors.push(`${where}: does not match ${schema.pattern}`);
  }
  if (typeof schema.format === 'string') {
    if (schema.format === 'uri' || schema.format === 'url') {
      if (!isUri(value)) errors.push(`${where}: not a URI`);
    } else {
      unchecked.add(`format ${schema.format}`);
    }
  }
}

// True or false, or null when the pattern is broken or too slow to trust.
function matches(pattern, value) {
  if (slowPatterns < MAX_SLOW_PATTERNS) {
    try {
      return runInNewContext('new RegExp(p, "u").test(v)', { p: pattern, v: value }, { timeout: PATTERN_MS });
    } catch (e) {
      if (e?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') slowPatterns += 1;
    }
  }
  unchecked.add(`pattern ${pattern}`);
  return null;
}

function checkNumber(schema, value, path, errors) {
  const where = at(path);
  if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${where}: below the minimum ${schema.minimum}`);
  if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${where}: above the maximum ${schema.maximum}`);
  if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) errors.push(`${where}: must be above ${schema.exclusiveMinimum}`);
  if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) errors.push(`${where}: must be below ${schema.exclusiveMaximum}`);
  if (typeof schema.multipleOf === 'number' && schema.multipleOf > 0) {
    const ratio = value / schema.multipleOf;
    if (Math.abs(ratio - Math.round(ratio)) > 1e-9) errors.push(`${where}: not a multiple of ${schema.multipleOf}`);
  }
}

function checkArray(schema, value, root, path, errors) {
  const where = at(path);
  if (typeof schema.minItems === 'number' && value.length < schema.minItems) errors.push(`${where}: fewer than ${schema.minItems} items`);
  if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) errors.push(`${where}: more than ${schema.maxItems} items`);
  if (schema.uniqueItems === true && new Set(value.map((v) => JSON.stringify(canon(v)))).size !== value.length) {
    errors.push(`${where}: items repeat`);
  }
  if (isObject(schema.items) || typeof schema.items === 'boolean') {
    value.forEach((item, i) => walk(schema.items, item, root, `${path}/${i}`, errors));
  } else if (Array.isArray(schema.items)) {
    unchecked.add('items as a list');
  }
}

function checkObject(schema, value, root, path, errors) {
  const where = at(path);
  const keys = Object.keys(value);
  if (typeof schema.minProperties === 'number' && keys.length < schema.minProperties) errors.push(`${where}: fewer than ${schema.minProperties} fields`);
  if (typeof schema.maxProperties === 'number' && keys.length > schema.maxProperties) errors.push(`${where}: more than ${schema.maxProperties} fields`);
  if (Array.isArray(schema.required)) {
    for (const key of schema.required) if (!Object.hasOwn(value, key)) errors.push(`${where}: missing ${key}`);
  }
  const props = isObject(schema.properties) ? schema.properties : {};
  for (const key of keys) {
    const sub = `${path}/${ptr(key)}`;
    if (Object.hasOwn(props, key)) walk(props[key], value[key], root, sub, errors);
    else if (schema.additionalProperties === false) errors.push(`${sub}: not in the schema`);
    else if (isObject(schema.additionalProperties)) walk(schema.additionalProperties, value[key], root, sub, errors);
  }
}

function resolveRef(root, ref) {
  if (ref === '#') return root;
  if (!ref.startsWith('#/')) return undefined;
  let node = root;
  for (const raw of ref.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (node === null || typeof node !== 'object' || !Object.hasOwn(node, key)) return undefined;
    node = node[key];
  }
  return node;
}

function isType(value, type) {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return isObject(value);
    default:
      unchecked.add(`type ${type}`);
      return true;
  }
}

const typeName = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

function isUri(value) {
  try {
    return Boolean(new URL(value).protocol);
  } catch {
    return false;
  }
}

// The first place two schemas differ, as a JSON pointer. `required` is compared as a set.
function firstDiff(a, b, path = '') {
  if (Array.isArray(a) && Array.isArray(b)) {
    const left = path.endsWith('/required') ? [...a].sort() : a;
    const right = path.endsWith('/required') ? [...b].sort() : b;
    if (left.length !== right.length) return { path: at(path), mine: `${left.length} items`, theirs: `${right.length} items` };
    for (let i = 0; i < left.length; i += 1) {
      const d = firstDiff(left[i], right[i], `${path}/${i}`);
      if (d) return d;
    }
    return null;
  }
  if (isObject(a) && isObject(b)) {
    for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const d = firstDiff(a[key], b[key], `${path}/${ptr(key)}`);
      if (d) return d;
    }
    return null;
  }
  return same(a, b) ? null : { path: at(path), mine: show(a, 60), theirs: show(b, 60) };
}

// ---------- TOOL.md ----------

function readSpec(path) {
  const name = printable(path);
  if (isShare(path)) return { error: `${name} is on a network share. Copy TOOL.md to this machine first.` };
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return { error: `${name} is not a file.` };
    if (stat.size > MAX_SPEC) return { error: `${name} is over 1 MB. A TOOL.md is a short file.` };
    return parseSpec(readFileSync(path, 'utf8'));
  } catch (e) {
    return { error: `Cannot read ${name}: ${e.code ?? 'it failed'}` };
  }
}

function parseSpec(text) {
  const lines = text.split(/\r?\n/);
  const blocks = {};
  let open = null;
  let body = [];
  for (const line of lines) {
    if (open === null) {
      open = /^```json[ \t]+([a-z-]+)[ \t]*$/.exec(line)?.[1] ?? null;
      body = [];
    } else if (/^```[ \t]*$/.test(line)) {
      blocks[open] = body.join('\n');
      open = null;
    } else {
      body.push(line);
    }
  }
  const replaceLines = lines.flatMap((l, i) => (l.includes('REPLACE') ? [i + 1] : []));
  return { blocks, replaceLines, description: descriptionOf(lines) };
}

// The first paragraph under "## Description": the text the server lists, word for word.
function descriptionOf(lines) {
  const after = lines.slice(lines.findIndex((l) => /^##\s+Description\s*$/.test(l)) + 1);
  if (after.length === lines.length) return null;
  const from = after.findIndex((l) => l.trim());
  if (from < 0 || after[from].startsWith('#')) return null;
  const to = after.findIndex((l, i) => i > from && (!l.trim() || l.startsWith('#')));
  return flat(after.slice(from, to < 0 ? undefined : to).join(' '));
}

function hasField(schema, dotted) {
  let node = schema;
  for (const part of dotted.split('.')) {
    if (!isObject(node) || !isObject(node.properties) || !Object.hasOwn(node.properties, part)) return false;
    node = node.properties[part];
  }
  return true;
}

function checkInputSchema(schema) {
  if (!isObject(schema) || schema.type !== 'object') {
    fail('the input schema needs "type": "object"');
    return;
  }
  ok('the input schema is an object schema');
  const props = Object.entries(isObject(schema.properties) ? schema.properties : {});
  const bare = props.filter(([, p]) => !isObject(p) || typeof p.description !== 'string' || !p.description.trim()).map(([k]) => k);
  const untyped = props
    .filter(([, p]) => isObject(p) && p.type === undefined && p.enum === undefined && p.const === undefined && p.$ref === undefined && !p.anyOf && !p.oneOf)
    .map(([k]) => k);
  if (bare.length) fail(`input fields with no description: ${bare.join(', ')}`);
  else ok('every input field has a description');
  if (untyped.length) fail(`input fields with no type: ${untyped.join(', ')}`);
  if (schema.additionalProperties !== false) {
    note('the input schema takes extra fields; "additionalProperties": false turns a misspelt field into an error');
  }
}

function checkSpec(file, args) {
  section(`spec  ${args.spec}`);
  if (file.replaceLines.length) fail(`REPLACE is left on these lines: ${file.replaceLines.slice(0, 12).join(', ')}`);
  else ok('no REPLACE left');
  const parsed = {};
  for (const key of ['input-schema', 'output-schema', 'check']) {
    if (file.blocks[key] === undefined) {
      fail(`no json ${key} block`);
      continue;
    }
    try {
      parsed[key] = JSON.parse(file.blocks[key]);
    } catch {
      fail(`the json ${key} block is not valid JSON`);
    }
  }
  const input = parsed['input-schema'];
  const output = parsed['output-schema'];
  const check = parsed.check;
  if (input !== undefined) checkInputSchema(input);
  if (output !== undefined) {
    if (isObject(output) && output.type === 'object') ok('the output schema is an object schema');
    else fail('the output schema needs "type": "object"');
  }
  if (!isObject(check)) {
    if (check !== undefined) fail('the check block must be a JSON object');
    return null;
  }
  const tool = args.tool ?? check.tool;
  const budget = args.budget ?? check.budgetBytes;
  if (typeof tool === 'string' && TOOL_NAME.test(tool)) ok(`tool name: ${tool}`);
  else fail('the tool name needs 1 to 128 letters, digits, underscores, hyphens or dots');
  if (Number.isInteger(budget) && budget > 0) ok(`budget: ${budget} bytes`);
  else fail('budgetBytes must be a whole number of bytes above 0');
  if (typeof check.sideEffects === 'boolean') ok(`sideEffects: ${check.sideEffects}`);
  else fail('sideEffects must be true or false: true when the tool changes anything outside this machine');
  const good = check.good;
  if (!isObject(good)) {
    fail('good must be an object: the arguments of a call that succeeds');
  } else if (isObject(input)) {
    const errs = validate(input, good);
    if (errs.length) fail(`the good sample breaks the input schema: ${errs.slice(0, 3).join('; ')}`);
    else ok('the good sample matches the input schema');
  }
  const wrongs = Array.isArray(check.wrong) ? check.wrong : [];
  if (!wrongs.length) fail('wrong must list at least one { "field": …, "args": … }');
  wrongs.forEach((w, i) => {
    const label = `wrong sample ${i + 1}`;
    if (!isObject(w) || typeof w.field !== 'string' || !isObject(w.args)) {
      fail(`${label} needs "field" (a string) and "args" (an object)`);
      return;
    }
    if (isObject(input) && !hasField(input, w.field)) fail(`${label}: ${w.field} is not a field of the input schema`);
    if (isObject(input)) {
      const errs = validate(input, w.args);
      info(`${label} (${w.field}): ${errs.length ? `breaks the input schema at ${errs[0]}` : 'passes the input schema, wrong in its value'}`);
    }
  });
  return { tool, budget, good, wrongs, input, output, sideEffects: check.sideEffects, description: file.description };
}

// ---------- transports ----------

// A local server over stdio: newline-delimited JSON-RPC on stdin and stdout.
class Stdio {
  constructor(cmd, timeoutMs, stubs = []) {
    this.cmd = cmd;
    this.timeoutMs = timeoutMs;
    // The last name stops cmd.exe from running a node.cmd or the like it finds in the current folder first.
    this.env = { ...process.env, ...Object.fromEntries(stubs.map((s) => [s.name, s.address])), NoDefaultCurrentDirectoryInExePath: '1' };
    this.label = `${cmd}  (stdio)`;
    this.noise = 0;
    this.start();
  }

  start() {
    this.pending = new Map();
    this.stderr = [];
    this.gone = null;
    // Its own process group on POSIX, so close() can end the shell and the server together.
    const child = spawn(this.cmd, { shell: true, detached: !WINDOWS, env: this.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (child !== this.child || this.gone) return;
      // Only the new chunk is searched, so a line with no end stays cheap.
      let start = 0;
      let end = chunk.indexOf('\n');
      while (end >= 0) {
        const text = (buffer + chunk.slice(start, end)).trim();
        buffer = '';
        start = end + 1;
        if (text) this.onLine(text);
        end = chunk.indexOf('\n', start);
      }
      buffer += chunk.slice(start);
      if (buffer.length > MAX_MESSAGE) {
        buffer = '';
        this.stop('the server wrote a line over 16 MB');
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      if (child !== this.child) return;
      this.stderr = [...this.stderr, ...chunk.split(/\r?\n/).filter((l) => l.trim())].slice(-6);
    });
    child.on('error', (e) => {
      if (child === this.child) this.stop(`the command did not start: ${e.message}`);
    });
    child.on('exit', (code, signal) => {
      if (child === this.child) this.stop(`the command exited (${signal ?? `code ${code}`})`);
    });
    child.stdin.on('error', () => {
      // A closed pipe shows up as the exit above.
    });
  }

  onLine(text) {
    const message = tryJson(text);
    if (!isObject(message)) {
      this.noise += 1;
      return;
    }
    if (typeof message.method === 'string') {
      // A request from the server: answer ping, decline the rest, so it never waits on us. An id only a
      // number or a string can be: anything else is noise, and it may be too deep to send back.
      if (typeof message.id === 'number' || typeof message.id === 'string') {
        this.write(
          message.method === 'ping'
            ? { jsonrpc: '2.0', id: message.id, result: {} }
            : { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'check-tool does not answer this' } },
        );
      }
      return;
    }
    const waiting = this.pending.get(message.id);
    if (waiting) {
      this.pending.delete(message.id);
      waiting({ message });
    }
  }

  stop(fact) {
    if (this.gone) return;
    this.gone = fact;
    for (const waiting of this.pending.values()) waiting({ failure: { kind: 'exited', fact } });
    this.pending.clear();
  }

  write(message) {
    if (!this.gone) this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  exchange(body, _headers, timeoutMs) {
    if (this.gone) return Promise.resolve({ failure: { kind: 'exited', fact: this.gone } });
    if (body.id === undefined) {
      this.write(body);
      return Promise.resolve({ sent: true });
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(body.id);
        resolve({ failure: { kind: 'timeout', fact: `no answer to ${body.method} in ${timeoutMs / 1000} s` } });
      }, timeoutMs);
      this.pending.set(body.id, (answer) => {
        clearTimeout(timer);
        resolve(answer);
      });
      this.write(body);
    });
  }

  async restart() {
    await this.close();
    this.start();
  }

  tail() {
    return this.stderr;
  }

  close() {
    const child = this.child;
    // Let go of our ends of the pipes too, so a server the shell left behind cannot keep this script open.
    const release = () => {
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
    };
    if (child.exitCode !== null || child.signalCode !== null) {
      this.kill();
      release();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        child.off('exit', finish);
        this.kill();
        release();
        resolve();
      };
      const timer = setTimeout(finish, WINDOWS ? 300 : 1500);
      child.once('exit', finish);
      child.stdin.end();
      if (!WINDOWS) killTree(child.pid, 'SIGTERM');
    });
  }

  // A shell that has exited on Windows has no tree left to walk, and its pid may be someone else's by now.
  kill() {
    const child = this.child;
    if (WINDOWS && (child.exitCode !== null || child.signalCode !== null)) return;
    killTree(child.pid, 'SIGKILL');
  }
}

// A server over Streamable HTTP: one POST per message, the answer as JSON or as an SSE event.
class Http {
  constructor(url, timeoutMs) {
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.label = `${plainUrl(url)}  (HTTP)`;
    this.noise = 0;
    this.session = null;
  }

  async exchange(body, headers, timeoutMs) {
    const all = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers };
    if (this.session) all['mcp-session-id'] = this.session;
    const waited = `no answer to ${body.method} in ${timeoutMs / 1000} s`;
    let res;
    try {
      // A redirect would carry the samples, or an answer, to an address nobody named.
      res = await fetch(this.url, { method: 'POST', headers: all, body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      if (e?.name === 'TimeoutError') return { failure: { kind: 'timeout', fact: waited } };
      return { failure: { kind: 'unreachable', fact: `no connection to ${plainUrl(this.url)}: ${e?.cause?.code ?? e?.name ?? 'it failed'}` } };
    }
    if (res.status >= 300 && res.status < 400) {
      res.body?.cancel().catch(() => {});
      return { failure: { kind: 'unreachable', fact: `HTTP ${res.status} on ${body.method}: a redirect, and this script does not follow one` } };
    }
    const session = res.headers.get('mcp-session-id');
    if (session) this.session = session;
    if (body.id === undefined) {
      res.body?.cancel().catch(() => {});
      return { sent: true };
    }
    if (res.status === 401 || res.status === 403) {
      res.body?.cancel().catch(() => {});
      return { failure: { kind: 'sign-in', fact: `HTTP ${res.status} on ${body.method}` } };
    }
    let answer;
    try {
      answer = await readAnswer(res, body.id, timeoutMs);
    } catch (e) {
      if (e?.name === 'TimeoutError') return { failure: { kind: 'timeout', fact: waited } };
      // Not a slow server: a broken answer. On some machines a web filter breaks HTTP on a path with "mcp" in it.
      return { failure: { kind: 'unreachable', fact: `the answer to ${body.method} broke off: ${e?.cause?.message ?? e?.message ?? e}` } };
    }
    const message = answer.message ?? pickMessage(answer.text, answer.type, body.id);
    if (!message) {
      const kind = res.status >= 500 ? 'unreachable' : 'not-mcp';
      const said = answer.text.trim() ? `: ${quoted(answer.text.trim(), 120)}` : '';
      return { failure: { kind, fact: `HTTP ${res.status} on ${body.method}, no JSON-RPC answer${said}` } };
    }
    return { message };
  }

  tail() {
    return [];
  }

  kill() {}

  async close() {
    if (!this.session) return;
    try {
      await fetch(this.url, { method: 'DELETE', headers: { 'mcp-session-id': this.session }, redirect: 'manual', signal: AbortSignal.timeout(3000) });
    } catch {
      // The session ends on its own.
    }
  }
}

// Reads an answer up to 16 MB, and an SSE answer only until the message for `id` arrives: some servers
// keep the stream open. Each SSE event is read once, as it completes.
async function readAnswer(res, id, timeoutMs) {
  const type = res.headers.get('content-type') ?? '';
  if (!res.body) return { text: '', type };
  const stopAt = Date.now() + timeoutMs;
  const sse = type.includes('text/event-stream');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let rest = '';
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_MESSAGE) {
      reader.cancel().catch(() => {});
      throw new Error('the answer is over 16 MB');
    }
    // Chunks already buffered arrive with no pause for the abort timer, so the clock is read here too.
    if (Date.now() > stopAt) {
      reader.cancel().catch(() => {});
      throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    }
    const chunk = decoder.decode(value, { stream: true });
    if (!sse) {
      text += chunk;
      continue;
    }
    if (text.length < MAX_LINE) text += chunk;
    const events = (rest + chunk).split(/\r?\n\r?\n/);
    rest = events.pop();
    for (const event of events) {
      const message = pickMessage(event, type, id);
      if (message) {
        reader.cancel().catch(() => {});
        return { message, text, type };
      }
    }
  }
  return { message: rest ? pickMessage(rest, type, id) : null, text, type };
}

function pickMessage(text, type, id) {
  const found = [];
  if (type && type.includes('text/event-stream')) {
    for (const event of text.split(/\r?\n\r?\n/)) {
      const data = event
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).replace(/^ /, ''))
        .join('\n');
      if (/^\s*[{[]/.test(data)) found.push(tryJson(data));
    }
  } else {
    found.push(tryJson(text));
  }
  for (const message of found.flat()) {
    if (!isObject(message)) continue;
    if (message.id !== id && message.id !== null && message.id !== undefined) continue;
    if ('result' in message || isObject(message.error)) return message;
  }
  return null;
}

// `Mcp-Name` header value: plain visible ASCII as it is, anything else in the base64 form.
function headerValue(value) {
  const s = String(value ?? '');
  const plain = /^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/.test(s) && !(s.startsWith('=?base64?') && s.endsWith('?='));
  return plain ? s : `=?base64?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

// ---------- the MCP session ----------

class Session {
  constructor(transport) {
    this.t = transport;
    this.lastId = 0;
    this.era = 'modern';
    this.version = null;
  }

  headers(method, params) {
    if (this.era === 'modern') {
      const h = { 'mcp-protocol-version': MODERN, 'mcp-method': method };
      if (method === 'tools/call') h['mcp-name'] = headerValue(params.name);
      return h;
    }
    return this.version ? { 'mcp-protocol-version': this.version } : {};
  }

  async request(method, params = {}, timeoutMs = this.t.timeoutMs) {
    this.lastId += 1;
    const body = { jsonrpc: '2.0', id: this.lastId, method, params: this.era === 'modern' ? { ...params, _meta: META } : params };
    const answer = await this.t.exchange(body, this.headers(method, params), timeoutMs);
    if (answer.failure) return { ok: false, failure: answer.failure };
    const message = answer.message;
    if (isObject(message.error)) return { ok: false, error: { code: message.error.code, message: String(message.error.message ?? '') } };
    return { ok: true, result: isObject(message.result) ? message.result : {} };
  }

  notify(method) {
    return this.t.exchange({ jsonrpc: '2.0', method, params: {} }, this.headers(method, {}), 5000);
  }

  async open() {
    this.era = 'modern';
    const discoverMs = Math.min(this.t.timeoutMs, this.t instanceof Stdio ? 5000 : 10000);
    const d = await this.request('server/discover', {}, discoverMs);
    if (d.ok) {
      const versions = Array.isArray(d.result.supportedVersions) ? d.result.supportedVersions : [];
      if (versions.includes(MODERN)) {
        const meta = isObject(d.result._meta) ? d.result._meta : {};
        const serverInfo = isObject(meta['io.modelcontextprotocol/serverInfo']) ? meta['io.modelcontextprotocol/serverInfo'] : {};
        return { ok: true, version: `${MODERN} (server/discover)`, name: typeof serverInfo.name === 'string' ? serverInfo.name : null };
      }
    } else if (d.failure?.kind === 'sign-in' || d.failure?.kind === 'unreachable') {
      return { ok: false, failure: d.failure };
    } else if (d.failure?.kind === 'exited' && this.t instanceof Stdio) {
      // Some older stdio servers quit on a method they do not know: start it again for the handshake.
      await this.t.restart();
    }
    // Not the current revision: the handshake of the revision before it. initialize opens a new HTTP
    // session, so it never carries a session id from the discover answer.
    this.era = 'legacy';
    if (this.t instanceof Http) this.t.session = null;
    const init = await this.request('initialize', { protocolVersion: LEGACY, capabilities: {}, clientInfo: CLIENT });
    if (!init.ok) {
      const fact = init.failure ? init.failure.fact : `initialize answered JSON-RPC error ${init.error.code} ${quoted(init.error.message, 100)}`;
      return { ok: false, failure: { kind: init.failure?.kind ?? 'not-mcp', fact } };
    }
    this.version = typeof init.result.protocolVersion === 'string' ? init.result.protocolVersion : LEGACY;
    await this.notify('notifications/initialized');
    const serverInfo = isObject(init.result.serverInfo) ? init.result.serverInfo : {};
    return { ok: true, version: `${this.version} (initialize)`, name: typeof serverInfo.name === 'string' ? serverInfo.name : null };
  }
}

async function listTools(session) {
  const tools = [];
  let cursor = null;
  for (let page = 0; page < 20; page += 1) {
    const r = await session.request('tools/list', cursor ? { cursor } : {});
    if (!r.ok) return { ok: false, why: r.failure ? r.failure.fact : `JSON-RPC error ${r.error.code} ${quoted(r.error.message, 120)}` };
    if (Array.isArray(r.result.tools)) tools.push(...r.result.tools.filter((t) => isObject(t) && typeof t.name === 'string'));
    cursor = typeof r.result.nextCursor === 'string' && r.result.nextCursor ? r.result.nextCursor : null;
    if (!cursor) break;
  }
  return { ok: true, tools };
}

// ---------- the checks on the server ----------

function openFailure(failure) {
  if (failure.kind === 'sign-in') {
    return `the server asks for sign-in (${failure.fact}). This script does not sign in. Check this server through its stdio entry with --cmd, if it has one; if it has none, tell your human that this script cannot call it. Never turn off a server's sign-in, or add a switch that turns it off, to run this check`;
  }
  return `no MCP session: ${failure.fact}`;
}

async function runServer(session, spec) {
  section(`server  ${session.t.label}`);
  const opened = await session.open();
  if (!opened.ok) {
    fail(openFailure(opened.failure));
    for (const l of session.t.tail()) info(`stderr: ${quoted(l, 160)}`);
    return;
  }
  info(`protocol ${opened.version}${opened.name ? `, server ${quoted(opened.name, 60)}` : ''}`);
  if (session.era === 'legacy') note(`the server speaks only the older handshake: a client on ${MODERN} alone cannot connect`);

  const listed = await listTools(session);
  if (!listed.ok) {
    fail(`tools/list: ${listed.why}`);
    return;
  }
  const tool = listed.tools.find((t) => t.name === spec.tool);
  if (!tool) {
    fail(`${spec.tool} is not listed (listed: ${listed.tools.map((t) => t.name).slice(0, 15).join(', ') || 'none'})`);
    return;
  }
  ok(`${spec.tool} is listed`);
  info(`its tools/list entry is ${bytes(JSON.stringify(tool))} bytes: every agent that connects reads it`);
  if (typeof tool.description === 'string' && tool.description.trim()) {
    ok('it has a description');
    if (!spec.description) note('TOOL.md has no text under "## Description", so the description was not compared');
    else if (flat(tool.description) === spec.description) ok('its description matches TOOL.md');
    else fail(`its description differs from TOOL.md: the server lists ${quoted(flat(tool.description), 120)}`);
  } else {
    fail('it has no description');
  }
  const listedSchemas = {};
  for (const [key, mine] of [['inputSchema', spec.input], ['outputSchema', spec.output]]) {
    const theirs = tool[key];
    if (!isObject(theirs)) {
      fail(`it lists no ${key}`);
      continue;
    }
    listedSchemas[key] = theirs;
    const d = firstDiff(withoutDialect(mine), withoutDialect(theirs));
    if (d) fail(`its ${key} differs from TOOL.md at ${d.path}: TOOL.md has ${d.mine}, the server lists ${d.theirs}`);
    else ok(`its ${key} matches TOOL.md`);
  }

  if (spec.sideEffects === false && isObject(tool.annotations) && tool.annotations.destructiveHint === true) {
    fail('the server marks this tool as destructive, but TOOL.md says "sideEffects": false. No sample was sent');
    return;
  }
  await goodCall(session, spec, listedSchemas.outputSchema);
  for (const w of spec.wrongs) await wrongCall(session, spec, w);
  if (session.t.noise) note(`${session.t.noise} line(s) on stdout were not JSON-RPC: a stdio server writes its own output to stderr`);
}

async function goodCall(session, spec, listedOutput) {
  section(`good call  ${show(spec.good)}`);
  const r = await session.request('tools/call', { name: spec.tool, arguments: spec.good });
  if (!r.ok) {
    fail(r.failure ? `no result: ${r.failure.fact}` : `a JSON-RPC error (${r.error.code} ${quoted(r.error.message, 120)}), not a result`);
    return;
  }
  const res = r.result;
  const total = bytes(JSON.stringify(res));
  if (res.isError === true) {
    fail(`came back as a tool error (${total} bytes): ${quoted(textOf(res))}`);
    return;
  }
  ok('a result, not an error');
  if (!isObject(res.structuredContent)) {
    fail('no structuredContent: the result is free text');
  } else {
    const errs = validate(spec.output, res.structuredContent);
    if (errs.length) fail(`structuredContent breaks the output schema: ${errs.slice(0, 3).join('; ')}`);
    else ok('structuredContent matches the output schema');
    if (isObject(listedOutput) && !same(withoutDialect(listedOutput), withoutDialect(spec.output))) {
      const listedErrs = validate(listedOutput, res.structuredContent);
      if (listedErrs.length) fail(`structuredContent breaks the outputSchema the server lists: ${listedErrs.slice(0, 3).join('; ')}`);
    }
  }
  const texts = textItems(res);
  const sc = res.structuredContent === undefined ? 0 : bytes(JSON.stringify(res.structuredContent));
  const tx = texts.reduce((n, t) => n + bytes(t), 0);
  const split = `structuredContent ${sc} B, text ${tx} B, the rest ${total - sc - tx} B`;
  if (total <= spec.budget) ok(`${total} bytes, within the budget of ${spec.budget} (${split})`);
  else fail(`${total} bytes, over the budget of ${spec.budget} (${split})`);
  if (!texts.length) note('no text item: a client that reads only content sees nothing');
  if (texts.length > 1) note(`${texts.length} text items: one is enough`);
  if (isObject(res.structuredContent) && texts.some((t) => /\n\s/.test(t) && same(tryJson(t), res.structuredContent))) {
    note('the text item is indented JSON: compact JSON costs fewer bytes');
  }
}

async function wrongCall(session, spec, w) {
  section(`wrong call  ${w.field}  ${show(w.args)}`);
  const r = await session.request('tools/call', { name: spec.tool, arguments: w.args });
  if (!r.ok) {
    fail(
      r.failure
        ? `no result: ${r.failure.fact}`
        : `a JSON-RPC error (${r.error.code} ${quoted(r.error.message, 120)}), not a tool result: the model may never read it. Return a result with isError: true`,
    );
    return;
  }
  const res = r.result;
  const text = textOf(res);
  if (res.isError !== true) {
    fail(`came back as a success, not with isError: true${text ? `: ${quoted(text)}` : ''}`);
    return;
  }
  ok('isError: true');
  if (!text.trim()) {
    fail('the error has no text for the model to read');
    return;
  }
  info(`the model reads: ${quoted(text)}`);
  if (namesField(text, w.field)) ok(`names the field: ${w.field}`);
  else fail(`does not name the field ${w.field}`);
  if (saysNext(text, w)) ok('says what to send next');
  else fail('does not say what to send next (send, use, expected, at most, and the like)');
  if (bytes(text) > LONG_ERROR_BYTES) note(`the error is ${bytes(text)} bytes: the model reads every one`);
}

function namesField(text, field) {
  return [field, field.split('.').pop()].some((name) => new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(name)}([^A-Za-z0-9_]|$)`, 'i').test(text));
}

// The words that say what to send next must not come from the wrong value echoed back. Only the whole
// value is taken out, so a short value such as "e" does not cut letters out of the other words.
function saysNext(text, w) {
  let rest = text;
  for (const v of Object.values(w.args)) {
    if (typeof v !== 'string' || !v) continue;
    rest = rest.replace(new RegExp(`(^|[^A-Za-z0-9_])${escapeRe(v)}(?=[^A-Za-z0-9_]|$)`, 'g'), '$1 ');
  }
  return NEXT.test(rest);
}

// ---------- main ----------

function parseArgs(argv) {
  const args = { yes: false, timeout: 30, stubs: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = () => {
      i += 1;
      if (argv[i] === undefined) throw new Error(`${flag} needs a value`);
      return argv[i];
    };
    if (flag === '--spec') args.spec = value();
    else if (flag === '--cmd') args.cmd = value();
    else if (flag === '--url') args.url = value();
    else if (flag === '--tool') args.tool = value();
    else if (flag === '--budget') args.budget = Number(value());
    else if (flag === '--timeout') args.timeout = Number(value());
    else if (flag === '--stub') args.stubs.push(parseStub(value()));
    else if (flag === '--stub-log') args.stubLog = value();
    else if (flag === '--yes') args.yes = true;
    else if (flag === '--self-test') args.selfTest = true;
    else if (flag === '--help' || flag === '-h') args.help = true;
    else throw new Error(`Unknown option: ${flag}`);
  }
  return args;
}

function printPlan(args, spec) {
  section('plan');
  if (args.cmd) {
    info(`start  ${args.cmd}  (stdio, in ${process.cwd()})`);
  } else {
    info(`call   ${plainUrl(args.url)}  (Streamable HTTP)`);
    if (!isLocal(args.url)) note('this is not a local address: the samples leave this machine');
  }
  info(`tool   ${spec.tool}`);
  info(`good   ${show(spec.good)}`);
  for (const w of spec.wrongs) info(`wrong  ${w.field}  ${show(w.args)}`);
  for (const s of args.stubs) info(`stub   ${s.name}=${s.address}${args.url ? '  (start the server with this variable: --url cannot set it)' : ''}`);
  if (args.stubs.length) note('the tool runs for real on these samples, against the stub');
  else note('the tool runs for real on these samples, and it may call its own upstream (an API, a model)');
}

const NEEDS_STUB = `
TOOL.md says this tool changes something outside this machine, so it runs only against a stub.
A stub is a small server on this machine that answers as the upstream does and sends nothing on.
  1. Make the tool read its upstream's address from one environment variable.
  2. Start a stub on this machine that writes each request to a file.
  3. Add both to this command: --stub MAIL_API_URL=http://127.0.0.1:9000 --stub-log stub.log
Nothing was started or sent.`;

// The good sample's text and numbers at any depth, up to a limit. Empty text would match any log.
function sampleValues(good) {
  const values = [];
  const todo = [good];
  for (let i = 0; i < todo.length && values.length < MAX_SAMPLE_VALUES; i += 1) {
    const v = todo[i];
    if (typeof v === 'number' || (typeof v === 'string' && v)) values.push(String(v));
    else if (v !== null && typeof v === 'object') for (const item of Object.values(v)) todo.push(item);
  }
  return values;
}

// The proof that the tool used the stub: what this run added to the stub's log holds the good sample.
function checkStubLog(path, before, good) {
  section('stub');
  const values = sampleValues(good);
  let text;
  try {
    const all = readFileSync(path);
    text = all.subarray(all.length >= before ? before : 0, before + MAX_MESSAGE).toString('utf8');
  } catch {
    text = '';
  }
  if (!values.length) {
    if (text.trim()) note('the good sample has no string or number to look for in the stub\'s log');
    else fail("the good sample has no string or number, and this run added nothing to the stub's log: the tool may have gone to its real upstream. Check that it reads the --stub variable");
    return;
  }
  if (values.some((v) => text.includes(v) || text.includes(JSON.stringify(v).slice(1, -1)))) ok('the good sample reached the stub');
  else fail("the good sample is not in the stub's log: the tool may have gone to its real upstream. Check that it reads the --stub variable");
}

function finish() {
  if (unchecked.size) note(`not checked by this script: ${[...unchecked].slice(0, 10).join(', ')}`);
  section(failed ? `${failed} of ${passed + failed} checks failed.` : `Every check passed (${passed}).`);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`${e.message}\n\n${USAGE}`);
    return 2;
  }
  if (args.selfTest) return selfTest();
  if (args.help || !args.spec) {
    console.log(USAGE);
    return 2;
  }
  if (args.cmd && args.url) {
    console.error('Give --cmd or --url, not both.');
    return 2;
  }
  if (args.url && !/^https?:\/\//i.test(args.url)) {
    console.error('--url needs an http or https endpoint.');
    return 2;
  }
  if (!(args.timeout > 0)) {
    console.error('--timeout needs a number of seconds above 0.');
    return 2;
  }

  const file = readSpec(args.spec);
  if (file.error) {
    console.error(file.error);
    return 2;
  }
  const spec = checkSpec(file, args);

  if (!args.cmd && !args.url) {
    finish();
    console.log('Only TOOL.md was checked. Nothing was started or sent.');
    return failed ? 1 : 2;
  }
  if (!spec || failed) {
    finish();
    console.log('Fix TOOL.md first. Nothing was started or sent.');
    return 1;
  }
  if (args.stubs.length && args.url && !isLocal(args.url)) {
    console.log('\n--stub needs a server on this machine: a server elsewhere cannot reach it. Nothing was started or sent.');
    return 2;
  }
  printPlan(args, spec);
  if (spec.sideEffects && (!args.stubs.length || !args.stubLog)) {
    console.log(NEEDS_STUB);
    return 2;
  }
  if (args.stubLog && isShare(args.stubLog)) {
    console.log('\n--stub-log is on a network share. A stub runs on this machine. Nothing was started or sent.');
    return 2;
  }
  if (!args.yes) {
    console.log(`\nTOOL.md passed its checks (${passed}). Nothing was started or sent.`);
    console.log('Run the same command with --yes to call the tool for real.');
    return 2;
  }

  const timeoutMs = args.timeout * 1000;
  const transport = args.cmd ? new Stdio(args.cmd, timeoutMs, args.stubs) : new Http(args.url, timeoutMs);
  const logBefore = args.stubLog ? fileSize(args.stubLog) : 0;
  // Ctrl+C does not reach a server in its own process group, and a crash skips the close below.
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.once(signal, () => {
      transport.kill();
      process.exit(130);
    });
  }
  process.once('uncaughtException', (e) => {
    console.error(`check-tool stopped: ${printable(e?.message ?? e)}`);
    transport.kill();
    process.exit(3);
  });
  // One limit for the whole run, so the script ends before the harness that runs it gives up on it.
  const total = args.timeout * 3 + 10;
  const deadline = setTimeout(() => {
    fail(`the whole run took over ${total} s, so it stopped`);
    transport.kill();
    finish();
    process.exit(1);
  }, total * 1000);
  try {
    await runServer(new Session(transport), spec);
  } finally {
    clearTimeout(deadline);
    await transport.close();
  }
  if (args.stubLog) checkStubLog(args.stubLog, logBefore, spec.good);
  finish();
  return failed ? 1 : 0;
}

// ---------- self-test ----------

// The self-test resets the two counts and reads one, so it gets them through this.
const counts = {
  reset() {
    passed = 0;
    failed = 0;
  },
  get failed() {
    return failed;
  },
};

async function selfTest() {
  const { selfTest: checks } = await import('./check-tool.selftest.mjs');
  return checks({ MAX_LINE, unchecked, counts, printable, ok, quoted, isLocal, plainUrl, isShare, parseStub, slowPatterns, validate, walk, matches, firstDiff, parseSpec, checkSpec, pickMessage, headerValue, namesField, saysNext });
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(`check-tool stopped: ${printable(error?.message ?? error)}`);
    process.exitCode = 3;
  },
);
