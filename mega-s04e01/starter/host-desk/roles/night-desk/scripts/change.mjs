// Records one change to a booking in host-desk/night/changes.json: `change.mjs <booking id> nights <n>` or
// `change.mjs <booking id> refund <EUR>`. The payout batch pays each booking with its changes.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [booking, kind, amount] = process.argv.slice(2);
const n = Number(amount);
if (!booking || !['nights', 'refund'].includes(kind) || !Number.isInteger(n)) {
  console.error('usage: change.mjs <booking id> nights|refund <whole number>');
  process.exit(1);
}

// host-desk/roles/night-desk/scripts/ → host-desk/night/
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../night');
const file = join(dir, 'changes.json');
mkdirSync(dir, { recursive: true });
let event = null;
try {
  event = JSON.parse(readFileSync(process.env.NIGHT_EVENT ?? '', 'utf8')).id ?? null;
} catch {}
// The poller wakes one role per event in parallel (S04E04), so two starts may write at once: a lock folder (mkdir is
// atomic) keeps each read-modify-write whole. A lock older than 10 s is left over from a killed start and is taken.
const lock = join(dir, 'changes.lock');
const t0 = Date.now();
for (;;) {
  try { mkdirSync(lock); break; } catch {
    try { if (Date.now() - statSync(lock).mtimeMs > 10_000) { rmSync(lock, { recursive: true, force: true }); continue; } } catch {}
    if (Date.now() - t0 > 20_000) { console.error('changes.json is locked: not recorded'); process.exit(1); }
    await new Promise((r) => setTimeout(r, 50));
  }
}
try {
  const changes = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  changes.push({ booking, [kind]: n, event, at: new Date().toISOString() });
  writeFileSync(file, `${JSON.stringify(changes, null, 2)}\n`);
} finally {
  rmSync(lock, { recursive: true, force: true });
}
console.log(`recorded: ${booking} ${kind} ${n}`);
