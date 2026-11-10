// night-status: public status page for sched-prod, built from mega-s03e01/list.json.
// Each rule cites its tag. Open conflicts (R-H2L/R-Z6L, R-K5H vs 5214) are noted where they bite.

const TEAL = '#1f9e8f'; // R-R8X: exactly the banner colour of screenshot.png

// R-M8Z: tram boards read status.json from their own pages. R-Z5H: max-age 30 s or less.
const SHARED = {
  'access-control-allow-origin': '*',
  'cache-control': 'public, max-age=30',
};

// R-R6H: read the ops feed live on every request, never keep a copy.
export async function readFeed(url) {
  const r = await fetch(url, { cf: { cacheTtl: 0 }, headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`ops feed answered ${r.status}`);
  return r.json();
}

const pad = (n) => String(n).padStart(2, '0');
// R-Z8K (product chose it over R-Z9L): dates month first, 10/12. R-Z4M: all times UTC.
export const dateMD = (iso) => { const d = new Date(iso); return `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`; };
export const timeHM = (iso) => { const d = new Date(iso); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };

// "last-night": the night (18:00Z to 12:00Z) that holds the newest incident.
function lastNight(rows) {
  if (!rows.length) return rows;
  const newest = new Date(rows[0].opened);
  const end = new Date(Date.UTC(newest.getUTCFullYear(), newest.getUTCMonth(), newest.getUTCDate(), 12));
  if (newest >= end) end.setUTCDate(end.getUTCDate() + 1);
  const start = new Date(end.getTime() - 18 * 3600e3);
  return rows.filter((r) => { const t = new Date(r.opened); return t >= start && t < end; });
}

export function buildStatus(feed, range = 'all') {
  // R-K9R: newest incident at the top.
  let rows = [...(feed.incidents || [])].sort((a, b) => Date.parse(b.opened) - Date.parse(a.opened));
  if (range === 'last-night') rows = lastNight(rows);
  return {
    updatedAt: feed.updatedAt, // R-R6H: the ops feed's own value, as it sends it (R-H4X: UTC, ends in Z)
    incidents: rows.map((r) => ({
      id: r.id, line: r.line, opened: r.opened, closed: r.closed, what: r.what,
      author: r.author, // R-K5H: who ran it; 5214 has "—" in the feed and stays as the feed says (open with product)
    })),
  };
}

const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ENT[c]);

export function renderPage(status) {
  // R-L9X: every line gets its own row, tram 3 included: one row per incident, the line named on each.
  const lines = [...new Set(status.incidents.map((r) => r.line))];
  const body = status.incidents.map((r) => `<tr data-line="${esc(r.line)}"><td>${dateMD(r.opened)}</td><td>${esc(r.line)}</td><td>${timeHM(r.opened)}</td><td>${r.closed ? timeHM(r.closed) : 'open'}</td><td>${esc(r.what)}</td><td>${esc(r.author)}</td></tr>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>status for the night</title>
<link rel="alternate" type="application/json" href="status.json">
<style>
  body { margin: 0; font: 16px/1.5 system-ui, sans-serif; color: #1a1a1a; background: #fff; }
  .banner { background: ${TEAL}; color: #10201e; padding: 14px 28px; font-weight: 500; }
  main { max-width: 880px; margin: 0 auto; padding: 8px 28px 32px; }
  h1 { font-size: 1.6rem; margin: 24px 0 4px; }
  .meta { color: #555; margin: 0 0 16px; }
  table { border-collapse: collapse; width: 100%; }
  th { text-align: left; color: #777; font-weight: 500; }
  th, td { padding: 9px 6px; border-bottom: 1px solid #e6e6e6; }
  footer { max-width: 880px; margin: 0 auto; padding: 0 28px 28px; color: #555; }
</style>
</head>
<body>
<div class="banner">Some services had problems overnight.</div>
<main>
<h1>status for the night</h1>
<p class="meta">shown on tram 3 boards · updated <time datetime="${esc(status.updatedAt)}">${esc(status.updatedAt)}</time> · ${status.incidents.length} incidents on ${lines.length} lines · <a href="status.json">status.json</a></p>
<table>
<thead><tr><th>date</th><th>line</th><th>opened</th><th>closed</th><th>what</th><th>ran by</th></tr></thead>
<tbody>
${body}
</tbody>
</table>
</main>
<footer>all times UTC</footer>
</body>
</html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...SHARED, 'access-control-allow-methods': 'GET, HEAD, OPTIONS' } });
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('GET only', { status: 405, headers: SHARED });
    if (!['/', '/index.html', '/status.json'].includes(url.pathname)) return new Response('not found', { status: 404, headers: SHARED });
    let status;
    try {
      status = buildStatus(await readFeed(env.FEED_URL), env.RANGE);
    } catch (e) {
      return new Response(JSON.stringify({ error: String(e.message || e) }), { status: 502, headers: { ...SHARED, 'content-type': 'application/json' } });
    }
    if (url.pathname === '/status.json') {
      return new Response(JSON.stringify(status, null, 2), { headers: { ...SHARED, 'content-type': 'application/json; charset=utf-8' } });
    }
    return new Response(renderPage(status), { headers: { ...SHARED, 'content-type': 'text/html; charset=utf-8' } });
  },
};
