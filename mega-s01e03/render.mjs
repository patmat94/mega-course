// Renders src/routes/kb/incidents/4471/problems/+page.svx the way the runbook layout shows it.
// Numbers and the desk ref come from the kb's own code (causes.ts, desk-ref.ts), run by Node.
// Usage: node render.mjs <repo root> <out file>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [root, outFile] = process.argv.slice(2);
const lib = (p) => pathToFileURL(path.join(root, 'src/lib', p)).href;
const { causeOf, uniqueById, groupByCause, ticketCause, readAs } = await import(lib('kb/causes.ts'));
const { deskRef } = await import(lib('kb/desk-ref.ts'));
const { daysSince, isoDay, STALE_AFTER_DAYS } = await import(lib('kb/staleness.ts'));

const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, 'src/lib/data', p), 'utf8'));
const reports = readJson('reports-4471.json');
const notes = readJson('desk-notes.json');
const tenants = new Map(fs.readdirSync(path.join(root, 'src/lib/data/tenants')).map((f) => {
  const t = readJson(`tenants/${f}`);
  return [t.handle, t];
}));
const tenantOf = (r) => tenants.get(r.tenant);

// Frontmatter of the page.
const svx = fs.readFileSync(path.join(root, 'src/routes/kb/incidents/4471/problems/+page.svx'), 'utf8');
const fm = Object.fromEntries(
  svx.split('---')[1].trim().split('\n').map((l) => {
    const i = l.indexOf(':');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^'(.*)'$/, '$1')];
  }),
);

// problems.ts, same rules (kept in step by hand: it imports through the #lib alias Node can't resolve).
const problemOf = (r) => (notes.oneDayMove.includes(r.id) ? 'one-day' : causeOf(r, tenantOf(r)) ?? 'unplaced');
const TICKET = 4471;
const merged = uniqueById(reports).filter((r) => r.mergedInto === TICKET);
const groupBy = (rs, key) => {
  const m = new Map();
  for (const r of rs) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return [...m.entries()].map(([k, rs]) => {
    const days = rs.map((r) => r.receivedAt.slice(0, 10)).sort();
    return {
      key: k,
      reports: rs,
      taggedAs: rs.reduce((n, r) => ({ ...n, [r.meta.intakeTag]: (n[r.meta.intakeTag] ?? 0) + 1 }), {}),
      tenants: new Set(rs.map((r) => r.tenant)).size,
      firstSeen: days[0],
      lastSeen: days.at(-1),
    };
  }).sort((a, b) => b.reports.length - a.reports.length);
};
const problems = groupBy(merged, problemOf);
const repo = 'https://github.com/patmat94/mega-what-it-shows/issues';
const issues = { parser: `${repo}/1`, hint: `${repo}/2`, 'one-day': `${repo}/3` };
const tags = (g) => Object.entries(g.taggedAs).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ×${n}`).join(' · ');

const causeGroups = groupByCause(merged, tenantOf);
const owner = ticketCause(causeGroups, TICKET);

const age = daysSince(fm.reviewed);
const stale = age > STALE_AFTER_DAYS;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const problemRows = problems.map((g) => `      <tr>
        <td><code>${g.key}</code></td>
        <td>${g.reports.length}</td>
        <td class="tags">${tags(g)}</td>
        <td>${g.tenants}</td>
        <td>${g.firstSeen} → ${g.lastSeen}</td>
        <td>${issues[g.key] ? `<a href="${issues[g.key]}">#${issues[g.key].split('/').pop()}</a>` : 'none yet'}</td>
      </tr>`).join('\n');
const causeRows = causeGroups.map((g) => `      <tr${g.cause !== owner ? ' class="wrong"' : ''}>
        <td><code>${g.cause}</code></td>
        <td>${g.reports.length}</td>
        <td class="tags">${tags(g)}</td>
        <td>${g.tenants}</td>
        <td>${g.firstSeen} → ${g.lastSeen}</td>
        <td>${g.cause === owner ? `#${TICKET}` : 'not this ticket — no ticket of its own'}</td>
      </tr>`).join('\n');
const causeNotes = causeGroups.map((g) => [g, readAs(g, notes.oneDayMove)]).filter(([, n]) => n)
  .map(([g, n]) => `<p class="note">${n} reports read as a one-day move; filed under <code>${g.cause}</code> by tenant.</p>`).join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fm.title)} · support kb</title>
<style>
  :root {
    --bg: #fbfaf7; --fg: #1d1d1b; --muted: #6b6a66; --line: #e3e0d8;
    --accent: #2f6f5e; --warn: #b4501f; --warn-bg: #fbeee6; --note-bg: #eef5f2;
    --mono: ui-monospace, 'Cascadia Code', Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #171716; --fg: #ecebe6; --muted: #9c9a93; --line: #34332f;
      --accent: #6fbfa6; --warn: #f0905d; --warn-bg: #3a2418; --note-bg: #1d2c27;
    }
  }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, sans-serif; }
  .kb table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 0.92rem; }
  .kb th, .kb td { border-bottom: 1px solid var(--line); padding: 0.35rem 0.5rem; text-align: left; }
  .kb code { font-family: var(--mono); font-size: 0.88em; }
  .kb a { color: var(--accent); }
  .kb { max-width: 760px; margin: 0 auto; padding: 2rem 16px 4rem; }
  .crumb { font: 0.8rem var(--mono); text-decoration: none; color: var(--muted); }
  h1 { margin: 0.25rem 0 0.5rem; line-height: 1.2; }
  .meta { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; color: var(--muted); font-size: 0.85rem; margin: 0; }
  .status { border: 1px solid var(--line); border-radius: 99px; padding: 0 0.6rem; }
  .stale { color: var(--warn); font-weight: 600; }
  .banner { background: var(--warn-bg); color: var(--warn); padding: 0.6rem 1rem; border-radius: 6px; }
  footer { margin-top: 3rem; color: var(--muted); font-size: 0.8rem; border-top: 1px solid var(--line); padding-top: 1rem; }
  aside { border-left: 4px solid var(--accent); padding: 0.5rem 1rem; margin: 1rem 0; background: var(--note-bg); }
  aside.warn { border-color: var(--warn); background: var(--warn-bg); }
  .sum { font-size: 1.1rem; }
  .tags { color: var(--muted); font-size: 0.85em; }
  .note { color: var(--muted); font-size: 0.85em; }
  .wrong td { background: var(--warn-bg); }
  .wrong td:last-child { color: var(--warn); font-weight: 600; }
  .stamp { margin: 2rem 0 0; font: 0.85rem var(--mono); color: var(--muted); }
  .stamp b { color: var(--accent); letter-spacing: 0.04em; }
</style>
</head>
<body>
<div class="kb">
  <header>
    <a class="crumb" href="/kb">support desk · kb</a>
    <h1>${esc(fm.title)}</h1>
    <p class="meta">
      <span>owner <b>${esc(fm.owner)}</b></span>
      <span class="status ${esc(fm.status)}">${esc(fm.status)}</span>
      <span${stale ? ' class="stale"' : ''}>reviewed ${isoDay(fm.reviewed)} · ${age} days ago${stale ? ' · stale' : ''}</span>
    </p>
  </header>
${stale ? `  <p class="banner">Nobody has re-read this page in ${age} days. Check it against the live views before you rely on it.</p>\n` : ''}  <main>
<p><a href="/kb/incidents/4471">#4471</a> is marked known: one issue, one fix queued. The reports merged into it
describe three different problems. One fix for the parser leaves two of them open.</p>

<aside class="warn">Not one issue. Three tickets, one per problem. Each needs its own fix and its own owner.</aside>

<h2>What was merged</h2>

<p class="sum">
  <strong>${merged.length}</strong> reports merged into #${TICKET} ·
  <strong>${problems.length}</strong> ${problems.length === 1 ? 'problem' : 'problems'}
</p>
<table>
  <thead>
    <tr><th>problem</th><th>reports</th><th>tagged as</th><th>tenants</th><th>seen</th><th>ticket</th></tr>
  </thead>
  <tbody>
${problemRows}
  </tbody>
</table>

<p>The counts come from the same data and the same rules as the desk's own table below: one report per
id, cause by tenant (<code>causes.ts</code>), and the one-day moves the desk already listed in <code>desk-notes.json</code>.</p>

<h2>The three problems</h2>

<h3><code>parser</code>: day and month swapped</h3>
<p>The shared parser reads every date month first. Every tenant on file writes the day first, so
<code>7 April</code> goes out as <code>4 July</code>. Reports come in by app, email and form from every tenant.
Fixing the parser fixes these, and only these.</p>

<h3><code>hint</code>: the booking-v3 form asks for the wrong order</h3>
<p>On tenants running booking-v3, the form prints <code>MM/DD/YYYY</code> under its date field. People type
what the hint tells them, month first, and the form reads it the tenant's way, day first. The
date comes out swapped just like <code>parser</code>, which is why it was merged. But a parser fix does not
touch it: the form hint has to match the tenant's locale. Only form reports from booking-v3 tenants
land here.</p>

<h3><code>one-day</code>: the invite lands one day off</h3>
<p>These are not swaps. “Tuesday 12 May” arrives as “Monday 11 May”; the same meeting shows Tuesday
in Lisbon and Monday in Toronto; an invite arrives before its booking was made. That is a time
zone shift, not a date format. The desk noticed them (<code>desk-notes.json</code>) but <code>CauseTable</code> files
them under <code>parser</code> by tenant, so they would stay broken after the parser fix.</p>

<h2>How they got merged</h2>
<p><a href="/kb/decisions/0001-dedupe-by-subject">Decision 0001</a> merges on subject line alone, and
<a href="/kb/triage/dedupe">triage</a> says “when unsure, merge”. All three problems produce the same
subjects (“Wrong day on the invite”, “Month and day swapped?”), so they merged into one ticket.
Intake's tag is no better: it guesses from the reporter's browser, not the tenant, and disagrees
with the cause on many reports (see “tagged as” above).</p>
<p>Merging on subject needs a new decision record that replaces 0001. Until then: before merging into
a big ticket, check the cause, not the subject.</p>

<h2>The desk's view, for comparison</h2>

<p class="sum">
  <strong>${merged.length}</strong> reports merged into #${TICKET} ·
  <strong>${causeGroups.length}</strong> ${causeGroups.length === 1 ? 'cause' : 'causes'}
</p>
<table>
  <thead>
    <tr><th>cause</th><th>reports</th><th>tagged as</th><th>tenants</th><th>seen</th><th></th></tr>
  </thead>
  <tbody>
${causeRows}
  </tbody>
</table>
${causeNotes}

<p class="stamp">desk ref <b>${deskRef(fm.signature)}</b></p>
  </main>
  <footer>Pages are written by people. Tables and charts are built from data at render time.</footer>
</div>
</body>
</html>
`;
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, html);
console.log('signature', JSON.stringify(fm.signature), 'desk ref', deskRef(fm.signature));
console.log('problems', problems.map((g) => `${g.key}=${g.reports.length}`).join(' '), '| causes', causeGroups.map((g) => `${g.cause}=${g.reports.length}`).join(' '));
