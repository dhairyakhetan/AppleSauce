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
  // close, and open again half-way: it carries on from where it was. Timed in the page itself (a frame at a time), so a
  // slow machine can't make the test miss the half-way point.
  const { closing, turned } = await panel.evaluate(async (section, full) => {
    const box = section.querySelector('#back-list')!.parentElement!;
    const button = (name: string) => [...section.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)!;
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    button('Hide').click();
    let h = full;
    for (let i = 0; i < 60 && !(h < full * 0.8 && h > full * 0.2); i++) { await frame(); h = box.getBoundingClientRect().height; }
    button('See why').click();
    await frame();
    return { closing: h, turned: box.getBoundingClientRect().height };
  }, open);
  expect(closing).toBeLessThan(open * 0.8);
  expect(closing).toBeGreaterThan(open * 0.2);
  expect(Math.abs(turned - closing)).toBeLessThan(open * 0.25); // no jump back to the top or bottom
  await expect.poll(() => list.evaluate((n) => Math.round(n.getBoundingClientRect().height)), { timeout: 2000 }).toBe(Math.round(open));
});

/** Every frame's top, from the frame before `act` to when it settles, measured in the page. */
const framesOf = (page: Page, sel: string, act: string) => page.evaluate(async ([sel, act]) => {
  const el = document.querySelector(sel)!;
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const tops = [Math.round(el.getBoundingClientRect().top)];
  new Function(act)();
  for (let i = 0; i < 45; i++) { await frame(); tops.push(Math.round(el.getBoundingClientRect().top)); }
  return tops;
}, [sel, act] as const);
/** Moves one way only, in steps, with no frame jumping more than `most` px (a jump is one big step). */
const smooth = (tops: number[], most: number) => {
  const steps = tops.slice(1).map((t, i) => t - tops[i]).filter((d) => d !== 0);
  expect(steps.length, `tops ${tops.join(' ')}`).toBeGreaterThan(3);
  expect(steps.every((d) => Math.sign(d) === Math.sign(steps[0])), `tops ${tops.join(' ')}`).toBe(true);
  expect(Math.max(...steps.map(Math.abs)), `tops ${tops.join(' ')}`).toBeLessThan(most);
};
/** A press as a person makes it (pointer down, then click) on the button whose words start with `label`, in `within`. */
const press = (label: string, within = 'document') =>
  `const b = [...${within}.querySelectorAll('button')].find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)})); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); b.click();`;

test('opening and closing "See why" moves what is below it smoothly, with no jump at the start or end', async ({ page }) => {
  await writePage(page);
  await page.waitForTimeout(400);
  const below = 'section[aria-labelledby="back-h"] + *';
  const open = await framesOf(page, below, press('See why'));
  smooth(open, 260);
  await page.waitForTimeout(300);
  smooth(await framesOf(page, below, press('Hide')), 260);
});

test('approving a batch slides the batches below it up, instead of a jump', async ({ page }) => {
  await writePage(page);
  await page.getByRole('link', { name: 'Approve questions' }).first().click();
  await expect(page.locator('section[aria-label="Batch from Rohan Mehta"]')).toBeVisible();
  await page.waitForTimeout(500);
  const tops = await framesOf(page, 'section[aria-label="Batch from Rohan Mehta"]',
    press('Approve all', 'document.querySelector(\'section[aria-label="Batch from Priya Das"]\')'));
  smooth(tops, 400);
});
