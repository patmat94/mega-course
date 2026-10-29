// Checks each report body: do its two dates show a day/month swap, or something else?
import fs from 'node:fs';
const rows = fs.readFileSync(process.argv[2], 'utf8').split('\n').map((l) => l.split(' | '));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const re = new RegExp(`(\\d{1,2}) (${MONTHS.join('|')})`, 'g');
const out = { swap: [], same: [], other: [], none: [] };
for (const [id, , tenant, channel, cause, tag, , , body] of rows) {
  const ds = [...body.matchAll(re)].map((m) => [Number(m[1]), MONTHS.indexOf(m[2]) + 1]);
  const line = `${id} ${tenant} ${channel} ${cause} :: ${body}`;
  if (ds.length < 2) out.none.push(line);
  else if (ds[0][0] === ds[1][1] && ds[0][1] === ds[1][0]) (ds[0][0] === ds[0][1] ? out.same : out.swap).push(line);
  else out.other.push(line);
}
for (const [k, v] of Object.entries(out)) console.log(k, v.length, k === 'swap' ? '' : '\n  ' + v.join('\n  '));
const swapByCause = out.swap.reduce((m, l) => ((m[l.split(' ')[3]] = (m[l.split(' ')[3]] ?? 0) + 1), m), {});
console.log('swap by cause', swapByCause);
