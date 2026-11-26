import { expect, test, type Page } from '@playwright/test';
import { writePage } from './helpers';

/* Picking Board, Class, Subject and Chapter from the dropdowns: the line is typed in, and changing a chapter detail when
   the box has questions of your own asks whether to clear them. */

const pick = async (page: Page, id: string, option: string | RegExp) => {
  await page.locator(id).click();
  await page.getByRole('option', typeof option === 'string' ? { name: option, exact: true } : { name: option }).first().click();
};
const chooseHeat = async (page: Page) => {
  await pick(page, '#d-board', 'CBSE');
  await pick(page, '#d-class', '7');
  await pick(page, '#d-subject', 'Science');
  await pick(page, '#d-chapter', /Heat Transfer in Nature/);
};
const MINE = 'Q: Instrument that measures temperature\nA: Thermometer\nLevel: easy';

test('a pick types its line in, like a person, and the box is read-only until it has', async ({ page }) => {
  const box = await writePage(page);
  await pick(page, '#d-board', 'CBSE');
  const first = (await box.inputValue()).trim();
  expect(first).not.toBe('Board: CBSE'); // not all at once
  expect('Board: CBSE'.startsWith(first)).toBe(true);
  await expect(box).toHaveValue(/^Board: CBSE\s*$/);
  await expect(box).not.toHaveAttribute('readonly', '');
});

test.describe('changing a chapter detail', () => {
  test.beforeEach(async ({ page }) => { await page.emulateMedia({ reducedMotion: 'reduce' }); });

  test('with questions of your own, it asks; Clear and change starts on the new chapter', async ({ page }) => {
    const box = await writePage(page);
    await chooseHeat(page);
    await box.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(`\n\n${MINE}`);
    await pick(page, '#d-chapter', /Life Processes in Animals/);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Clear your questions');
    await dialog.getByRole('button', { name: 'Clear and change' }).click();
    await expect(box).not.toHaveValue(/Thermometer/);
    await expect(box).toHaveValue(/Chapter 9: Life Processes in Animals/);
    // and it can be undone
    await page.getByRole('button', { name: 'Undo' }).last().click();
    await expect(box).toHaveValue(/Thermometer/);
  });

  test('Keep them changes the chapter and keeps the questions; Cancel changes nothing', async ({ page }) => {
    const box = await writePage(page);
    await chooseHeat(page);
    await box.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(`\n\n${MINE}`);
    const before = await box.inputValue();
    await pick(page, '#d-chapter', /Life Processes in Animals/);
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(box).toHaveValue(before);
    await pick(page, '#d-chapter', /Life Processes in Animals/);
    await page.getByRole('dialog').getByRole('button', { name: 'Keep them' }).click();
    await expect(box).toHaveValue(/Chapter 9: Life Processes in Animals[\s\S]*Thermometer/);
  });

  test('the example\'s questions are cleared without asking', async ({ page }) => {
    const box = await writePage(page);
    await page.getByRole('button', { name: 'Try an example' }).click();
    await expect(box).toHaveValue(/Q: /);
    await pick(page, '#d-class', '8');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(box).not.toHaveValue(/Q: /);
    await expect(box).toHaveValue(/Class: 8/);
  });

  test('setting a detail for the first time never asks', async ({ page }) => {
    const box = await writePage(page);
    await box.fill(MINE);
    await pick(page, '#d-board', 'CBSE');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(box).toHaveValue(/Board: CBSE[\s\S]*Thermometer/);
  });
});

test('a topic button types its Topic line in, then puts the cursor under it', async ({ page }) => {
  const box = await writePage(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await chooseHeat(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const topic = page.getByRole('button', { name: /Hot and Cold/ }).first();
  await topic.click();
  await expect(box).toHaveValue(/Topic 1: Hot and Cold\n/);
  await expect(box).toBeFocused();
  await page.keyboard.type('Q: x');
  await expect(box).toHaveValue(/Topic 1: Hot and Cold\nQ: x/);
});
