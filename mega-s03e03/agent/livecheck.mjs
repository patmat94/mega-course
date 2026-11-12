// Live check from outside: node livecheck.mjs /incidents [/other ...]
// Prints status and body (first 1500 chars) for each path on the live address.
const base = (process.env.LIVE_URL || 'https://sched-prod-api-production.patrykmatychniak.workers.dev').replace(/\/$/, '');
// Git Bash may rewrite "/health" to "C:/…/Git/health"; undo that, and accept paths without a leading slash.
const fix = (p) => { p = p.replace(/^[A-Za-z]:[\\/].*?[\\/]Git(?=[\\/])/, '').replaceAll('\\', '/'); return p.startsWith('/') ? p : '/' + p; };
for (const p of process.argv.slice(2).map(fix)) {
  try {
    const res = await fetch(base + p, { headers: { 'cache-control': 'no-cache' } });
    const t = await res.text();
    console.log(`GET ${p} -> ${res.status}\n${t.slice(0, 1500)}\n`);
  } catch (e) { console.log(`GET ${p} -> fetch failed: ${e.message}`); }
}
