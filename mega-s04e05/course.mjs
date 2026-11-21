// course.mjs · one call to the S04E05 course API, appended to course.jsonl the moment the reply arrives (ADR 0014).
//   node course.mjs GET <path> [VAR]            Bearer = the Host Desk vars value VAR (TICKET, ATTEMPT, …)
//   node course.mjs POST <path> <body.json> [VAR]
// <path> is relative to https://hq.mega.dev/challenges/make-me-another/ ("api", "manual", "settings", …), or a full https URL
// on hq.mega.dev. No redirect is followed. Prints the reply with every vars value masked.
import { appendFileSync, readFileSync } from 'node:fs';

const BASE = 'https://hq.mega.dev/challenges/make-me-another/';
const VARS = new URL('../mega-s04e01/starter/host-desk/vars.json', import.meta.url);
const vars = JSON.parse(readFileSync(VARS, 'utf8'));
const [method, path, a, b] = process.argv.slice(2);
const bodyFile = method === 'POST' ? a : undefined;
const varName = method === 'POST' ? b : a;
const url = new URL(path, BASE);
if (url.host !== 'hq.mega.dev' || url.protocol !== 'https:') throw new Error('hq.mega.dev over https only');
const headers = {};
if (varName) {
  if (!vars[varName]) throw new Error(`no ${varName} in vars.json`);
  headers.authorization = `Bearer ${vars[varName]}`;
}
let body;
if (bodyFile) {
  body = readFileSync(bodyFile, 'utf8');
  JSON.parse(body);
  headers['content-type'] = 'application/json';
}
const res = await fetch(url, { method, headers, body, redirect: 'manual' });
const text = await res.text();
appendFileSync(new URL('./course.jsonl', import.meta.url), JSON.stringify({ at: new Date().toISOString(), method, path, auth: varName ?? null, status: res.status, location: res.headers.get('location'), body: text }) + '\n');
const mask = (s) => Object.entries(vars).reduce((t, [k, v]) => (typeof v === 'string' && v.length > 8 ? t.split(v).join(`{{${k}}}`) : t), s);
let shown = text;
try {
  shown = JSON.stringify(JSON.parse(text), null, 2);
} catch {}
console.log(res.status, res.headers.get('location') ?? '');
console.log(mask(shown));
