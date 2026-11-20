// Prints what the night already recorded for one booking (host-desk/night/changes.json): `history.mjs <booking id>`.
// The night-desk reads it before it changes a booking, so a change to a cancelled booking or a second cancel shows.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [booking] = process.argv.slice(2);
if (!booking) { console.error('usage: history.mjs <booking id>'); process.exit(1); }
const file = join(resolve(dirname(fileURLToPath(import.meta.url)), '../../../night'), 'changes.json');
let rows = [];
try { rows = JSON.parse(readFileSync(file, 'utf8')); } catch {}
const mine = rows.filter((r) => r.booking === booking);
console.log(mine.length ? mine.map((r) => `${r.at} event ${r.event}: ${'refund' in r ? `cancelled, refund ${r.refund} EUR` : `+${r.nights} night(s)`}`).join('\n') : `nothing recorded yet for ${booking}`);
