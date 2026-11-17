// job.mjs · one job's routine, as code. scripts/run-job.mjs runs it; scripts/parked.mjs finishes what it parks.
// Copy it next to your items and hosts.json, then fill in the three parts. The example posts weather
// readings to api.example.com with WEATHER_KEY; replace it with your own work.
//
// The limits are not here: the time budget and the item cap are run-job.mjs flags, and the hosts each
// secret may reach are in hosts.json. A secret is written as {{NAME}}: ctx.send fills it in after the
// check, so this file never holds its value.

const API = 'https://api.example.com/v1/readings';

// 1. The rules from the documents you read (the API's doc, a ticket, the owner's notes), one check each.
//    `rule` says the rule and where it came from. An item that fails a check is parked, with the rule as
//    the reason, before handle runs.
export const checks = [
  { rule: 'station is two capital letters and four digits (API doc, "Stations")', check: (item) => /^[A-Z]{2}\d{4}$/.test(item.station) },
  { rule: 'one reading is between -90 and 60 degrees (API doc, "Limits")', check: (item) => item.celsius >= -90 && item.celsius <= 60 },
];

// 2. One item of routine work. Return { done: true }, or { park: 'reason' } for a call your human makes
//    (a rule the code cannot check, an item outside the rules). A throw stops the run at this item.
export async function handle(item, ctx) {
  if (item.note) return { park: `the item has a note the rules do not cover: ${item.note}` };
  const res = await post(item, ctx);
  if (res.status >= 300) throw new Error(`api.example.com answered ${res.status} for ${item.id}`);
  return { done: true };
}

// 3. A parked item, after your human's yes or no. parked.mjs runs it once per item, with the copy the
//    item had when it was parked.
export async function finish(copy, decision, ctx) {
  if (decision !== 'yes') return { sent: false };
  const res = await post(copy, ctx);
  if (res.status >= 300) throw new Error(`api.example.com answered ${res.status} for ${copy.id}`);
  return { sent: true, status: res.status };
}

function post(item, ctx) {
  return ctx.send({
    method: 'POST',
    url: API,
    headers: { authorization: 'Bearer {{WEATHER_KEY}}', 'content-type': 'application/json' },
    body: JSON.stringify({ station: item.station, celsius: item.celsius }),
  });
}
