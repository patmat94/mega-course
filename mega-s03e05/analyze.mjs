// Recompute release 0008's metric and guardrails from pack/signals/events.csv,
// exactly as the agreement defines them. Usage: node analyze.mjs [events.csv]
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? new URL('./pack/signals/events.csv', import.meta.url);
const [head, ...lines] = readFileSync(file, 'utf8').trim().split(/\r?\n/);
const cols = head.split(',');
const rows = lines.map(l => { const v = l.split(','); return Object.fromEntries(cols.map((c, i) => [c, v[i]])); });
console.log('rows', rows.length);

const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a, b) => (100 * a / b).toFixed(2) + '%';

// site-night buckets
const sn = new Map();
const inc = new Map();
for (const r of rows) {
  const k = `${r.site_id}|${r.night}`;
  if (!sn.has(k)) sn.set(k, { arm: r.arm, site: r.site_id, night: r.night, incidents: new Set(), restarts: 0 });
  const b = sn.get(k);
  if (b.arm !== r.arm) console.log('ARM MISMATCH in site-night', k);
  if (r.event === 'incident_opened') b.incidents.add(r.incident_id);
  if (r.event === 'restart') b.restarts++;
  if (!inc.has(r.incident_id)) inc.set(r.incident_id, { arm: r.arm, site: r.site_id, night: r.night, op: r.operator_id, source: null, ev: [] });
  const i = inc.get(r.incident_id);
  i.ev.push(r);
  if (r.event === 'incident_opened') { i.opened = Date.parse(r.ts); i.source = r.detail; }
  if (r.event === 'incident_resolved') i.resolved = Date.parse(r.ts);
  if (r.event === 'suggestion_shown') i.shown = r.detail;
  if (r.event === 'suggestion_accepted') i.accepted = true;
  if (r.event === 'suggestion_dismissed') i.dismissed = true;
  if (r.event === 'restart') i.restarts = (i.restarts ?? 0) + 1;
  if (r.event === 'incident_reopened') i.reopened = true;
}

function report(label, filterInc = () => true, filterSn = () => true) {
  console.log(`\n== ${label}`);
  for (const arm of ['control', 'flag']) {
    const bad = [...sn.values()].filter(b => b.arm === arm && b.incidents.size >= 3 && filterSn(b));
    const r = bad.reduce((s, b) => s + b.restarts, 0);
    const incs = [...inc.values()].filter(i => i.arm === arm && filterInc(i));
    const ttr = incs.filter(i => i.resolved && i.opened).map(i => (i.resolved - i.opened) / 60000);
    const reo = incs.filter(i => i.reopened).length;
    const shown = incs.filter(i => i.shown).length, acc = incs.filter(i => i.accepted).length;
    console.log(`${arm.padEnd(7)} badNights=${bad.length} restarts=${r} perBadNight=${(r / bad.length).toFixed(3)} | incidents=${incs.length} medianTTR=${median(ttr).toFixed(2)}min reopened=${reo} (${pct(reo, incs.length)}) | shown=${shown} accepted=${acc} (${pct(acc, shown)})`);
  }
}

report('agreement metric + guardrails (all)');

// by incident source
for (const src of ['calendar-sync', 'booking-worker', 'payments-hook', 'rota-feed', 'notify'])
  report(`source=${src}`, i => i.source === src, () => true);

// by week
report('week 1 (nights 10-15..10-21)', i => i.night <= '2026-10-21', b => b.night <= '2026-10-21');
report('week 2 (nights 10-22..)', i => i.night > '2026-10-21', b => b.night > '2026-10-21');

// by night
console.log('\n== per night restarts per bad night');
const nights = [...new Set(rows.map(r => r.night))].sort();
for (const n of nights) {
  const line = ['control', 'flag'].map(arm => {
    const bad = [...sn.values()].filter(b => b.arm === arm && b.night === n && b.incidents.size >= 3);
    const r = bad.reduce((s, b) => s + b.restarts, 0);
    return `${arm} ${bad.length} bn ${(r / (bad.length || 1)).toFixed(2)}`;
  }).join(' | ');
  console.log(n, line);
}

// accepted vs not, restarts per incident
console.log('\n== restarts per incident by accepted/dismissed');
for (const arm of ['control', 'flag']) for (const k of ['accepted', 'dismissed']) {
  const incs = [...inc.values()].filter(i => i.arm === arm && i[k]);
  const r = incs.reduce((s, i) => s + (i.restarts ?? 0), 0);
  const ttr = incs.filter(i => i.resolved).map(i => (i.resolved - i.opened) / 60000);
  console.log(arm, k, incs.length, 'restarts/inc', (r / incs.length).toFixed(3), 'medTTR', median(ttr).toFixed(1), 'reopen', incs.filter(i => i.reopened).length);
}

// sites: arm stable?
const siteArms = new Map();
for (const r of rows) { siteArms.set(r.site_id, (siteArms.get(r.site_id) ?? new Set()).add(r.arm)); }
console.log('\nsites in both arms:', [...siteArms].filter(([, s]) => s.size > 1).map(([k]) => k));
console.log('sites per arm:', ['control', 'flag'].map(a => [...siteArms].filter(([, s]) => s.has(a)).length));
// shown detail per arm
const det = {};
for (const r of rows.filter(r => r.event === 'suggestion_shown')) det[`${r.arm}:${r.detail}`] = (det[`${r.arm}:${r.detail}`] ?? 0) + 1;
console.log('shown detail by arm', det);

// per-site top in flag by restarts
const perSite = {};
for (const b of sn.values()) { const p = (perSite[b.site] ??= { arm: b.arm, r: 0, bn: 0, inc: 0 }); p.r += b.restarts; p.inc += b.incidents.size; if (b.incidents.size >= 3) p.bn++; }
console.log('\ntop sites by restarts:', Object.entries(perSite).sort((a, b) => b[1].r - a[1].r).slice(0, 10).map(([s, p]) => `${s}(${p.arm}) r=${p.r} inc=${p.inc} bn=${p.bn}`).join('; '));
// operators
const perOp = {};
for (const i of inc.values()) { const p = (perOp[i.op] ??= { arms: new Set(), n: 0, r: 0 }); p.arms.add(i.arm); p.n++; p.r += i.restarts ?? 0; }
console.log('ops', Object.keys(perOp).length, 'ops in both arms', Object.entries(perOp).filter(([, p]) => p.arms.size > 1).length);
