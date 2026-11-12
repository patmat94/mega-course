// Tracker client for the S03E03 agent. Every call and reply is appended to run/tracker.log, token masked.
// Usage:
//   node tracker.mjs GET /issues
//   node tracker.mjs POST /issues/3/comments --body-file body.json
//   node tracker.mjs POST /issues/3/comments --json '{"body":"..."}'
//   node tracker.mjs POST /issues/3/close
// Env: TRACKER_URL, TRACKER_TOKEN (or run/config.json { trackerUrl, token }).
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const runDir = process.env.RUN_DIR || join(here, '..', 'run');

export function config() {
  let c = {};
  try { c = JSON.parse(readFileSync(join(runDir, 'config.json'), 'utf8')); } catch {}
  return {
    base: (process.env.TRACKER_URL || c.trackerUrl || '').replace(/\/$/, ''),
    token: process.env.TRACKER_TOKEN || c.token || '',
  };
}

export async function call(method, path, body, who = 'agent') {
  const { base, token } = config();
  if (!base || !token) throw new Error('no tracker url or token');
  const init = { method, headers: { Authorization: `Bearer ${token}` } };
  if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  let status = 0, text = '';
  try {
    const res = await fetch(base + path, init);
    status = res.status; text = await res.text();
  } catch (e) { text = `fetch failed: ${e.message}`; }
  mkdirSync(runDir, { recursive: true });
  const mask = (s) => (token ? String(s).split(token).join('***') : String(s));
  appendFileSync(join(runDir, 'tracker.log'),
    `=== ${new Date().toISOString()} [${who}] ${method} ${path}\n` +
    (body !== undefined ? `body: ${mask(JSON.stringify(body))}\n` : '') +
    `reply ${status}: ${mask(text)}\n`);
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status, data };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [method, rawPath, ...rest] = process.argv.slice(2);
  // Git Bash may rewrite "/issues" to "C:/…/Git/issues"; undo that, and accept paths without a leading slash.
  let path = rawPath && rawPath.replace(/^[A-Za-z]:[\\/].*?[\\/]Git(?=[\\/])/, '').replaceAll('\\', '/');
  if (path && !path.startsWith('/')) path = '/' + path;
  let body;
  const i = rest.indexOf('--body-file'); if (i >= 0) body = JSON.parse(readFileSync(rest[i + 1], 'utf8'));
  const j = rest.indexOf('--json'); if (j >= 0) body = JSON.parse(rest[j + 1]);
  if (!method || !path) { console.log('usage: node tracker.mjs METHOD /path [--body-file f | --json s]'); }
  else {
    const { status, data } = await call(method.toUpperCase(), path, body, process.env.TRACKER_WHO || 'agent');
    console.log(`HTTP ${status}`);
    console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    process.exitCode = status >= 200 && status < 300 ? 0 : 1;
  }
}
