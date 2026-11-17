// Prints the house notes from host-desk/why/: each decision the app keeps on purpose, and why.
// The reviewer reads them before judging a hunk, because a change that reverses one is the owner's call.
import { readdirSync, readFileSync } from 'node:fs';
const WHY = new URL('../../../why/', import.meta.url);
for (const f of readdirSync(WHY).filter((n) => n.endsWith('.md')).sort()) {
  console.log(`=== why/${f}\n${readFileSync(new URL(f, WHY), 'utf8').trim()}\n`);
}
