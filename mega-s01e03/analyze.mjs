// Reproduces src/lib/kb/causes.ts over the export and prints facts for review.
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2];
const data = path.join(root, 'src/lib/data');
const raw = JSON.parse(fs.readFileSync(path.join(data, 'reports-4471.json'), 'utf8'));
const tenants = new Map(
  fs.readdirSync(path.join(data, 'tenants')).map((f) => {
    const t = JSON.parse(fs.readFileSync(path.join(data, 'tenants', f), 'utf8'));
    return [t.handle, t];
  }),
);
const notes = JSON.parse(fs.readFileSync(path.join(data, 'desk-notes.json'), 'utf8'));

function dayFirst(locale) {
  const order = new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(Date.UTC(2026, 0, 2, 12)))
    .map((p) => p.type);
  return order.indexOf('day') < order.indexOf('month');
}
const HINT = { 'booking-v2': 'DD/MM/YYYY', 'booking-v3': 'MM/DD/YYYY' };
function causeOf(r, t) {
  if (!t || !dayFirst(t.locale)) return null;
  return r.channel === 'form' && HINT[t.form].startsWith('MM') ? 'hint' : 'parser';
}

const count = (arr, f) => arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});

console.log('raw rows', raw.length);
const byId = new Map();
const dupIds = [];
for (const r of raw) {
  if (byId.has(r.id)) dupIds.push([r.id, JSON.stringify(byId.get(r.id)) === JSON.stringify(r)]);
  byId.set(r.id, r);
}
console.log('unique ids', byId.size, 'dup ids', dupIds.length, 'dups identical?', count(dupIds, (d) => d[1]));
const uniq = [...byId.values()];
console.log('mergedInto', count(uniq, (r) => r.mergedInto));
const m = uniq.filter((r) => r.mergedInto === 4471);
console.log('merged into 4471', m.length);
console.log('tenants', count(m, (r) => r.tenant));
console.log('channels', count(m, (r) => r.channel));
console.log('tenant locales dayFirst', [...tenants.values()].map((t) => `${t.handle}:${t.locale}:${t.form}:${dayFirst(t.locale)}`));
console.log('cause', count(m, (r) => causeOf(r, tenants.get(r.tenant)) ?? 'unplaced'));
console.log('intakeTag', count(m, (r) => r.meta.intakeTag));
console.log('cause x tag', count(m, (r) => `${causeOf(r, tenants.get(r.tenant)) ?? 'unplaced'} / ${r.meta.intakeTag}`));
console.log('browserLocale vs tenant locale mismatch', m.filter((r) => tenants.get(r.tenant) && tenants.get(r.tenant).locale !== r.meta.browserLocale).length);
console.log('oneDayMove notes', notes.oneDayMove.map((id) => { const r = byId.get(id); return r ? `${id} ${r.tenant} ${r.channel} ${causeOf(r, tenants.get(r.tenant))} :: ${r.body}` : `${id} MISSING`; }));
console.log('receivedAt range', m.map((r) => r.receivedAt).sort()[0], m.map((r) => r.receivedAt).sort().at(-1));
console.log('mergedAt null', m.filter((r) => !r.mergedAt).length);
console.log('keys', count(raw, (r) => Object.keys(r).join(',')));
fs.writeFileSync(process.argv[3], m.map((r) => [r.id, r.receivedAt.slice(0, 10), r.tenant, r.channel, causeOf(r, tenants.get(r.tenant)) ?? 'unplaced', r.meta.intakeTag, r.meta.browserLocale, r.subject, r.body].join(' | ')).join('\n'));
