// Looks for Rook's clues (04:04, authorless fixes, time oddities) in the S01E03 kb export.
// Usage: node clues.mjs <support-kb root>
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
const raw = JSON.parse(fs.readFileSync(path.join(root, 'src/lib/data/reports-4471.json'), 'utf8'));
const byId = new Map(raw.map((r) => [r.id, r]));
const reports = [...byId.values()];
const hm = (iso) => iso.slice(11, 16);

console.log('== times at 04:04 or 04:xx (receivedAt / mergedAt)');
for (const r of reports) {
  for (const k of ['receivedAt', 'mergedAt']) if (r[k] && hm(r[k]).startsWith('04')) console.log(r.id, k, r[k], r.tenant);
}

console.log('== merged before received');
for (const r of reports) if (r.mergedAt && Date.parse(r.mergedAt) < Date.parse(r.receivedAt)) console.log(r.id, r.receivedAt, r.mergedAt);

console.log('== mergedAt by day');
const days = {};
for (const r of reports) days[r.mergedAt.slice(0, 10)] = (days[r.mergedAt.slice(0, 10)] ?? 0) + 1;
console.log(days);

console.log('== mergedAt hours');
const hours = {};
for (const r of reports) hours[hm(r.mergedAt).slice(0, 2)] = (hours[hm(r.mergedAt).slice(0, 2)] ?? 0) + 1;
console.log(hours);

console.log('== receivedAt offsets (DST check)');
const off = {};
for (const r of reports) { const k = `${r.receivedAt.slice(19)} ${r.receivedAt.slice(5, 7)}`; off[k] = (off[k] ?? 0) + 1; }
console.log(off);

console.log('== duplicate rows (export overlap)');
const seen = new Map();
for (const r of raw) seen.set(r.id, (seen.get(r.id) ?? 0) + 1);
console.log([...seen].filter(([, n]) => n > 1).map(([id]) => `${id} ${byId.get(id).receivedAt.slice(0, 10)} ${byId.get(id).tenant}`).join('\n'));

console.log('== id gaps');
const nums = reports.map((r) => Number(r.id.slice(2))).sort((a, b) => a - b);
const gaps = [];
for (let n = nums[0]; n <= nums.at(-1); n++) if (!nums.includes(n)) gaps.push(n);
console.log(gaps.length, gaps.join(' '));

console.log('== one-day moves, full');
for (const id of JSON.parse(fs.readFileSync(path.join(root, 'src/lib/data/desk-notes.json'), 'utf8')).oneDayMove) {
  const r = byId.get(id);
  console.log(id, r.receivedAt, r.mergedAt, r.tenant, r.channel, r.meta.browserLocale, '::', r.body);
}
