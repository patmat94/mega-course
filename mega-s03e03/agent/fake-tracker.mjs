// Fake course tracker for a dry run, built from the starter's AGENTS.md (the calls and their shapes).
// node fake-tracker.mjs [port]   token: "test-token"
// Test-only calls (no auth): POST /_admin/issues {title, body}, POST /_admin/issues/{n}/owner {body},
// POST /_admin/records/{id}/sign
import { createServer } from 'node:http';

const port = Number(process.argv[2] || 8790);
const TOKEN = 'test-token';
const now = () => new Date().toISOString();
const issues = [];
const records = new Map([['0001-incidents-contract', {
  id: '0001-incidents-contract', by: 'course', status: 'accepted', signedBy: 'owner', signedAt: now(), updatedAt: now(),
  text: '# 0001 The incidents answer is pinned\nReaders: status page, on-call board, support console. A field added to an existing answer needs a record.',
  history: [], versions: [] }]]);
const shiplog = [];

const send = (res, s, body) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const read = (req) => new Promise((r) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { try { r(b ? JSON.parse(b) : {}); } catch { r(null); } }); });

createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); const p = u.pathname; const m = req.method;
  const body = m === 'GET' ? {} : await read(req);
  if (body === null) return send(res, 400, { message: 'bad json' });
  let mm;
  if (p.startsWith('/_admin/')) {
    if (m === 'POST' && p === '/_admin/issues') { const n = issues.length + 1; issues.push({ n, title: body.title, body: body.body, openedAt: now(), labels: [], closed: false, thread: [] }); return send(res, 200, { n }); }
    if ((mm = p.match(/^\/_admin\/issues\/(\d+)\/owner$/))) { issues[mm[1] - 1].thread.push({ by: 'owner', at: now(), kind: 'comment', body: body.body }); return send(res, 200, { ok: true }); }
    if ((mm = p.match(/^\/_admin\/records\/([^/]+)\/sign$/))) { const r = records.get(mm[1]); r.signedBy = 'owner'; r.signedAt = now(); return send(res, 200, { ok: true }); }
    return send(res, 404, { message: 'no admin call' });
  }
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { message: 'token' });
  if (m === 'GET' && p === '/issues') return send(res, 200, { now: now(), lastIssueBy: null, issues });
  if ((mm = p.match(/^\/issues\/(\d+)(\/(comments|labels|close))?$/))) {
    const is = issues[mm[1] - 1]; if (!is) return send(res, 404, { message: 'no such issue' });
    if (m === 'GET' && !mm[2]) return send(res, 200, is);
    if (m === 'POST' && mm[3] === 'comments') { if (!body.body) return send(res, 400, { message: 'body needed' }); is.thread.push({ by: 'agent', at: now(), kind: 'comment', body: body.body }); return send(res, 200, { ok: true }); }
    if (m === 'POST' && mm[3] === 'labels') { if (!body.label) return send(res, 400, { message: 'label needed' }); is.labels.push(body.label); is.thread.push({ by: 'agent', at: now(), kind: 'label', label: body.label }); return send(res, 200, { ok: true }); }
    if (m === 'POST' && mm[3] === 'close') { is.closed = true; is.thread.push({ by: 'agent', at: now(), kind: 'close' }); return send(res, 200, { ok: true }); }
  }
  if (m === 'GET' && p === '/records') return send(res, 200, { records: [...records.values()].map(({ history, ...r }) => r) });
  if ((mm = p.match(/^\/records\/([^/]+)$/))) {
    if (m === 'GET') { const r = records.get(mm[1]); return r ? send(res, 200, r) : send(res, 404, { message: 'no record' }); }
    if (m === 'PUT') {
      if (!/^\d{4}-[a-z0-9-]+$/.test(mm[1]) || Number(mm[1].slice(0, 4)) < 7) return send(res, 400, { message: 'id must be NNNN-slug from 0007' });
      if (!body.text) return send(res, 400, { message: 'text needed' });
      const st = /status:\s*(\w+)/.exec(body.text)?.[1] || 'proposed';
      const r = records.get(mm[1]) || { id: mm[1], by: 'agent', signedBy: null, signedAt: null, history: [], versions: [] };
      r.text = body.text; r.status = st; r.updatedAt = now(); r.history.push({ at: now(), text: body.text }); r.versions.push({ at: now(), signed: false });
      records.set(mm[1], r); return send(res, 200, { ok: true, version: r.versions.length });
    }
  }
  if (m === 'GET' && p === '/shiplog') {
    const newest = new Map(); for (const l of shiplog) { const k = /^#(\d+)/.exec(l)?.[1] ?? l; newest.set(k, l); }
    return send(res, 200, { text: [...newest.values()].join('\n') });
  }
  if (m === 'POST' && p === '/shiplog') { if (!body.line) return send(res, 400, { message: 'line needed' }); shiplog.push(body.line); return send(res, 200, { ok: true }); }
  return send(res, 404, { message: 'not found' });
}).listen(port, () => console.log(`fake tracker on http://localhost:${port}`));
