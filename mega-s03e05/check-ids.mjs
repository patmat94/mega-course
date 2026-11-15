// Check a claim draft against the pack: every cited signal id exists, verbs and who are valid,
// and list file-level signals that no group cites. Usage: node check-ids.mjs step1-draft.json
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename, extname } from 'node:path';

const pack = new URL('./pack/', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const draft = JSON.parse(readFileSync(process.argv[2], 'utf8').replace(/^﻿/, ''));
const ids = new Set();
const fileIds = new Set();
const walk = d => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else { const id = basename(e.name, extname(e.name)).replace(/-(feed|page)$/, ''); if (/^(m|call|replay|snap)-\d+$/.test(id)) { ids.add(id); fileIds.add(id); } if (e.name.endsWith('.csv')) for (const l of readFileSync(p, 'utf8').trim().split(/\r?\n/).slice(1)) ids.add(l.split(',')[0]); if (e.name.endsWith('.json') && e.name.startsWith('snap')) for (const i of JSON.parse(readFileSync(p, 'utf8')).incidents) ids.add(i.id); } } };
walk(join(pack, process.argv[3] === 'batch2' ? '../batch2/signals' : 'signals'));
const verbs = ['expand', 'revise', 'simplify', 'revert', 'investigate', 'stop'];
let bad = 0;
const cited = new Set();
for (const g of draft.groups) {
  if (!verbs.includes(g.verb)) { bad++; console.log('BAD verb', g.name, g.verb); }
  if (!['agent', 'owner'].includes(g.who)) { bad++; console.log('BAD who', g.name, g.who); }
  if (!Array.isArray(g.signals) || !g.signals.length) { bad++; console.log('NO signals', g.name); }
  for (const s of g.signals) { if (!ids.has(s)) { bad++; console.log('UNKNOWN id', s, 'in', g.name); } if (cited.has(s)) console.log('cited twice', s); cited.add(s); }
}
if (typeof draft.step !== 'number') { bad++; console.log('step must be a number'); }
console.log('known ids', ids.size, '| groups', draft.groups.length, '| cited', cited.size);
console.log('file-level signals not cited:', [...fileIds].filter(i => !cited.has(i)).join(', ') || 'none');
console.log(bad ? `FAIL ${bad}` : 'OK');
process.exitCode = bad ? 1 : 0;
