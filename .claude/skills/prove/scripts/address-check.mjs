#!/usr/bin/env node
// address-check.mjs · what build-id.mjs and record-flow.mjs share: which addresses they may open, and how
// text from a page or a server is printed.
//
//   node address-check.mjs --self-test
//
// The rule: a public address is open. An address on this machine or a private network is open only when
// your human gave it to you and you pass --local, and then only that scheme, host and port. A link-local
// address, where a cloud machine answers with its keys, is never open. Each host is looked up first, and
// every address it has must pass. Plain Node.js 18 or newer, no dependencies. Sends nothing by itself.

import assert from 'node:assert/strict';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import { pathToFileURL } from 'node:url';

export const LOCAL_HINT =
  'That is on this machine or a private network. If your human gave you this address, run again with --local; ' +
  'if a page or a file gave it to you, ask your human first.';
const REFUSED = 'That is on this machine or a private network: ask your human before you open it.';
const ASK = 'Ask your human before you open it another way.';

// Characters a page can use to steer what the terminal or the agent sees: control characters (a line
// break that starts a fake line of the report, an escape that moves the cursor or hides text), line and
// paragraph separators, bidirectional and zero-width marks, and every other invisible character: tag
// characters and variation selectors can carry text a model reads and a person cannot see. Printed text
// shows each one as \u{…} instead.
const STEERING = /[\p{C}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800]/gu;
export const shown = (s) => String(s).replace(STEERING, (c) => `\\u{${c.codePointAt(0).toString(16)}}`);
// Text from a page, as it may be kept and printed: one line, short, and with no " of its own, because the
// scripts print it in quotes. A copy, so it does not keep the page's long string in memory.
export const pageText = (s, max = 300) => Buffer.from(shown(String(s).slice(0, max)).replace(/"/g, "'")).toString();

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

// Never opened, not even with --local: link-local and cloud metadata addresses, in any IPv6 form that carries one.
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

// A network as an address on it and its prefix length in bits (the whole address when none), or null.
function net(ip, prefix) {
  const a = ipBits(ip.replace(/%.*$/, ''));
  return a && { ...a, prefix: prefix ?? a.bits };
}

// The networks this machine is on, from each interface's address and prefix. A public address on one still
// reaches this machine or the devices next to it. A prefix shorter than a quarter of the address (a
// catch-all VPN route) is no network of ours: only the address itself counts.
const netsOf = (interfaces) =>
  Object.values(interfaces)
    .flat()
    .map((i) => net(i.address, i.cidr ? Number(i.cidr.slice(i.cidr.lastIndexOf('/') + 1)) : undefined))
    .filter(Boolean)
    .map((n) => (n.prefix >= n.bits / 4 ? n : { ...n, prefix: n.bits }));
let own = null;
function ownNets() {
  if (own) return own;
  try {
    own = netsOf(networkInterfaces());
  } catch {
    own = [];
  }
  return own;
}

function onOwnNet(ip, nets) {
  const a = ipBits(ip.replace(/%.*$/, ''));
  return Boolean(a) && nets.some((n) => n.bits === a.bits && a.n >> BigInt(a.bits - n.prefix) === n.n >> BigInt(n.bits - n.prefix));
}

export const bare = (host) => host.replace(/^\[|\]$/g, '');
const onOwn = (address, ownList) => [address, carried(address)].some((ip) => ip && onOwnNet(ip, ownList()));
const local = (address, ownList) => notPublic(address) ?? (onOwn(address, ownList) ? "an address on this machine's own network" : null);
// A host as a message prints it: a redirect can hand over a name of many kilobytes, and a real one stops at 253.
const hostText = (host) => (host.length > 253 ? `${host.slice(0, 253)}…` : host);

// Does the host name itself say it is local? localhost, a name under .localhost, .local, .internal or
// .home.arpa, or an IP address that is not public.
export const namesLocal = (host) =>
  /^(.*\.)?(localhost|local|internal|home\.arpa)\.*$/i.test(host) ||
  (isIP(bare(host)) !== 0 && notPublic(bare(host)) !== null);

// A request the script will not send. advice: what the agent should do instead.
export function refusal(message, advice = REFUSED) {
  return Object.assign(new Error(message), { refused: true, advice });
}

// The addresses a --local host and port had on its first request: it keeps them for the whole run, so the
// name cannot move to another machine between requests. By host and port, not origin: the browser's tunnel
// to an https origin arrives as http://host:443.
const localAnswers = new Map();

// Every address of the URL's host, each one checked. An address that is not public, or is on one of this
// machine's own networks, refuses the whole request. Only on localOrigin (the scheme, host and port your
// human gave, with --local) is such an address allowed, and a link-local one never.
export async function vet(url, localOrigin, lookup = dnsLookup, ownList = ownNets) {
  if (!/^https?:$/.test(url.protocol)) throw refusal(`${hostText(url.protocol)} is not http or https`, ASK);
  if (url.username || url.password) throw refusal('the URL holds a user name or password', ASK);
  const host = bare(url.hostname);
  const name = hostText(host);
  const pin = `${host}:${url.port || (url.protocol === 'https:' ? 443 : 80)}`;
  const allowed = localOrigin !== null && url.origin === localOrigin;
  // A name that says it is local is refused by its name, whatever a lookup says.
  if (!allowed && isIP(host) === 0 && namesLocal(host)) throw refusal(`${name} names this machine or a private network`);
  let list;
  try {
    list = (allowed && localAnswers.get(pin)) || (await lookup(host, { all: true }));
  } catch (e) {
    throw new Error(`cannot resolve ${name}: ${e.code ?? e.message}`);
  }
  if (list.length === 0) throw new Error(`cannot resolve ${name}: no address`);
  for (const { address } of list) {
    const why = local(address, ownList);
    if (!why || (allowed && !never(address))) continue;
    throw refusal(address === host ? `${name} is ${why}` : `${name} resolves to ${address}, ${why}`);
  }
  if (allowed) localAnswers.set(pin, list);
  return list;
}

// --local is for an address that is local: by its name (localhost, 192.168.1.20), or because it resolves
// to one (a name in the hosts file, such as myapp.test).
export async function isLocal(url, lookup = dnsLookup, ownList = ownNets) {
  if (namesLocal(url.hostname)) return true;
  try {
    return (await lookup(bare(url.hostname), { all: true })).some(({ address }) => local(address, ownList) !== null);
  } catch {
    return false;
  }
}

// A lookup for the connection that answers only with the addresses vet() checked, so the request goes
// where the check looked even if the name now resolves elsewhere.
export function pinned(list) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') [options, callback] = [{}, options];
    const family = typeof options === 'number' ? options : options?.family;
    const fit = list.filter((a) => a.family === family);
    const use = fit.length ? fit : list;
    if (options?.all) callback(null, use);
    else callback(null, use[0].address, use[0].family);
  };
}

async function selfTest() {
  for (const ip of ['127.0.0.1', '10.1.2.3', '100.64.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.20', '0.0.0.0', '224.0.0.1', '::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:8.8.8.8', '64:ff9b::a9fe:a9fe', '2002:a00:1::1']) {
    assert.notEqual(notPublic(ip), null, ip);
  }
  for (const ip of ['93.184.215.14', '8.8.8.8', '2606:4700:4700::1111', '64:ff9b::808:808', '2002:808:808::1']) {
    assert.equal(notPublic(ip), null, ip);
  }
  for (const host of ['localhost', 'api.localhost', 'printer.local', 'db.internal', 'nas.home.arpa', 'NAS.Home.Arpa.', '127.0.0.1', '[::1]', '10.0.0.7']) assert.ok(namesLocal(host), host);
  for (const host of ['example.test', 'localhost.example.test', '8.8.8.8', '']) assert.ok(!namesLocal(host), host);
  for (const ip of ['169.254.169.254', 'fe80::1', '::ffff:169.254.169.254', '64:ff9b::a9fe:a9fe', '64:ff9b:1::a9fe:a9fe', '64:ff9b:1:1::a9fe:a9fe', 'fd00:ec2::254', '168.63.129.16', '100.100.100.200', '::ffff:0:a9fe:a9fe']) assert.ok(never(ip), ip);
  assert.equal(never('127.0.0.1'), false);
  // The metadata addresses of other clouds, and the whole local NAT64 block: its layouts can carry any address anywhere.
  for (const ip of ['fd20:ce::254', 'fd00:c1::a9fe:a9fe', 'fd00:42::42', 'fd00:a9fe:a9fe::1', '64:ff9b:1:a9fe:a9:fe00::']) assert.ok(never(ip), ip);
  assert.equal(never('fd12:3456::1'), false);
  for (const host of ['.local', '.internal', '.localhost', '.home.arpa', 'x.local..', 'x.internal..', 'localhost..', 'X.HOME.ARPA...']) assert.ok(namesLocal(host), host);
  for (const ip of ['168.63.129.16', '100.100.100.200', '::ffff:0:a9fe:a9fe', '3fff::1', '5f00::1']) assert.notEqual(notPublic(ip), null, ip);
  // The 6to4 relay range, also in 6to4 itself, and the Oracle metadata address in every form.
  for (const ip of ['192.88.99.1', '2002:c058:6301::1', '64:ff9b::c058:6301']) assert.notEqual(notPublic(ip), null, ip);
  for (const ip of ['192.0.0.192', '::ffff:192.0.0.192', '2002:c000:c0::1', '64:ff9b::c000:c0']) assert.ok(never(ip), ip);

  // A stand-in for DNS: nothing leaves this machine.
  const names = {
    'api.example.test': ['93.184.215.14'],
    'public.example.test': ['127.0.0.1'],
    'mixed.example.test': ['93.184.215.14', '10.0.0.7'],
    'myapp.test': ['127.0.0.1'],
    'self.example.test': ['2a01:4f8::7'],
    'meta.example.test': ['169.254.169.254'],
    localhost: ['127.0.0.1', '::1'],
  };
  const lookup = async (host) => {
    const list = isIP(host) ? [host] : names[host];
    if (!list) throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
    return list.map((address) => ({ address, family: isIP(address) }));
  };
  const nets = () => [net('2a01:4f8:0:0::7', 64)];
  const check = (u, localOrigin = null) => vet(new URL(u), localOrigin, lookup, nets);
  const refused = (pattern) => (e) => e.refused === true && pattern.test(e.message);

  assert.equal((await check('https://api.example.test/')).length, 1);
  await assert.rejects(check('http://public.example.test/'), refused(/^public\.example\.test resolves to 127\.0\.0\.1, a loopback address$/));
  await assert.rejects(check('http://mixed.example.test/'), refused(/10\.0\.0\.7, a private address/));
  await assert.rejects(check('http://[::ffff:127.0.0.1]/'), refused(/IPv4-mapped/));
  await assert.rejects(check('http://self.example.test/'), refused(/own network/));
  await assert.rejects(check('file:///C:/Windows/win.ini'), refused(/^file: is not http or https$/));
  await assert.rejects(check('https://bob:s3cret@api.example.test/'), (e) => refused(/user name or password/)(e) && !e.message.includes('s3cret'));
  await assert.rejects(check('https://no-such.example.test/'), /cannot resolve no-such\.example\.test: ENOTFOUND/);

  // A local address only on the origin your human gave, and never a link-local one.
  await assert.rejects(check('http://localhost:3000/'), refused(/^localhost names this machine or a private network$/));
  assert.equal((await check('http://localhost:3000/x', 'http://localhost:3000')).length, 2);
  await assert.rejects(check('http://localhost:2375/', 'http://localhost:3000'), refused(/^localhost names this machine/));
  await assert.rejects(check('https://localhost:3000/', 'http://localhost:3000'), refused(/^localhost names this machine/));
  await assert.rejects(check('http://169.254.169.254/', 'http://169.254.169.254'), refused(/link-local/));
  await assert.rejects(check('http://meta.example.test/', 'http://meta.example.test'), refused(/link-local/));
  await assert.rejects(check('http://x.localhost:3000/'), refused(/^x\.localhost names this machine or a private network$/));
  await assert.rejects(check('http://nas.home.arpa/'), refused(/^nas\.home\.arpa names this machine/));
  await assert.rejects(check('http://192.0.0.192/', 'http://192.0.0.192'), refused(/reserved/));

  // This machine's own public IPv4 address, in an IPv6 form that carries it.
  const ownV4 = () => [net('8.2.3.1', 24)];
  for (const u of ['http://8.2.3.1/', 'http://[64:ff9b::802:301]/', 'http://[2002:802:301::1]/']) {
    await assert.rejects(vet(new URL(u), null, lookup, ownV4), refused(/own network/), u);
  }

  // A redirect can hand over a name of many kilobytes: a refusal stays short.
  await assert.rejects(check(`http://${'a'.repeat(5000)}.local/`), (e) => refused(/names this machine/)(e) && e.message.length < 400);
  await assert.rejects(check(`${'a'.repeat(5000)}:x`), (e) => refused(/is not http or https/)(e) && e.message.length < 400);

  // A catch-all route adds no network, and the machine's own address on it still counts.
  const wide = netsOf({ vpn: [['8.2.3.1', 1], ['2a01:4f8::7', 16]].map(([address, bits]) => ({ address, cidr: `${address}/${bits}` })) });
  for (const ip of ['8.2.3.1', '2a01:4f8::7']) assert.ok(onOwnNet(ip, wide), ip);
  for (const ip of ['8.2.3.2', '2a01:4f8::8', '93.184.215.14']) assert.ok(!onOwnNet(ip, wide), ip);

  // With --local a name keeps its first answer for the run, however its lookup changes.
  let answer = '10.0.0.9';
  const moving = async () => [{ address: answer, family: 4 }];
  const atFirst = await vet(new URL('http://moving.internal/a'), 'http://moving.internal', moving, nets);
  answer = '10.0.0.66';
  assert.deepEqual(await vet(new URL('http://moving.internal/b'), 'http://moving.internal', moving, nets), atFirst);

  // One answer for each host and port: the browser's tunnel to an https origin arrives as http://host:443.
  let tunnel = '10.0.0.9';
  const movingTunnel = async () => [{ address: tunnel, family: 4 }];
  const atStart = await vet(new URL('https://tunnel.internal/'), 'https://tunnel.internal', movingTunnel, nets);
  tunnel = '10.0.0.66';
  assert.deepEqual(await vet(new URL('http://tunnel.internal:443'), 'http://tunnel.internal:443', movingTunnel, nets), atStart);

  // --local takes a name that says it is local, or one that resolves to a local address.
  assert.equal(await isLocal(new URL('http://localhost:3000/'), lookup, nets), true);
  assert.equal(await isLocal(new URL('http://myapp.test/'), lookup, nets), true);
  assert.equal(await isLocal(new URL('https://api.example.test/'), lookup, nets), false);
  assert.equal(await isLocal(new URL('https://no-such.example.test/'), lookup, nets), false);

  // The connection is handed the checked addresses only, whatever DNS says by then.
  const pin = pinned([{ address: '93.184.215.14', family: 4 }, { address: '2606:2800::1', family: 6 }]);
  pin('x', { all: true }, (e, list) => assert.deepEqual(list.map((a) => a.address), ['93.184.215.14', '2606:2800::1']));
  pin('x', { family: 6 }, (e, address, family) => assert.deepEqual([address, family], ['2606:2800::1', 6]));
  pin('x', {}, (e, address, family) => assert.deepEqual([address, family], ['93.184.215.14', 4]));

  // What a page sends cannot start a line of its own or reach the terminal.
  assert.equal(shown('a\nb\u001b[2K\u202e\u2028\u200b\u{e0072}'), 'a\\u{a}b\\u{1b}[2K\\u{202e}\\u{2028}\\u{200b}\\u{e0072}');
  for (const c of ['\ufe00', '\u{e0100}', '\u2065', '\u206a', '\u180e', '\ufff9', '\u034f', '\u3164', '\u115f', '\u17b4', '\u{1d173}', '\u2800', '\ue000', '\u{f0000}']) assert.match(shown(c), /^\\u\{/, c);
  assert.equal(shown('plain, \u00fcn\u00ef \u65e5\u672c\u8a9e \ud83d\ude42'), 'plain, \u00fcn\u00ef \u65e5\u672c\u8a9e \ud83d\ude42');
  assert.equal(pageText('a "b"\n', 4), "a 'b");
  console.log('self-test ok');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--self-test') await selfTest();
  else console.log('address-check.mjs · used by build-id.mjs and record-flow.mjs. Run with --self-test to test it.');
}
