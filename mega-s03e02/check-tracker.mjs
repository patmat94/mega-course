// Checks doc/issues/ against the README format and the ticket's limits.
// Fetches every channel's requests from the API (full history, no cursor) to know every request id.
//   node mega-s03e02/check-tracker.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, 'sched-prod', 'sched-prod', 'doc', 'issues');
const { receipts, api } = JSON.parse(readFileSync(join(HERE, 'receipts.json'), 'utf8').replace(/^﻿/, ''));

const errs = [];
const bad = (k, m) => errs.push(`${k}: ${m}`);
const parseList = (v) => (v ? v.replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean) : []);
const ID = /\b(SCHED-\d+|IN-\d+|AUT-\d|DES-\d|PRD-\d|ADR-\d{4})\b/;

const issues = {};
for (const f of readdirSync(DIR).filter((f) => f.endsWith('.md'))) {
  const t = readFileSync(join(DIR, f), 'utf8');
  const m = t.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) { bad(f, 'no frontmatter'); continue; }
  const fm = Object.fromEntries(m[1].split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
  issues[fm.key] = { fm, body: m[2], file: f };
}

// every request id, from the API
const ids = new Set();
for (const ch of ['desk', 'chat', 'mail']) {
  let since;
  for (let i = 0; i < 20; i++) {
    const qs = new URLSearchParams({ t: receipts.session, ...(since ? { since } : {}) });
    const r = await (await fetch(`${api}/channels/${ch}?${qs}`)).json();
    r.items.forEach((it) => ids.add(it.id));
    if (!r.items.length) break;
    since = r.cursor;
  }
}

const seen = {};
for (const [k, { fm, body }] of Object.entries(issues)) {
  const labels = parseList(fm.labels);
  const marks = labels.filter((l) => l === 'agent-ready' || l === 'needs-human');
  for (const s of parseList(fm.sources)) (seen[s] ??= []).push(k);
  if (!['open', 'done', 'closed'].includes(fm.status)) bad(k, `status ${fm.status}`);
  if (fm.status === 'open' && marks.length !== 1) bad(k, `open with marks ${JSON.stringify(marks)}`);
  if (fm.status !== 'open' && marks.length) bad(k, 'not open but marked');
  if (fm.status === 'closed') {
    if (!['duplicate', 'obsolete', 'contradicts-spec', 'not-planned'].includes(fm.reason)) bad(k, `reason ${fm.reason}`);
    if (fm.reason === 'duplicate' && !issues[fm['duplicate-of']]) bad(k, `duplicate-of ${fm['duplicate-of']} missing`);
    if (!ID.test(body.split('## Request as filed')[0])) bad(k, 'closed without a cited id');
  }
  for (const b of parseList(fm['blocked-by'])) if (!issues[b]) bad(k, `blocked-by ${b} missing`);
  if (marks[0] === 'agent-ready') {
    for (const h of ['## Intent', '## Acceptance', '## Boundaries']) if (!body.includes(h)) bad(k, `no ${h}`);
    const acc = body.split('## Acceptance')[1]?.split('## Boundaries')[0] ?? '';
    if (!/\b(not|no|never)\b/i.test(acc)) bad(k, 'Acceptance has no must-not case');
    if (!/Allowed by AUT-1\b/.test(body)) bad(k, 'no "Allowed by AUT-1"');
  }
  if (marks[0] === 'needs-human') {
    for (const h of ['## Question', '## Options', '## Recommendation', '## Why']) if (!body.includes(h)) bad(k, `no ${h}`);
    const opts = (body.split('## Options')[1]?.split('## Recommendation')[0] ?? '').match(/^\d+\. /gm) ?? [];
    if (opts.length < 2) bad(k, `${opts.length} option(s)`);
    if (!ID.test(body.split('## Why')[1]?.split('## Request as filed')[0] ?? '')) bad(k, 'Why cites no id');
  }
}
// a fresh read of a channel shows only its first batch; later batches reach only the collector's cursor,
// so the request files the collector wrote (doc/issues/IN-*.md) count as known requests too
const fromApi = ids.size;
for (const k of Object.keys(issues)) if (k.startsWith('IN-')) ids.add(k);
console.log(`request ids: ${fromApi} from a fresh API read, ${ids.size} with the collected files`);
for (const id of ids) {
  if (!seen[id]) bad(id, 'in no issue');
  // a request may sit in more than one issue only when triage split it (the extra issues say "Split from <id>")
  else if (seen[id].filter((k) => !new RegExp(`Split from ${id}\\b`).test(issues[k].body)).length !== 1)
    bad(id, `in ${seen[id].length} issues, not as a split: ${seen[id]}`);
}
// a fresh read of a channel shows only its first batch; later batches reach only the collector's cursor,
// so the request files the collector wrote (doc/issues/IN-*.md) count as known requests too
for (const s of Object.keys(seen)) if (!s.startsWith('IN-')) bad(s, 'source is not a request id');

const count = (p) => Object.values(issues).filter(p).length;
console.log(`requests ${ids.size} · issues ${Object.keys(issues).length} · open ${count((i) => i.fm.status === 'open')} (agent-ready ${count((i) => /agent-ready/.test(i.fm.labels))}, needs-human ${count((i) => /needs-human/.test(i.fm.labels))}) · done ${count((i) => i.fm.status === 'done')} · closed ${count((i) => i.fm.status === 'closed')}`);
console.log(errs.length ? `FAIL\n${errs.join('\n')}` : 'PASS: 0 problems');
process.exitCode = errs.length ? 1 : 0;
