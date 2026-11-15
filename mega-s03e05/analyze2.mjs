// Recompute releases 0010 and 0011 metrics and guardrails from batch2 CSVs, as their records define them.
import { readFileSync } from 'node:fs';
const read = f => { const [h, ...l] = readFileSync(new URL(`./batch2/signals/${f}`, import.meta.url), 'utf8').trim().split(/\r?\n/); const c = h.split(','); return l.map(x => { const v = x.split(','); return Object.fromEntries(c.map((k, i) => [k, v[i]])); }); };
const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN; };
const pct = (a, b) => (100 * a / b).toFixed(2) + '%';
const byInc = rows => { const m = new Map(); for (const r of rows) { if (!m.has(r.incident_id)) m.set(r.incident_id, { arm: r.arm, site: r.site_id, night: r.night, ev: [] }); m.get(r.incident_id).ev.push(r); } return m; };
const t = (i, e) => { const r = i.ev.find(x => x.event === e); return r ? Date.parse(r.ts) : undefined; };

// ---- 0010 auto-close
const ac = read('auto-close-events.csv');
const aci = byInc(ac);
console.log('== 0010 auto-close, rows', ac.length, 'incidents', aci.size);
const nights = [...new Set(ac.map(r => r.night))].sort();
for (const arm of ['control', 'flag']) {
  let open6 = 0, open6NoAuto = 0;
  for (const n of nights) {
    const six = Date.parse(n + 'T00:00:00Z') + 86400000 + 6 * 3600000;
    for (const i of aci.values()) {
      if (i.arm !== arm || i.night !== n) continue;
      const o = t(i, 'incident_opened'); if (!(o <= six)) continue;
      const ends = i.ev.filter(e => ['incident_resolved', 'incident_auto_closed'].includes(e.event) && Date.parse(e.ts) <= six).length;
      const reopens = i.ev.filter(e => e.event === 'incident_reopened' && Date.parse(e.ts) <= six).length;
      if (ends <= reopens) open6++;
      const endsReal = i.ev.filter(e => e.event === 'incident_resolved' && Date.parse(e.ts) <= six).length;
      if (endsReal === 0) open6NoAuto++;
    }
  }
  const incs = [...aci.values()].filter(i => i.arm === arm);
  const ttr = incs.map(i => { const o = t(i, 'incident_opened'); const r = t(i, 'incident_resolved') ?? t(i, 'incident_auto_closed'); return r ? (r - o) / 60000 : null; }).filter(x => x != null);
  const ttrReal = incs.map(i => { const o = t(i, 'incident_opened'); const r = t(i, 'incident_resolved'); return r ? (r - o) / 60000 : null; }).filter(x => x != null);
  const auto = incs.filter(i => i.ev.some(e => e.event === 'incident_auto_closed'));
  const reo = incs.filter(i => i.ev.some(e => e.event === 'incident_reopened'));
  const autoReo = auto.filter(i => i.ev.some(e => e.event === 'incident_reopened'));
  const autoNeverResolved = auto.filter(i => !i.ev.some(e => e.event === 'incident_resolved'));
  console.log(`${arm}: incidents=${incs.length} openAt06=${open6} (not resolved by an operator: ${open6NoAuto}) medianTTR(resolved|auto)=${median(ttr).toFixed(2)} medianTTR(resolved only)=${median(ttrReal).toFixed(2)} n=${ttrReal.length} reopened=${reo.length} (${pct(reo.length, incs.length)}) autoClosed=${auto.length} autoReopened=${autoReo.length} autoNeverResolved=${autoNeverResolved.length}`);
}
// auto-closed detail: what happened after, by source
const autos = [...aci.values()].filter(i => i.ev.some(e => e.event === 'incident_auto_closed'));
const bySrc = {}; for (const i of autos) { const s = i.ev.find(e => e.event === 'incident_opened').detail; const k = `${s}`; (bySrc[k] ??= { n: 0, reo: 0, res: 0 }); bySrc[k].n++; if (i.ev.some(e => e.event === 'incident_reopened')) bySrc[k].reo++; if (i.ev.some(e => e.event === 'incident_resolved')) bySrc[k].res++; }
console.log('auto-closed by source', JSON.stringify(bySrc));
console.log('sample auto-closed incidents:'); for (const i of autos.slice(0, 3)) console.log(i.ev.map(e => `${e.event_id} ${e.ts.slice(11, 19)} ${e.event} ${e.detail}`).join(' | '));
const reoNoAuto = [...aci.values()].filter(i => i.ev.some(e => e.event === 'incident_reopened') && !i.ev.some(e => e.event === 'incident_auto_closed'));
console.log('reopened without auto-close', reoNoAuto.length, 'by arm', JSON.stringify(reoNoAuto.reduce((a, i) => (a[i.arm] = (a[i.arm] ?? 0) + 1, a), {})));

// ---- 0011 bulk ack
const ba = read('bulk-ack-events.csv');
const bai = byInc(ba);
console.log('\n== 0011 bulk-ack, rows', ba.length, 'incidents', bai.size);
const sn = new Map(); for (const i of bai.values()) { const k = i.site + '|' + i.night; sn.set(k, (sn.get(k) ?? 0) + 1); }
for (const arm of ['control', 'flag']) {
  const incs = [...bai.values()].filter(i => i.arm === arm);
  const bad = incs.filter(i => sn.get(i.site + '|' + i.night) >= 3);
  const ttA = bad.map(i => (t(i, 'incident_acked') - t(i, 'incident_opened')) / 60000);
  const a2r = incs.map(i => (t(i, 'incident_resolved') - t(i, 'incident_acked')) / 60000);
  const a2rBad = bad.map(i => (t(i, 'incident_resolved') - t(i, 'incident_acked')) / 60000);
  const missed = incs.filter(i => i.ev.some(e => e.event === 'page_missed'));
  const bulk = incs.filter(i => i.ev.some(e => e.event === 'incident_acked' && e.detail.startsWith('bulk')));
  const a2rBulk = bulk.map(i => (t(i, 'incident_resolved') - t(i, 'incident_acked')) / 60000);
  const a2rSingle = incs.filter(i => !bulk.includes(i)).map(i => (t(i, 'incident_resolved') - t(i, 'incident_acked')) / 60000);
  const missedBulk = bulk.filter(i => missed.includes(i)).length;
  const o2r = incs.map(i => (t(i, 'incident_resolved') - t(i, 'incident_opened')) / 60000);
  console.log(`${arm}: incidents=${incs.length} badNightInc=${bad.length} median open->ack(bad)=${median(ttA).toFixed(2)} | ack->resolve all=${median(a2r).toFixed(2)} bad=${median(a2rBad).toFixed(2)} | missed=${missed.length} (${pct(missed.length, incs.length)}) | bulk-acked=${bulk.length} ack->res bulk=${median(a2rBulk).toFixed(2)} single=${median(a2rSingle).toFixed(2)} missedInBulk=${missedBulk} | open->resolve=${median(o2r).toFixed(2)}`);
}
const pm = ba.filter(r => r.event === 'page_missed'); console.log('page_missed details', JSON.stringify(pm.slice(0, 3)));
const bulkInc = [...bai.values()].filter(i => i.ev.some(e => e.detail.startsWith('bulk'))).slice(0, 3);
for (const i of bulkInc) console.log(i.ev.map(e => `${e.event_id} ${e.ts.slice(11, 19)} ${e.event} ${e.detail} ${e.operator_id}`).join(' | '));
// bulk groups: same source?
const groups = new Map(); for (const r of ba.filter(r => r.event === 'incident_acked' && r.detail.startsWith('bulk'))) { const k = r.site_id + '|' + r.ts; (groups.get(k) ?? groups.set(k, []).get(k)).push(r.incident_id); }
let mixed = 0, same = 0; for (const ids of groups.values()) { const srcs = new Set(ids.map(id => bai.get(id).ev.find(e => e.event === 'incident_opened').detail)); srcs.size > 1 ? mixed++ : same++; }
console.log('bulk ack groups', groups.size, 'same source', same, 'mixed sources', mixed);
