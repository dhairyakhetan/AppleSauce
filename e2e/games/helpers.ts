import { expect, type Page } from '@playwright/test';

/** A /games page in dummy mode, with the test build's preview panel out of the way. */
export async function open(page: Page, path = '/games') {
  await page.goto(`${path}?dummy=1`);
  await page.addStyleTag({ content: '[aria-label^="Preview role toggle"] { display: none !important }' });
}

/** Write questions, ready to type in. */
export async function writePage(page: Page) {
  await open(page);
  const box = page.locator('textarea#q');
  await expect(box).toBeVisible();
  return box;
}

/** The line of the Questions box that starts with `start`. */
export async function lineOf(page: Page, start: string) {
  return (await page.locator('textarea#q').inputValue()).split('\n').find((l) => l.startsWith(start));
}

/** Somewhere on the page that isn't a control: the box loses focus. */
export async function clickAway(page: Page) {
  await page.locator('h1').first().click();
}

/** Longer than the autocorrect's one-second pause. */
export const PAUSE = 1_500;
