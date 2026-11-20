// Writes this event's result for the poller to post: `result.mjs applied|conflict|parked`.
import { writeFileSync } from 'node:fs';

const [status] = process.argv.slice(2);
if (!['applied', 'conflict', 'parked'].includes(status)) {
  console.error('usage: result.mjs applied|conflict|parked');
  process.exit(1);
}
if (!process.env.NIGHT_RESULT) {
  console.error('No event: start the night-desk through night.mjs.');
  process.exit(1);
}
writeFileSync(process.env.NIGHT_RESULT, JSON.stringify({ status }));
console.log(`result: ${status}`);
