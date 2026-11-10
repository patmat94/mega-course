// Checks the deployed page and status.json against every accepted tag in list.json, plus the "who it helped" line.
const BASE = process.argv[2] || 'https://night-status.patrykmatychniak.workers.dev';
const FEED = 'https://hq.mega.dev/challenges/status-for-the-night/api/incidents/7a5169564388';
const results = [];
const ok = (tag, pass, note) => results.push({ tag, pass, note });

const t0 = Date.now();
const page = await fetch(BASE + '/');
const ms = Date.now() - t0;
const html = await page.text();
const js = await fetch(BASE + '/status.json', { headers: { origin: 'https://tram3.example' } });
const status = await js.json();
const feed = await (await fetch(FEED)).json();

ok('public', page.status === 200 && js.status === 200 && !/login|sign in/i.test(html), `page ${page.status}, json ${js.status}`);
ok('R-K9R', status.incidents.every((r, i, a) => !i || Date.parse(a[i - 1].opened) >= Date.parse(r.opened)), 'newest first');
ok('R-R8X', /background:\s*#1f9e8f/.test(html), 'banner #1f9e8f');
ok('R-R6H', status.updatedAt === feed.updatedAt, `json ${status.updatedAt} vs feed ${feed.updatedAt}`);
ok('R-M8Z', js.headers.get('access-control-allow-origin') === '*', `ACAO ${js.headers.get('access-control-allow-origin')}`);
ok('R-H4X', /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?Z$/.test(status.updatedAt), status.updatedAt);
ok('R-H9M', /<h1>status for the night<\/h1>/.test(html), 'heading');
const ma = Number((js.headers.get('cache-control') || '').match(/max-age=(\d+)/)?.[1]);
ok('R-Z5H', ma > 0 && ma <= 30, `cache-control ${js.headers.get('cache-control')}`);
const lines = new Set(status.incidents.map((r) => r.line));
const rows = (html.match(/<tr data-line="([^"]+)"/g) || []).map((s) => s.slice(15, -1));
ok('R-L9X', [...lines].every((l) => rows.includes(l)) && rows.includes('tram 3'), `lines on page: ${[...new Set(rows)].join(', ')}`);
ok('R-Z4M', /<footer>[^<]*all times UTC/.test(html), 'footer');
ok('R-K6X', html.includes('shown on tram 3 boards'), 'text');
ok('R-Z8K', /<td>10\/12<\/td>/.test(html) && !/<td>12\/10<\/td>/.test(html), 'month first');
ok('R-H2L (chosen)', status.incidents.every((r) => r.id !== '5208') && status.incidents.length === rows.length, `${status.incidents.length} rows, 5208 dropped`);
ok('same content', status.incidents.length === rows.length, 'page rows = json rows');
ok('helped: load < 1 s', ms < 1000, `${ms} ms`);

for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.tag.padEnd(16)} ${r.note}`);
console.log(results.every((r) => r.pass) ? 'ALL PASS' : 'SOME FAIL');
