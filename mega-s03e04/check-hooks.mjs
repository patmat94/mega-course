// Checks the plan's pinned data-testid hooks on the live board, and the empty state with an empty incidents answer.
// Sends no ack. Usage: node check-hooks.mjs <board url>
import { chromium } from 'playwright';
const url = process.argv[2];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const out = {};
{
  const page = await browser.newPage();
  await page.goto(url);
  await page.locator('[data-testid="incident-row"]').first().waitFor();
  for (const id of ['board', 'loader', 'empty', 'incident-list', 'incident-row', 'ack', 'acked', 'build-sha']) out[id] = await page.locator(`[data-testid="${id}"]`).count();
  out.rowsWithDataId = await page.locator('[data-testid="incident-row"][data-id]').count();
  out.metaBuild = await page.locator('meta[name="build"]').getAttribute('content');
  out.footer = await page.locator('[data-testid="build-sha"]').textContent();
  out.datetimeIsUtc = await page.locator('time').evaluateAll((ts) => ts.every((t) => /Z$/.test(t.getAttribute('datetime')) && !/Z$/.test(t.textContent)));
  await page.close();
}
{
  const page = await browser.newPage();
  await page.route('**/challenges/show-me-when/api/incidents**', (r) => r.fulfill({ json: { updatedAt: new Date().toISOString(), incidents: [], cursor: 'x' } }));
  await page.goto(url);
  await page.locator('[data-testid="empty"]').waitFor({ state: 'visible' });
  out.emptyCase = { emptyVisible: await page.locator('[data-testid="empty"]').isVisible(), loader: await page.locator('[data-testid="loader"]').count(), listHidden: await page.locator('[data-testid="incident-list"]').isHidden() };
  await page.close();
}
await browser.close();
console.log(JSON.stringify(out));
