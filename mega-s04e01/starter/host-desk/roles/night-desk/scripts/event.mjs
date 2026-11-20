// Prints the event this start of the night-desk handles (the poller writes it to NIGHT_EVENT).
import { readFileSync } from 'node:fs';

const file = process.env.NIGHT_EVENT;
if (!file) {
  console.error('No event: start the night-desk through night.mjs.');
  process.exit(1);
}
console.log(readFileSync(file, 'utf8'));
