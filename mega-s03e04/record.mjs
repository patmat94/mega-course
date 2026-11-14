// Records the deployed board in use with Playwright in the installed Chrome, and writes what happened when.
// Usage: node record.mjs <board url> <out name> [--zone Europe/Berlin --locale de-DE] [--short]
// Writes rec/<out>.webm and rec/<out>.events.json (each event: at "mm:ss" from the video start, flow, detail).
// The page gets two recording aids that are not part of the board: a visible pointer dot (headless video
// shows no cursor) and a caption in the bottom-left corner. Both ignore the pointer, so clicks pass through.
import { chromium } from 'playwright';
import { mkdirSync, renameSync, writeFileSync, appendFileSync } from 'node:fs';

const [url, out] = process.argv.slice(2);
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const zone = arg('zone', 'Europe/Berlin');
const locale = arg('locale', 'de-DE');
const short = process.argv.includes('--short');
const confirmMode = process.argv.includes('--confirm'); // step 2: Ack opens a confirm naming the incident id (R7)
const loaderDelayMs = Number(arg('loader-delay', '1500'));
if (!url || !out) throw new Error('usage: node record.mjs <board url> <out name>');

mkdirSync('rec/tmp', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 }, locale, timezoneId: zone,
  recordVideo: { dir: 'rec/tmp', size: { width: 1280, height: 720 } },
});

// Recording aids, injected before the board's own scripts.
await context.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    dot.id = 'rec-pointer';
    dot.style.cssText = 'position:fixed;z-index:99999;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;background:rgba(220,0,60,.55);border:2px solid #b0003a;pointer-events:none;left:-40px;top:-40px;transition:transform .08s';
    const cap = document.createElement('div');
    cap.id = 'rec-caption';
    cap.style.cssText = 'position:fixed;z-index:99998;left:16px;bottom:16px;max-width:560px;padding:8px 12px;border-radius:6px;background:rgba(20,20,20,.85);color:#fff;font:14px/1.35 system-ui,sans-serif;pointer-events:none';
    document.body.append(dot, cap);
    addEventListener('mousemove', (e) => { dot.style.left = `${e.clientX}px`; dot.style.top = `${e.clientY}px`; }, true);
    addEventListener('mousedown', () => { dot.style.transform = 'scale(1.6)'; }, true);
    addEventListener('mouseup', () => { dot.style.transform = ''; }, true);
  });
});

const page = await context.newPage();
const t0 = Date.now(); // the video starts with the page
const mmss = (t = Date.now()) => { const s = Math.max(0, Math.floor((t - t0) / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const events = [];
const note = (flow, detail) => { const e = { at: mmss(), ms: Date.now() - t0, flow, ...detail }; events.push(e); console.log(e.at, flow, JSON.stringify(detail)); return e; };
const caption = (text) => page.evaluate((t) => { const c = document.getElementById('rec-caption'); if (c) c.textContent = t; }, text).catch(() => {});

// Acks as the board logs them: console.info('ack', id, ackedAt, receipt).
const acks = [];
page.on('console', async (msg) => {
  if (msg.type() !== 'info') return;
  const vals = await Promise.all(msg.args().map((a) => a.jsonValue().catch(() => null)));
  if (vals[0] !== 'ack') return;
  const a = { at: mmss(), ms: Date.now() - t0, id: vals[1], ackedAt: vals[2], receipt: vals[3] };
  acks.push(a);
  appendFileSync(`rec/${out}.acks.jsonl`, JSON.stringify(a) + '\n'); // kept at once, even if the run fails later
});
page.on('pageerror', (e) => note('error', { message: e.message }));

// Slow the first incidents call a little, so the loader is visible in the video.
let first = true;
await page.route('**/challenges/show-me-when/api/incidents**', async (route) => {
  if (first) { first = false; await new Promise((r) => setTimeout(r, loaderDelayMs)); }
  await route.continue();
});

const rows = () => page.locator('[data-testid="incident-row"]');
const topId = () => rows().first().getAttribute('data-id');
const waitForNewTop = async (before, timeoutMs = 20000) => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if ((await topId()) !== before) return topId(); await page.waitForTimeout(100); }
  throw new Error(`no new incident within ${timeoutMs} ms`);
};
const ackFor = async (id, timeoutMs = 8000) => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { const a = acks.find((x) => x.id === id); if (a) return a; await page.waitForTimeout(50); }
  throw new Error(`no ack logged for ${id}`);
};
const pointAt = async (locator) => { const b = await locator.boundingBox(); const x = b.x + b.width / 2, y = b.y + b.height / 2; await page.mouse.move(x, y, { steps: 12 }); return { x, y }; };

// ---- open-board
await page.goto(url, { waitUntil: 'domcontentloaded' });
await caption('open-board: on-call opens the board');
const loaderSeen = await page.locator('[data-testid="loader"]').isVisible().catch(() => false);
note('open-board', { loaderVisible: loaderSeen });
await rows().first().waitFor();
const sha = await page.locator('meta[name="build"]').getAttribute('content');
note('open-board', {
  rows: await rows().count(), loaderGone: (await page.locator('[data-testid="loader"]').count()) === 0,
  sha, footer: await page.locator('[data-testid="build-sha"]').textContent(),
  firstTime: await page.locator('time').first().textContent(), firstDatetime: await page.locator('time').first().getAttribute('datetime'),
});
await caption(`open-board: incidents loaded, newest first · times in ${zone} · build ${sha.slice(0, 7)} in the footer`);
await page.waitForTimeout(2500);

if (!short) {
  // ---- watch-board: a new incident arrives at the top without a reload
  await caption('watch-board: board left open, no reload; it refreshes every 2 s');
  const before = await topId();
  const arrived = await waitForNewTop(before);
  note('watch-board', { newTop: arrived, previousTop: before });
  await caption(`watch-board: ${arrived} arrived at the top without a reload`);
  await page.waitForTimeout(2000);

  if (confirmMode) {
    const confirmText = () => page.locator('[data-testid="confirm"]').innerText();
    const clickIn = async (testid) => { await pointAt(page.locator(`[data-testid="${testid}"]`)); await page.mouse.down(); await page.mouse.up(); };

    // ---- ack-incident with the confirm (R7): aim, click, read the confirm, confirm
    const target = rows().nth(2);
    const targetId = await target.getAttribute('data-id');
    await caption(`ack-incident: on-call clicks Ack on ${targetId}`);
    await pointAt(target.locator('[data-testid="ack"]'));
    await page.mouse.down(); await page.mouse.up();
    const c1 = await confirmText();
    note('ack-incident', { aimed: targetId, confirmShown: await page.locator('[data-testid="confirm"]').isVisible(), confirmNames: c1.match(/INC-\d+/)?.[0] ?? null, sentBeforeConfirm: acks.length });
    await caption(`ack-incident: the confirm names ${c1.match(/INC-\d+/)?.[0]}, the incident on-call picked, so on-call confirms`);
    await page.waitForTimeout(1800);
    await clickIn('confirm-ack');
    const a1 = await ackFor(targetId).catch(() => null);
    note('ack-incident', { confirmed: targetId, acked: a1?.id ?? null, ackLoggedAt: a1?.at ?? null, markShown: await page.locator(`[data-testid="incident-row"][data-id="${targetId}"] [data-testid="acked"]`).isVisible() });
    await caption(`ack-incident: ${targetId} acked, mark on the same row`);
    await page.waitForTimeout(2500);

    // ---- ack-incident while a new incident arrives: the confirm shows the row the click really hit
    const aimRow = rows().nth(1);
    const aimedId = await aimRow.getAttribute('data-id');
    await caption(`ack-incident: on-call points at Ack on ${aimedId} and waits a moment before clicking`);
    const p = await pointAt(aimRow.locator('[data-testid="ack"]'));
    const top = await topId();
    const newTop = await waitForNewTop(top, 25000);
    await page.waitForTimeout(150);
    const underPointer = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="incident-row"]')?.dataset.id ?? null, p);
    const sentBefore = acks.length;
    await page.mouse.down(); await page.mouse.up();
    const c2 = await confirmText();
    const named = c2.match(/INC-\d+/)?.[0] ?? null;
    note('ack-incident', { aimedAt: aimedId, newIncidentArrived: newTop, rowUnderPointerAtClick: underPointer, confirmNames: named });
    await caption(`ack-incident: ${newTop} arrived on top just before the click; the confirm names ${named}, not ${aimedId}, so on-call cancels`);
    await page.waitForTimeout(2500);
    await clickIn('confirm-cancel');
    await page.waitForTimeout(600);
    note('ack-incident', { cancelled: named, acksSentByCancel: acks.length - sentBefore, confirmOpen: await page.locator('[data-testid="confirm"]').isVisible() });
    await caption(`ack-incident: cancelled, nothing sent; on-call clicks Ack on ${aimedId} again`);
    await page.waitForTimeout(1200);
    await pointAt(page.locator(`[data-testid="incident-row"][data-id="${aimedId}"] [data-testid="ack"]`));
    await page.mouse.down(); await page.mouse.up();
    const c3 = await confirmText();
    note('ack-incident', { aimedAt: aimedId, confirmNames: c3.match(/INC-\d+/)?.[0] ?? null });
    await caption(`ack-incident: the confirm names ${c3.match(/INC-\d+/)?.[0]}, the incident on-call meant, so on-call confirms`);
    await page.waitForTimeout(1800);
    await clickIn('confirm-ack');
    const a2 = await ackFor(aimedId).catch(() => null);
    note('ack-incident', { expected: aimedId, got: a2?.id ?? null, ackLoggedAt: a2?.at ?? null, wronglyAcked: underPointer && underPointer !== aimedId ? acks.some((a) => a.id === underPointer) : false });
    await caption(`ack-incident: ${a2?.id ?? '—'} acked, the one on-call meant; ${underPointer} was not acked`);
    await page.waitForTimeout(3500);
  } else {
  // ---- ack-incident: aim at a row and click at once
  const target = rows().nth(2);
  const targetId = await target.getAttribute('data-id');
  await caption(`ack-incident: on-call acks ${targetId}`);
  await pointAt(target.locator('[data-testid="ack"]'));
  await page.mouse.down(); await page.mouse.up();
  const a1 = await ackFor(targetId).catch(() => null);
  const marked1 = await page.locator(`[data-testid="incident-row"][data-id="${targetId}"] [data-testid="acked"]`).isVisible();
  note('ack-incident', { aimed: targetId, acked: a1?.id ?? null, ackLoggedAt: a1?.at ?? null, markShown: marked1 });
  await caption(`ack-incident: ${targetId} acked, mark on the same row`);
  await page.waitForTimeout(2500);

  // ---- ack-incident while a new incident arrives: the pointer stays still, the rows move under it
  const aimRow = rows().nth(1);
  const aimedId = await aimRow.getAttribute('data-id');
  await caption(`ack-incident: on-call points at Ack on ${aimedId} and waits a moment before clicking`);
  const p = await pointAt(aimRow.locator('[data-testid="ack"]'));
  const top = await topId();
  const newTop = await waitForNewTop(top, 25000);
  await page.waitForTimeout(150); // the click lands just after the refresh, as a person's would
  const underPointer = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="incident-row"]')?.dataset.id ?? null, p);
  await page.mouse.down(); await page.mouse.up();
  const shiftClick = note('ack-incident', { aimedAt: aimedId, newIncidentArrived: newTop, rowUnderPointerAtClick: underPointer });
  const a2 = underPointer ? await ackFor(underPointer).catch(() => null) : null;
  shiftClick.acked = a2?.id ?? null; shiftClick.ackLoggedAt = a2?.at ?? null;
  await caption(`ack-incident: ${newTop} arrived on top just before the click; the rows moved down, so the click acked ${a2?.id ?? '—'}, not ${aimedId}`);
  await page.waitForTimeout(4000);
  }

  // ---- watch-board: acked marks survive the refreshes
  await page.mouse.move(1260, 700, { steps: 8 });
  await caption('watch-board: more refreshes; acked marks stay on their rows');
  await page.waitForTimeout(5000);
  note('watch-board', {
    ackedRows: await page.locator('[data-testid="acked"]').evaluateAll((els) => els.map((e) => e.closest('[data-testid="incident-row"]').dataset.id)),
    rows: await rows().count(),
  });
} else {
  await caption(`times in ${zone}: dd/mm hh:mm in the viewer's own zone; the full UTC value stays in <time datetime>`);
  await page.waitForTimeout(5000);
}

const video = await page.video().path();
writeFileSync(`rec/${out}.events.json`, JSON.stringify({ url, zone, locale, sha, loaderDelayMs, events, acks }, null, 2) + '\n');
await context.close();
await browser.close();
const file = `rec/${out}.webm`;
renameSync(video, file);
console.log(`video ${file}`);
