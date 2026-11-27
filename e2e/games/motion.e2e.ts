import { expect, test, type Locator, type Page } from '@playwright/test';
import { writePage } from './helpers';

/* Motion that has to be right, measured: a pick's typing never flashes an error, the tabs' highlight glides, and parts
   that open and close grow and shrink from where they are (a second click mid-way turns them around, no jump). */

const pillX = (row: Locator) => row.locator(':scope > span[aria-hidden]').first().evaluate((n) => new DOMMatrix(getComputedStyle(n).transform).m41);

test('picking a board shows no error while its line is typed in', async ({ page }) => {
  await writePage(page);
  await page.locator('#d-board').click();
  await page.getByRole('option', { name: 'CBSE', exact: true }).first().click();
  const seen: string[] = [];
  for (let i = 0; i < 30; i++) {
    const t = await page.locator('section[aria-labelledby="out-h"]').innerText();
    if (/Did you mean|isn't a board|problems? to fix/i.test(t)) seen.push(t.slice(0, 120));
    await page.waitForTimeout(25);
  }
  expect(seen).toEqual([]);
  await expect(page.locator('textarea#q')).toHaveValue(/^Board: CBSE\s*$/);
});

async function approveTabs(page: Page) {
  await writePage(page);
  await page.getByRole('link', { name: 'Approve questions' }).first().click();
  const row = page.getByRole('tablist', { name: 'Questions' });
  await expect(row).toBeVisible();
  await page.waitForTimeout(400);
  return row;
}

test('the tabs\' highlight glides to the tab chosen', async ({ page }) => {
  const row = await approveTabs(page);
  const from = await pillX(row);
  await row.getByRole('tab', { name: /Sent back/ }).click();
  await page.waitForTimeout(70);
  const mid = await pillX(row);
  await page.waitForTimeout(500);
  const to = await pillX(row);
  expect(to).toBeGreaterThan(from);
  expect(mid).toBeGreaterThan(from); // on its way
  expect(mid).toBeLessThan(to);
});

test('with reduced motion the highlight moves at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const row = await approveTabs(page);
  await row.getByRole('tab', { name: /Sent back/ }).click();
  await page.waitForTimeout(40);
  const now = await pillX(row);
  await page.waitForTimeout(400);
  expect(await pillX(row)).toBe(now);
});

test('the sent-back list grows open, and turns around mid-way without a jump', async ({ page }) => {
  await writePage(page);
  const panel = page.locator('section[aria-labelledby="back-h"]');
  await panel.getByRole('button', { name: 'See why' }).click();
  const list = panel.locator('#back-list').locator('..');
  await page.waitForTimeout(80);
  const opening = await list.evaluate((n) => n.getBoundingClientRect().height);
  await page.waitForTimeout(500);
  const open = await list.evaluate((n) => n.getBoundingClientRect().height);
  expect(opening).toBeGreaterThan(0);
  expect(opening).toBeLessThan(open); // growing, not all at once
  // close, and open again half-way: it carries on from where it was
  await panel.getByRole('button', { name: 'Hide' }).click();
  await page.waitForTimeout(90);
  const closing = await list.evaluate((n) => n.getBoundingClientRect().height);
  await panel.getByRole('button', { name: 'See why' }).click();
  const turned = await list.evaluate((n) => n.getBoundingClientRect().height);
  expect(closing).toBeLessThan(open);
  expect(Math.abs(turned - closing)).toBeLessThan(open * 0.25); // no jump back to the top or bottom
  await expect.poll(() => list.evaluate((n) => Math.round(n.getBoundingClientRect().height)), { timeout: 2000 }).toBe(Math.round(open));
});
