#!/usr/bin/env node
// egress.mjs · each secret goes only to its own hosts. Rule 1 of the clock pack, in code.
//
//   node egress.mjs --hosts hosts.json [--vars vars.json] <METHOD> <url> [--header 'name: value']... [--body file]
//   node egress.mjs --self-test
//
// A request names a secret as {{NAME}} in its URL, a header value or its body. This script fills the
// value in only here, after the check, and only for a request to a host that hosts.json lists for that
// secret: { "WEATHER_KEY": ["api.example.com"] }. An entry is one exact host with its scheme and port:
// `api.example.com` means https on port 443; write `http://host:8080` for plain http or another port.
// There is no wildcard: `api.example.com` does not cover `www.api.example.com`.
//
// Redirects are not followed blindly. Each hop is checked again, with every secret the request holds,
// before anything goes to it. A hop to a host that is not on a held secret's list is refused, and that
// host gets nothing: no header, no body. At most 5 redirects.
//
// Refused on every hop: a user name or password in the URL, a host that ends with a dot, a Host header,
// a secret inside the host or port, an IP address or a name on this machine or a private network that
// hosts.json does not list exactly, and always a link-local or cloud metadata address. Every address a
// name resolves to is checked, and the connection goes only to the addresses checked.
//
// A secret's value comes from --vars (a JSON object of names and values), else from the environment
// variable of the same name. No value is printed: output, errors and the response show {{NAME}} instead.
// A request that writes a listed secret's value out (in any form this script hides) instead of {{NAME}}
// is refused, and so is a secret shorter than 8 characters, and a secret while
// NODE_TLS_REJECT_UNAUTHORIZED=0 turns certificate checks off.
// Exit codes: 0 a response came back (any HTTP status), 1 a network error, 2 a usage error, 3 refused.
// Plain Node.js 20 or newer, no dependencies.

import { lookup as dnsLookup } from 'node:dns/promises';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

export const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 30_000;
const MAX_MB = 10;
const MAX_BYTES = MAX_MB * 1024 * 1024;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const REF = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;
const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const MIN_SECRET = 8;

// A request this script will not send. The message is the one line to print.
export class Refused extends Error {
  constructor(message) {
    super(`refused: ${message}`);
    this.refused = true;
  }
}

// ---------------------------------------------------------------------------------------------------
// Addresses (ported from the read pack's find-contract.mjs).

// Address ranges that are not the public internet, as [first address, prefix length, what it is]
// (the IANA special-purpose address registries).
const NOT_PUBLIC = [
  ['0.0.0.0', 8, 'an unspecified address'],
  ['10.0.0.0', 8, 'a private address'],
  ['100.64.0.0', 10, 'a shared (carrier-grade NAT) address'],
  ['127.0.0.0', 8, 'a loopback address'],
  ['100.100.100.200', 32, 'a cloud metadata address'],
  ['168.63.129.16', 32, 'a cloud metadata address'],
  ['169.254.0.0', 16, 'a link-local address'],
  ['172.16.0.0', 12, 'a private address'],
  ['192.0.0.0', 24, 'a reserved address'],
  ['192.0.2.0', 24, 'a documentation address'],
  ['192.88.99.0', 24, 'a relay address'],
  ['192.168.0.0', 16, 'a private address'],
  ['198.18.0.0', 15, 'a benchmarking address'],
  ['198.51.100.0', 24, 'a documentation address'],
  ['203.0.113.0', 24, 'a documentation address'],
  ['224.0.0.0', 4, 'a multicast address'],
  ['240.0.0.0', 4, 'a reserved address'],
  ['::', 128, 'an unspecified address'],
  ['::1', 128, 'a loopback address'],
  ['::ffff:0:0', 96, 'an IPv4-mapped address'],
  ['::', 96, 'an IPv4-compatible address'],
  ['64:ff9b:1::', 48, 'a local NAT64 address'],
  ['100::', 64, 'a discard address'],
  ['2001::', 23, 'a reserved address'],
  ['2001:db8::', 32, 'a documentation address'],
  ['3fff::', 20, 'a documentation address'],
  ['fc00::', 7, 'a unique local address'],
  ['fe80::', 10, 'a link-local address'],
  ['fec0::', 10, 'a site-local address'],
  ['ff00::', 8, 'a multicast address'],
];
// IPv6 ranges that carry an IPv4 address: [first address, prefix length, bits to the right of it].
// NAT64 (64:ff9b::) and 6to4 (2002::) reach that IPv4 address, so it is checked too.
const CARRIES_IPV4 = [
  ['64:ff9b::', 96, 0],
  ['2002::', 16, 80],
];

// An IP address as one number and its length in bits, or null.
function ipBits(ip) {
  const v = isIP(ip);
  if (v === 4) return { n: ip.split('.').reduce((n, b) => (n << 8n) | BigInt(b), 0n), bits: 32 };
  if (v !== 6) return null;
  let s = ip;
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(s);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    s = `${s.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [left, right] = s.split('::');
  const head = left ? left.split(':') : [];
  const tail = right ? right.split(':') : [];
  const words = right === undefined ? head : [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail];
  return { n: words.reduce((n, w) => (n << 16n) | BigInt(parseInt(w, 16)), 0n), bits: 128 };
}

function inRange(a, first, prefix) {
  const f = ipBits(first);
  const shift = BigInt(a.bits - prefix);
  return f.bits === a.bits && a.n >> shift === f.n >> shift;
}

// The IPv4 address that ip carries, or null.
function carried(ip) {
  const a = ipBits(ip.replace(/%.*$/, ''));
  const range = a && CARRIES_IPV4.find(([first, prefix]) => inRange(a, first, prefix));
  if (!range) return null;
  const v4 = (a.n >> BigInt(range[2])) & 0xffffffffn;
  return [24n, 16n, 8n, 0n].map((s) => (v4 >> s) & 255n).join('.');
}

// What kind of address ip is when it is not a public one ("a loopback address"); null when it is public.
export function notPublic(ip) {
  const a = ipBits(ip.replace(/%.*$/, ''));
  if (!a) return 'not an IP address';
  const inner = carried(ip);
  if (inner) {
    const why = notPublic(inner);
    return why && `an address that carries ${inner}, ${why}`;
  }
  const why = NOT_PUBLIC.find(([first, prefix]) => inRange(a, first, prefix))?.[2];
  if (why) return why;
  // Only 2000::/3 is the public IPv6 internet; anything else is reserved, or carries another address.
  return a.bits === 128 && !inRange(a, '2000::', 3) ? 'a reserved address' : null;
}

// Never sent to, even when hosts.json lists it: link-local and cloud metadata addresses, where a cloud
// machine answers with its keys (169.254.169.254, 168.63.129.16, fd00:ec2::254), in any IPv6 form that
// carries one.
const NEVER = [
  ['192.0.0.192', 32],
  ['100.100.100.200', 32],
  ['168.63.129.16', 32],
  ['169.254.0.0', 16],
  ['fe80::', 10],
  ['fd00:ec2::254', 128],
  ['fd20:ce::254', 128],
  ['fd00:c1::a9fe:a9fe', 128],
  ['fd00:42::42', 128],
  ['fd00:a9fe:a9fe::1', 128],
  ['64:ff9b:1::', 48],
];
const CARRIERS = [['::ffff:0:0', 96, 0], ['::ffff:0:0:0', 96, 0], ['::', 96, 0], ...CARRIES_IPV4];

export function never(ip) {
  const a = ipBits(ip.replace(/%.*$/, ''));
  if (!a) return false;
  if (NEVER.some(([first, prefix]) => inRange(a, first, prefix))) return true;
  const carrier = CARRIERS.find(([first, prefix]) => inRange(a, first, prefix));
  if (!carrier) return false;
  const v4 = (a.n >> BigInt(carrier[2])) & 0xffffffffn;
  return never([24n, 16n, 8n, 0n].map((s) => (v4 >> s) & 255n).join('.'));
}

// The networks this machine is on, from each interface's address and prefix. A public address on one
// still reaches this machine or the devices next to it. A prefix shorter than a quarter of the address
// (a catch-all VPN route) is no network of ours: only the address itself counts.
function net(ip, prefix) {
  const a = ipBits(ip.replace(/%.*$/, ''));
  return a && { ...a, prefix: prefix ?? a.bits };
}
let own = null;
function ownNets() {
  if (own) return own;
  try {
    own = Object.values(networkInterfaces())
      .flat()
      .map((i) => net(i.address, i.cidr ? Number(i.cidr.slice(i.cidr.lastIndexOf('/') + 1)) : undefined))
      .filter(Boolean)
      .map((n) => (n.prefix >= n.bits / 4 ? n : { ...n, prefix: n.bits }));
  } catch {
    own = [];
  }
  return own;
}
function onOwnNet(ip, nets) {
  const a = ipBits(ip.replace(/%.*$/, ''));
  return Boolean(a) && nets.some((n) => n.bits === a.bits && a.n >> BigInt(a.bits - n.prefix) === n.n >> BigInt(n.bits - n.prefix));
}

const bare = (host) => host.replace(/^\[|\]$/g, '');
// Does the host name itself say it is local? localhost, a name under .localhost, .local, .internal or
// .home.arpa.
const namesLocal = (host) => /^(.*\.)?(localhost|local|internal|home\.arpa)$/i.test(host);

// ---------------------------------------------------------------------------------------------------
// Host lists.

const DEFAULT_PORT = { 'https:': '443', 'http:': '80' };
// A URL's scheme, host and port, always with the port: "https://api.example.com:443".
export const originOf = (url) => `${url.protocol}//${url.hostname}:${url.port || DEFAULT_PORT[url.protocol] || ''}`;
// How a refusal names a hop: the host, and the scheme and port when they are not https and 443.
const where = (url) => (url.protocol === 'https:' ? url.host : `${url.protocol}//${url.host}`);

// One hosts.json entry as the origin it allows. Throws on an entry that is not one exact host.
function entryOrigin(name, entry) {
  const bad = (why) => new Error(`hosts.json: ${name}: ${JSON.stringify(entry)} ${why}`);
  if (typeof entry !== 'string' || entry.trim() === '') throw bad('is not a host');
  const text = entry.includes('://') ? entry : `https://${entry}`;
  let url;
  try {
    url = new URL(text);
  } catch {
    throw bad('is not a host');
  }
  if (!DEFAULT_PORT[url.protocol]) throw bad('is not http or https');
  if (url.username || url.password) throw bad('has a user name or password in it');
  if (url.hostname.endsWith('.')) throw bad('ends with a dot');
  if (url.hostname.includes('*')) throw bad('has a wildcard: list each host');
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) throw bad('has a path: list the host only');
  return originOf(url);
}

// hosts.json as a Map of secret name to the Set of origins it may reach.
export function hostLists(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('hosts.json: not an object of names and host lists');
  const lists = new Map();
  for (const [name, entries] of Object.entries(json)) {
    if (!NAME.test(name)) throw new Error(`hosts.json: ${JSON.stringify(name)} is not a secret name (letters, digits, _)`);
    if (!Array.isArray(entries)) throw new Error(`hosts.json: ${name}: not a list of hosts`);
    lists.set(name, new Set(entries.map((e) => entryOrigin(name, e))));
  }
  return lists;
}

// ---------------------------------------------------------------------------------------------------
// Secrets in and out of text.

// encodeURIComponent with ! ' ( ) * encoded too: new URL writes ' as %27 in a query, a form neither
// encodeURIComponent nor the full encoding below has.
const strictEncode = (v) => encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// The forms of a value that count as the value: as it is, percent-encoded (every sign, in either case),
// base64, JSON-escaped and hex.
export function formsOf(value) {
  const bytes = Buffer.from(value);
  const pct = (upper) => value.replace(/[^A-Za-z0-9]/g, (c) => [...Buffer.from(c)].map((b) => `%${b.toString(16).padStart(2, '0')}`).join('')).replace(/%[0-9a-f]{2}/g, (m) => (upper ? m.toUpperCase() : m));
  const json = JSON.stringify(value).slice(1, -1);
  const hex = bytes.toString('hex');
  return new Set([value, encodeURIComponent(value), strictEncode(value), pct(false), pct(true), bytes.toString('base64'), bytes.toString('base64url'), json, json.replace(/\//g, '\\/'), hex, hex.toUpperCase()]);
}

// The listed secrets (names in hosts.json) that have a value, as { name: value }.
export function listedValues(vars, lists) {
  return Object.fromEntries(Object.entries(vars ?? {}).filter(([k, v]) => lists.has(k) && typeof v === 'string' && v !== ''));
}

// The first listed secret whose value is too short to tell apart from other text, or null.
export function tooShort(vars, lists) {
  return Object.entries(listedValues(vars, lists)).find(([, v]) => v.length < MIN_SECRET)?.[0] ?? null;
}

// Every secret value this run knows, with its name, longest first, so output can show {{NAME}} instead.
export function hider(vars) {
  const pairs = [];
  for (const [name, value] of Object.entries(vars)) {
    if (typeof value !== 'string' || value.length < MIN_SECRET) continue;
    for (const form of formsOf(value)) pairs.push([form, `{{${name}}}`]);
  }
  pairs.sort((a, b) => b[0].length - a[0].length);
  return (text) => {
    let s = String(text);
    for (const [form, ref] of pairs) s = s.split(form).join(ref);
    return s;
  };
}

const refsIn = (text) => [...String(text ?? '').matchAll(REF)].map((m) => m[1]);

function fill(text, value, encode) {
  return String(text).replace(REF, (_, name) => (encode ? strictEncode(value(name)) : value(name)));
}

// ---------------------------------------------------------------------------------------------------
// The check of one hop. Sync part: what the URL itself says.

export function checkHop(url, held, lists, hop) {
  const at = `(hop ${hop})`;
  if (!DEFAULT_PORT[url.protocol]) throw new Refused(`${url.protocol} is not http or https ${at}`);
  if (url.username || url.password) throw new Refused(`${where(url)} has a user name or password in the URL ${at}`);
  if (url.hostname.endsWith('.')) throw new Refused(`${where(url)} ends with a dot ${at}`);
  const origin = originOf(url);
  for (const name of held) {
    const list = lists.get(name);
    if (!list) throw new Refused(`${name} may not go to ${where(url)} ${at}: hosts.json lists no host for it`);
    if (!list.has(origin)) throw new Refused(`${name} may not go to ${where(url)} ${at}`);
  }
  const listed = [...lists.values()].some((list) => list.has(origin));
  if (isIP(bare(url.hostname)) && !listed) throw new Refused(`${where(url)} is an IP address that hosts.json does not list ${at}`);
  if (namesLocal(url.hostname) && !listed) throw new Refused(`${where(url)} names this machine or a private network ${at}`);
  return listed;
}

// Async part: every address the host resolves to. Returns the addresses to connect to.
async function checkAddresses(url, listed, hop, lookup, ownList) {
  const at = `(hop ${hop})`;
  const host = bare(url.hostname);
  let list;
  try {
    list = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  } catch (e) {
    throw new Error(`cannot resolve ${host}: ${e.code ?? e.message}`);
  }
  if (!list.length) throw new Error(`cannot resolve ${host}: no address`);
  for (const { address } of list) {
    const shown = address === host ? where(url) : `${where(url)} resolves to ${address},`;
    if (never(address)) throw new Refused(`${shown} a link-local or cloud metadata address ${at}`);
    if (listed) continue;
    const local = [address, carried(address)].some((ip) => ip && onOwnNet(ip, ownList()));
    const why = notPublic(address) ?? (local ? "an address on this machine's own network" : null);
    if (why) throw new Refused(`${shown} ${why}, and hosts.json does not list it ${at}`);
  }
  return list;
}

// A lookup for the connection that answers only with the addresses checked, so the request goes where
// the check looked even if the name now resolves elsewhere.
function pinned(list) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') [options, callback] = [{}, options];
    const family = typeof options === 'number' ? options : options?.family;
    const fit = list.filter((a) => a.family === family);
    const use = fit.length ? fit : list;
    if (options?.all) callback(null, use);
    else callback(null, use[0].address, use[0].family);
  };
}

// ---------------------------------------------------------------------------------------------------
// One hop on the wire: no redirect followed, at most MAX_BYTES of body read.

function once(url, { method, headers, body, strictTls }, addresses, timeoutMs, signal) {
  return new Promise((done, fail) => {
    const client = url.protocol === 'https:' ? https : http;
    let res = null;
    let req = null;
    let timer = null;
    const onAbort = () => stop(new Error('stopped'));
    const stop = (e) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      req?.destroy();
      res?.destroy();
      fail(e);
    };
    const onResponse = (r) => {
      res = r;
      const head = { status: r.statusCode, headers: r.headers };
      if (REDIRECTS.has(r.statusCode) && r.headers.location) {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        r.destroy();
        done({ ...head, body: Buffer.alloc(0) });
        return;
      }
      const coding = String(r.headers['content-encoding'] ?? '').trim().toLowerCase();
      const unzip = { gzip: zlib.createGunzip, deflate: zlib.createInflate, br: zlib.createBrotliDecompress }[coding];
      const stream = unzip ? r.pipe(unzip()) : r;
      const chunks = [];
      let size = 0;
      stream.on('data', (c) => {
        size += c.length;
        if (size > MAX_BYTES) stop(new Error(`the response is larger than ${MAX_MB} MB, so it was not read`));
        else chunks.push(c);
      });
      stream.on('end', () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        done({ ...head, body: Buffer.concat(chunks) });
      });
      stream.on('error', (e) => stop(e));
    };
    if (signal?.aborted) return stop(new Error('stopped'));
    try {
      const tls = strictTls && url.protocol === 'https:' ? { rejectUnauthorized: true } : {};
      req = client.request(url, { method, headers, agent: false, lookup: pinned(addresses), ...tls }, onResponse);
    } catch (e) {
      // A header value Node will not send, such as one with a line break in it.
      return stop(new Error(e.code === 'ERR_INVALID_CHAR' ? 'a header value holds a character HTTP does not allow' : e.message));
    }
    timer = setTimeout(() => stop(new Error(`no answer within ${timeoutMs / 1000} seconds`)), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    req.on('error', (e) => stop(e));
    req.end(body);
  });
}

// ---------------------------------------------------------------------------------------------------
// send: the one way a secret leaves this machine.
//
// request: { method = 'GET', url, headers = {}, body } with {{NAME}} where a secret goes.
// options: { hosts (hosts.json as an object, or the Map from hostLists), vars (names and values; default
//   the environment), lookup, timeoutMs, signal }.
// Returns { status, headers, body, url, hops } with every secret value shown as {{NAME}}.
// Throws a Refused (its message is the one line to print) or an Error, both free of secret values.
// A Refused after a redirect names the answer before it, "(hop 2; hop 1 answered 307)", and has sent: true.
export async function send(request, options = {}) {
  const lists = options.hosts instanceof Map ? options.hosts : hostLists(options.hosts ?? {});
  const env = options.vars ?? process.env;
  const lookup = options.lookup ?? dnsLookup;
  const ownList = options.ownNets ?? ownNets;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const method = String(request.method ?? 'GET').toUpperCase();
  const headers = request.headers ?? {};
  const rawUrl = String(request.url ?? '');

  // Which secrets the request holds, and their values.
  const held = new Set([...refsIn(rawUrl), ...Object.values(headers).flatMap(refsIn), ...refsIn(request.body)]);
  const values = {};
  for (const name of held) {
    const v = env[name];
    if (typeof v !== 'string' || v === '') throw new Refused(`${name} has no value: put it in vars.json or the environment`);
    values[name] = v;
  }
  const listed = listedValues(env, lists);
  const hide = hider({ ...values, ...listed });
  const value = (name) => values[name];
  // Each hop that answered. A refusal after one names the answer before it: what was sent there arrived.
  const hops = [];

  try {
    const short = tooShort({ ...values, ...listed }, new Set([...lists.keys(), ...held]));
    if (short) throw new Refused(`${short} is too short to be a secret (under ${MIN_SECRET} characters)`);
    // A value written out, not named: the check below would not know it is a secret, so it is refused.
    if (request.body != null && typeof request.body !== 'string') throw new Refused('the body must be text');
    const raw = [rawUrl, ...Object.keys(headers), ...Object.values(headers).map(String), request.body == null ? '' : String(request.body)];
    for (const [name, v] of Object.entries(listed)) {
      for (const form of formsOf(v)) if (raw.some((t) => t.includes(form))) throw new Refused(`a secret value is written out; use {{${name}}}`);
    }
    if (held.size && process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
      throw new Refused('NODE_TLS_REJECT_UNAUTHORIZED=0 turns certificate checks off, so no secret is sent');
    }
    for (const name of Object.keys(headers)) {
      if (refsIn(name).length) throw new Refused(`a secret may not be in a header name`);
      if (/^(host|:authority)$/i.test(name)) throw new Refused(`the request sets its own ${name} header`);
    }
    if (!/^[A-Z]+$/.test(method)) throw new Refused(`${JSON.stringify(method)} is not an HTTP method`);
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Refused(`not a URL: ${rawUrl}`);
    }
    if (/\{\{|%7b%7b/i.test(`${url.username}:${url.password}@${url.host}`)) throw new Refused(`a secret may not be in the host, port, user name or password`);
    checkHop(url, held, lists, 1);
    // Fill the URL, then make sure the filled URL still goes where the check looked.
    const filled = new URL(fill(rawUrl, value, true));
    if (originOf(filled) !== originOf(url) || filled.username || filled.password) throw new Refused(`a secret changed where the request goes`);

    let body = request.body === undefined || request.body === null ? undefined : Buffer.from(fill(request.body, value, false));
    let sendMethod = method;
    const sendHeaders = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, fill(v, value, false)]));
    if (!Object.keys(sendHeaders).some((k) => /^accept-encoding$/i.test(k))) sendHeaders['accept-encoding'] = 'identity';
    let current = filled;
    for (let hop = 1; ; hop++) {
      if (hop > 1) {
        checkHop(current, held, lists, hop);
      }
      const onList = [...lists.values()].some((list) => list.has(originOf(current)));
      const addresses = await checkAddresses(current, onList, hop, lookup, ownList);
      const h = { ...sendHeaders };
      if (body !== undefined) h['content-length'] = String(body.length);
      const res = await once(current, { method: sendMethod, headers: h, body, strictTls: held.size > 0 }, addresses, timeoutMs, options.signal);
      hops.push({ hop, url: hide(current.href), status: res.status });
      if (!(REDIRECTS.has(res.status) && res.headers.location)) {
        return {
          status: res.status,
          headers: JSON.parse(hide(JSON.stringify(res.headers))),
          body: hide(res.body.toString('utf8')),
          url: hide(current.href),
          hops,
        };
      }
      if (hop > MAX_REDIRECTS) throw new Refused(`more than ${MAX_REDIRECTS} redirects (hop ${hop + 1})`);
      let next;
      try {
        next = new URL(res.headers.location, current);
      } catch {
        throw new Error(`hop ${hop + 1}: the redirect is not a URL`);
      }
      // A 303, and a 301 or 302 after a POST, go on as GET with no body, as browsers do.
      if (res.status === 303 ? sendMethod !== 'HEAD' : (res.status === 301 || res.status === 302) && sendMethod === 'POST') {
        sendMethod = 'GET';
        body = undefined;
        for (const k of Object.keys(sendHeaders)) if (/^content-(type|length)$/i.test(k)) delete sendHeaders[k];
      }
      current = next;
    }
  } catch (e) {
    if (e instanceof Refused) {
      const last = hops.at(-1);
      if (last) e.message = e.message.replace(/\(hop (\d+)\)/, (_, n) => `(hop ${n}; hop ${last.hop} answered ${last.status})`);
      e.message = hide(e.message);
      // sent: an earlier hop got the request, so the server may have acted on it.
      e.sent = hops.length > 0;
      throw e;
    }
    throw new Error(hide(e?.message ?? String(e)));
  }
}

// ---------------------------------------------------------------------------------------------------
// Files.

export function readJson(path, what) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    throw new Error(`${what}: cannot read ${path} (${e.code ?? e.message})`);
  }
  try {
    return JSON.parse(text.replace(/^\u{feff}/u, ''));
  } catch {
    throw new Error(`${what}: ${path} is not JSON`);
  }
}

// vars.json: an object of names and string values. Its values never reach the output.
export function readVars(path) {
  const vars = readJson(path, 'vars');
  if (!vars || typeof vars !== 'object' || Array.isArray(vars)) throw new Error('vars: not an object of names and values');
  for (const [k, v] of Object.entries(vars)) if (typeof v !== 'string') throw new Error(`vars: ${k} is not a string`);
  return vars;
}

// Text from a server, as it may be printed: control and invisible characters that can steer a terminal
// or a reader show as \u{…}; line breaks and tabs stay.
const STEERING = /[\p{C}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/gu;
export const shown = (s) => String(s).replace(STEERING, (c) => (c === '\n' || c === '\t' ? c : `\\u{${c.codePointAt(0).toString(16)}}`));

// ---------------------------------------------------------------------------------------------------
// The command line.

const USAGE = "usage: node egress.mjs --hosts hosts.json [--vars vars.json] <METHOD> <url> [--header 'name: value']... [--body file]";

async function main(argv) {
  if (argv[0] === '--self-test') {
    if (argv.length > 1) return usage('--self-test takes no other argument');
    const { selfTest } = await import(pathToFileURL(fileURLToPath(new URL('./egress.selftest.mjs', import.meta.url))).href);
    await selfTest();
    console.log('self-test ok');
    return 0;
  }
  let hostsPath = null;
  let varsPath = null;
  let bodyPath = null;
  const headers = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--hosts') hostsPath = next();
    else if (a === '--vars') varsPath = next();
    else if (a === '--body') bodyPath = next();
    else if (a === '--header') {
      const h = next();
      const at = h.indexOf(':');
      if (at < 1) return usage(`--header ${JSON.stringify(h)} is not 'name: value'`);
      headers[h.slice(0, at).trim()] = h.slice(at + 1).trim();
    } else if (a.startsWith('--')) return usage(`unknown flag ${a}`);
    else rest.push(a);
  }
  if (!hostsPath) return usage('--hosts is required: the file that lists each secret and its hosts');
  if (rest.length !== 2) return usage('give a method and a URL');
  const [method, url] = rest;
  const hosts = hostLists(readJson(hostsPath, 'hosts'));
  const vars = varsPath ? readVars(varsPath) : process.env;
  let body;
  if (bodyPath) {
    try {
      body = readFileSync(bodyPath, 'utf8');
    } catch (e) {
      throw new Error(`--body: cannot read ${bodyPath} (${e.code ?? e.message})`);
    }
  }
  try {
    const res = await send({ method, url, headers, body }, { hosts, vars });
    console.log(`HTTP ${res.status} · ${shown(res.url)} · ${res.hops.length} hop${res.hops.length === 1 ? '' : 's'}`);
    process.stdout.write(shown(res.body));
    if (res.body && !res.body.endsWith('\n')) process.stdout.write('\n');
    return 0;
  } catch (e) {
    console.error(shown(e.message));
    return e.refused ? 3 : 1;
  }
}

function usage(message) {
  console.error(`${message}\n${USAGE}`);
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e) => {
      console.error(shown(e?.message ?? String(e)));
      process.exitCode = 2;
    },
  );
}
