import { expect, test } from '@playwright/test';
import { clickAway, lineOf, open, PAUSE, writePage } from './helpers';

/* Write questions in a real browser: the autocorrect, Undo, the dropdowns, sent-back questions and the preview. */

test.describe('the autocorrect', () => {
  test('tidies labels and levels after a pause, never the words', async ({ page }) => {
    const box = await writePage(page);
    await box.click();
    await page.keyboard.type('q1: How heat moves through a metal spoon\na: Conduction\nLevel: Easy.\n');
    await page.waitForTimeout(PAUSE);
    await expect(box).toHaveValue(/^Q: How heat moves through a metal spoon\nA: Conduction\nLevel: easy\n/);
  });

  test('Ctrl+Z takes a fix back for good, and typing after it loses nothing', async ({ page }) => {
    const box = await writePage(page);
    await box.click();
    await page.keyboard.type('Q: Colours of a flag\nA: Red\nWrong: Blue, Green, Gold\nLevel: easy');
    await page.waitForTimeout(PAUSE);
    expect(await lineOf(page, 'Wrong')).toBe('Wrong: Blue; Green; Gold');
    await page.keyboard.press('Control+z');
    expect(await lineOf(page, 'Wrong')).toBe('Wrong: Blue, Green, Gold');
    await page.waitForTimeout(PAUSE);
    expect(await lineOf(page, 'Wrong')).toBe('Wrong: Blue, Green, Gold');
    await page.keyboard.type('x');
    await page.waitForTimeout(PAUSE);
    expect(await lineOf(page, 'Wrong')).toBe('Wrong: Blue, Green, Gold');
    await expect(box).toHaveValue(/Level: easyx$/);
  });

  test('a fix made on leaving the box has its own Undo, which sticks', async ({ page }) => {
    const box = await writePage(page);
    await box.click();
    await page.keyboard.type('Q: Capital of France\nA: Paris\nWrong: Rome, Berlin, Madrid');
    await clickAway(page);
    expect(await lineOf(page, 'Wrong')).toBe('Wrong: Rome; Berlin; Madrid');
    await page.getByRole('button', { name: 'Undo' }).last().click();
    expect(await lineOf(page, 'Wrong')).toBe('Wrong: Rome, Berlin, Madrid');
    await box.click();
    await page.waitForTimeout(PAUSE);
    await clickAway(page);
    expect(await lineOf(page, 'Wrong')).toBe('Wrong: Rome, Berlin, Madrid');
  });

  test('leaves what it can\'t be sure of: a topic whose number and name disagree, an option with a comma inside', async ({ page }) => {
    const box = await writePage(page);
    const text = [
      'Board: CBSE', 'Class: 7', 'Subject: Science', 'Chapter 7: Heat Transfer in Nature', 'Topic 2: Hot and Cold', '',
      'Q: Metal mixed from copper and tin', 'A: Bronze', 'Wrong: Copper, zinc and tin, Wood, Glass', 'Level: easy',
    ].join('\n');
    await box.fill(text);
    await box.click();
    await page.waitForTimeout(PAUSE);
    await clickAway(page);
    await expect(box).toHaveValue(text);
  });

  test('Undo on Try an example brings back your text, and no example chapter lines come back with it', async ({ page }) => {
    const box = await writePage(page);
    const mine = 'Q: Capital of France\nA: Paris\nLevel: easy';
    await box.fill(mine);
    await page.getByRole('button', { name: 'Try an example' }).click();
    const replace = page.getByRole('button', { name: /Replace/ });
    if (await replace.count()) await replace.first().click();
    await expect(box).not.toHaveValue(mine);
    await page.getByRole('button', { name: 'Undo' }).last().click();
    await expect(box).toHaveValue(mine);
    await box.click();
    await page.waitForTimeout(PAUSE);
    await clickAway(page);
    await expect(box).toHaveValue(mine);
  });
});

test('the same problem on several lines is listed once, with every line it is on', async ({ page }) => {
  const box = await writePage(page);
  const qs = ['Thermometer', 'Kelvin', 'Mercury'].map((a, i) => `Q: Question ${i + 1} about temperature\nA: ${a}\nWrong: One; Two; Three\nLevel: easy`);
  await box.fill('Board: CBSE\nClass: 7\nSubject: Science\nChapter 7: Heat Transfer in Nature\n\n' + qs.join('\n\n'));
  await clickAway(page);
  const entry = page.getByRole('listitem').filter({ hasText: 'No Fill: line' });
  await expect(entry).toHaveCount(1);
  await expect(entry.getByRole('button', { name: /^Line \d+: go to it$/ })).toHaveCount(3);
});

test.describe('the dropdowns', () => {
  test('each waits for the one before, and a pick writes its line', async ({ page }) => {
    const box = await writePage(page);
    await expect(page.locator('#d-class')).toBeDisabled();
    const pick = async (id: string, option: string) => {
      await page.locator(id).click();
      await page.getByRole('option', { name: option, exact: true }).first().click();
    };
    await pick('#d-board', 'CBSE');
    await expect(page.locator('#d-class')).toBeEnabled();
    await pick('#d-class', '7');
    await pick('#d-subject', 'Science');
    await page.locator('#d-chapter').click();
    await page.getByRole('option', { name: /Heat Transfer in Nature/ }).first().click();
    await expect(box).toHaveValue(/Board: CBSE\nClass: 7\nSubject: Science\nChapter 7: Heat Transfer in Nature/);
  });

  test('a long list in the chatbot prompt dialog stays on screen and scrolls', async ({ page }) => {
    await writePage(page);
    await page.getByRole('button', { name: /Copy chatbot prompt/ }).first().click();
    const dialog = page.getByRole('dialog').first();
    await dialog.getByRole('button', { name: /Board/ }).first().click();
    await page.getByRole('option', { name: 'CBSE', exact: true }).first().click();
    await dialog.getByRole('button', { name: /Class/ }).first().click();
    await page.getByRole('option', { name: '11', exact: true }).first().click();
    await dialog.getByRole('button', { name: /Subject/ }).first().click();
    const list = page.getByRole('listbox').last();
    const box = (await list.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => list.evaluate((n) => n.scrollTop)).toBeGreaterThan(0);
  });
});

test.describe('questions sent back', () => {
  test('one removed with the cross stays gone, also after a reload', async ({ page }) => {
    const box = await writePage(page);
    const panel = page.locator('section[aria-labelledby="back-h"]');
    await panel.getByRole('button', { name: 'See why' }).click();
    const items = panel.getByRole('button', { name: 'Remove from this list' });
    const before = await items.count();
    expect(before).toBeGreaterThan(0);
    // put it in the box, unchanged, before removing it
    await panel.getByRole('button', { name: 'Fix it in the Questions box' }).first().click();
    await expect(box).toHaveValue(/Q: /);
    await items.first().click();
    await expect(items).toHaveCount(before - 1);
    await page.reload();
    await page.addStyleTag({ content: '[aria-label^="Preview role toggle"] { display: none !important }' });
    // removed for good on this device: not back after a reload
    const after = page.locator('section[aria-labelledby="back-h"]');
    if (await after.count()) {
      await after.getByRole('button', { name: 'See why' }).click();
      await expect(after.getByRole('button', { name: 'Remove from this list' })).toHaveCount(before - 1);
    }
  });

  test('sending a removed one again unchanged brings it back, with See why', async ({ page }) => {
    const box = await writePage(page);
    const panel = page.locator('section[aria-labelledby="back-h"]');
    await panel.getByRole('button', { name: 'See why' }).click();
    const items = panel.getByRole('button', { name: 'Remove from this list' });
    const before = await items.count();
    // a question sent back on its own: put it in the box, unchanged, then remove it from the list
    const one = panel.getByRole('listitem').filter({ has: page.getByRole('button', { name: 'Fix it in the Questions box' }) }).first();
    await one.getByRole('button', { name: 'Fix it in the Questions box' }).click();
    await expect(box).toHaveValue(/Q: /);
    await one.getByRole('button', { name: 'Remove from this list' }).click();
    await expect(items).toHaveCount(before - 1);
    // keep only the first question block (the one sent back), unchanged
    const text = await box.inputValue();
    const firstQ = text.indexOf('\nQ: ');
    const secondQ = text.indexOf('\nQ: ', firstQ + 1);
    const head = text.slice(0, firstQ);
    const block = text.slice(firstQ, secondQ < 0 ? undefined : secondQ).replace(/\n+Topic[^\n]*\s*$/, '');
    await box.fill(`${head}${block}`.trim());
    await page.locator('form button[type=submit]').click();
    await expect(page.getByText(/sent back to you before and hasn't changed/)).toBeVisible();
    await page.getByRole('button', { name: 'See why' }).last().click();
    await expect(panel.getByRole('button', { name: 'Remove from this list' })).toHaveCount(before);
  });
});

test.describe('the preview', () => {
  test('tapping a greyed-out game says what it needs', async ({ page }) => {
    const box = await writePage(page);
    await box.fill('Board: CBSE\nClass: 7\nSubject: Science\nChapter 7: Heat Transfer in Nature\nTopic 1: Hot and Cold\n\n'
      + ['Thermometer', 'Celsius', 'Mercury', 'Kelvin', 'Fahrenheit'].map((a, i) => `Q: Question ${i + 1} about temperature\nA: ${a}\nLevel: easy`).join('\n\n'));
    const tab = page.getByRole('tab', { name: 'Fill in the blank' });
    await expect(tab).toHaveAttribute('aria-disabled', 'true');
    // a tap: Playwright won't click a tab marked aria-disabled, but a finger can
    await tab.scrollIntoViewIfNeeded();
    const at = (await tab.boundingBox())!;
    await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
    await expect(page.getByRole('status').filter({ hasText: 'Fill in the blank: Needs a question with a Fill: line' })).toBeVisible();
  });
});

test('the page loads with no errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page);
  await expect(page.locator('textarea#q')).toBeVisible();
  expect(errors).toEqual([]);
});
