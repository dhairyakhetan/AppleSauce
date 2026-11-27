import { expect, test, type Page } from '@playwright/test';
import { open } from './helpers';

/* Try the games: the dropdowns, demo mode, and how the crossword, fill in the blank and word search play. */

async function play(page: Page, game: string) {
  await open(page, '/games/play');
  await expect(page.getByText('What are you revising?')).toBeVisible();
  await page.getByRole('tab', { name: game }).click();
  return page.locator('section[aria-label="Puzzle"]');
}

test('picks the chapter with the same dropdowns as Write questions, highest class first', async ({ page }) => {
  await open(page, '/games/play');
  for (const name of ['Board', 'Class', 'Subject', 'Chapter']) await expect(page.getByRole('button', { name: new RegExp(`^${name}:`) })).toBeVisible();
  await page.getByRole('button', { name: /^Class:/ }).click();
  const classes = (await page.getByRole('option').allInnerTexts()).map((t) => Number(t.replace(/\D+/g, '')));
  expect(classes).toEqual([...classes].sort((a, b) => b - a));
});

test('with nothing approved, it plays sample questions and says demo mode', async ({ page }) => {
  await open(page, '/games/play');
  await expect(page.getByText('(demo mode)')).toHaveCount(0);
  await page.getByRole('button', { name: 'No approved questions' }).click();
  await expect(page.getByText('(demo mode)')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Chapter:/ })).toContainText('Chemical Reactions and Equations');
  await expect(page.locator('section[aria-label="Puzzle"] [role="tab"][aria-disabled="true"]')).toHaveCount(0); // all five games
});

test('the crossword marks nothing until every square is filled, and Enter goes to the next unanswered clue', async ({ page }) => {
  const puzzle = await play(page, 'Crossword');
  const bar = puzzle.locator('p[aria-live="polite"]').first();
  await puzzle.locator('.games-cw-cell:not(.is-block)').first().click();
  const first = await bar.innerText();
  // a wrong letter shows nothing yet
  await page.keyboard.type('Q');
  await expect(puzzle.locator('.games-cw-cell.bad')).toHaveCount(0);
  // Enter: another clue, one with a square still empty
  await page.keyboard.press('Enter');
  await expect(bar).not.toHaveText(first);
  // fill every word but one (Reveal word, then Enter on to the next unanswered)
  const clues = await puzzle.locator('button[data-n]').count();
  const progress = puzzle.locator('[role="progressbar"]');
  for (let i = 0; i < clues * 2 && Number(await progress.getAttribute('aria-valuenow')) < clues - 1; i++) {
    await puzzle.getByRole('button', { name: 'Reveal word' }).click();
    await page.keyboard.press('Enter');
  }
  await expect(progress).toHaveAttribute('aria-valuenow', String(clues - 1));
  await expect(puzzle.locator('.games-cw-cell.bad')).toHaveCount(0);
  // the last word, typed wrong: now every square is filled, and it is checked
  for (let i = 0; i < 30 && Number(await progress.getAttribute('aria-valuenow')) < clues; i++) await page.keyboard.type('Q');
  await expect(puzzle.getByText(/letters? (is|are) wrong/)).toBeVisible();
  await expect(puzzle.locator('.games-cw-cell.bad')).not.toHaveCount(0);
  // every square filled: Enter goes to a word with a wrong letter, onto its first wrong square
  await puzzle.locator('button[data-n]').first().click();
  await page.keyboard.press('Enter');
  await expect(puzzle.locator('.games-cw-cell.cur.bad')).toHaveCount(1);
  // put it right: complete
  await puzzle.getByRole('button', { name: 'Reveal word' }).click();
  await expect(page.getByText('Crossword complete!')).toBeVisible();
});

test('fill in the blank: Enter goes to the next empty gap, and answers are checked once every gap is filled', async ({ page }) => {
  const puzzle = await play(page, 'Fill in the blank');
  const gaps = puzzle.getByRole('textbox', { name: 'Answer' });
  const n = await gaps.count();
  const check = puzzle.getByRole('button', { name: 'Check answers' });
  await expect(check).toBeDisabled();
  await gaps.nth(0).fill('first try');
  await gaps.nth(0).press('Enter');
  await expect(gaps.nth(1)).toBeFocused();
  // nothing is marked yet
  await expect(puzzle.getByLabel('Right')).toHaveCount(0);
  for (let i = 1; i < n; i++) await gaps.nth(i).fill('a guess');
  await expect(check).toBeEnabled();
  await gaps.nth(n - 1).press('Enter'); // the last gap filled: Enter checks them all
  await expect(puzzle.locator('input.border-destructive')).not.toHaveCount(0);
});

test('word search: the highlight follows the pointer between letters, and settles or fades on letting go', async ({ page }) => {
  const puzzle = await play(page, 'Word search');
  const grid = puzzle.locator('.games-ws-grid');
  const b = (await grid.boundingBox())!;
  const cell = b.width / Number(await grid.evaluate((g) => getComputedStyle(g).getPropertyValue('--n')));
  const cap = grid.locator('.games-ws-cap:not(.is-found)');
  await page.mouse.move(b.x + cell * 0.5, b.y + cell * 0.5);
  await page.mouse.down();
  const widths: number[] = [];
  for (const x of [1.2, 1.5, 1.9, 2.4]) {
    await page.mouse.move(b.x + cell * x, b.y + cell * 0.5);
    widths.push(await cap.evaluate((n) => n.getBoundingClientRect().width));
  }
  // grows with the pointer, by less than a whole letter at a time (it isn't stepping from letter to letter)
  expect(widths.every((w, i) => i === 0 || w > widths[i - 1])).toBe(true);
  expect(widths[1] - widths[0]).toBeLessThan(cell * 0.6);
  await page.mouse.up();
  // a word or not, nothing is left half-drawn
  await expect(cap).toHaveCount(0, { timeout: 2000 });
});

test('the crossword\'s clue list and grid stay put as the clue changes', async ({ page }) => {
  const puzzle = await play(page, 'Crossword');
  await puzzle.locator('.games-cw-cell:not(.is-block)').first().click();
  const at = async () => {
    const l = (await puzzle.locator('h4').first().boundingBox())!;
    const g = (await puzzle.locator('.games-cw-grid').boundingBox())!;
    return `${Math.round(l.x)},${Math.round(g.y)}`;
  };
  const first = await at();
  for (let i = 0; i < 6; i++) { await page.keyboard.press('Enter'); expect(await at()).toBe(first); }
});

test('multiple choice: each question its own card, its options lettered choices', async ({ page }) => {
  const puzzle = await play(page, 'Multiple choice');
  const cards = puzzle.locator('ol > li');
  const n = await cards.count();
  await expect(cards.first()).toContainText(`1 of ${n}`);
  await expect(cards.first().getByRole('group').getByRole('button', { name: /^A: / })).toBeVisible();
});

test('matching: a matched pair shows its partner on both sides; a wrong pair doesn\'t match', async ({ page }) => {
  const puzzle = await play(page, 'Matching');
  const qs = puzzle.getByRole('list', { name: 'Questions' }).getByRole('button');
  const id = await qs.first().getAttribute('data-id');
  const answer = puzzle.locator(`ul[aria-label="Answers"] button[data-id="${id}"]`);
  const other = puzzle.locator(`ul[aria-label="Answers"] button:not([data-id="${id}"])`).first();
  await qs.first().click();
  await other.click();
  await expect(qs.first()).toBeEnabled(); // not matched
  await qs.first().click();
  await answer.click();
  await expect(qs.first()).toHaveAttribute('aria-label', /matched with [A-Z]$/);
  await expect(answer).toHaveAttribute('aria-label', /matched with 1$/);
  await expect(puzzle.locator('[role="progressbar"]')).toHaveAttribute('aria-valuenow', '1');
});

test('on a phone the crossword and word search fit inside the card, and the game tabs stay on one row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [game, grid] of [['Crossword', '.games-cw-cell'], ['Word search', '.games-ws-cell']] as const) {
    const puzzle = await play(page, game);
    const card = (await puzzle.boundingBox())!;
    const right = await puzzle.locator(grid).evaluateAll((cells) => Math.max(...cells.map((c) => c.getBoundingClientRect().right)));
    expect(right).toBeLessThanOrEqual(card.x + card.width);
    const tops = await page.getByRole('tab', { name: /Crossword|Word search|Matching|Fill in the blank|Multiple choice/ })
      .evaluateAll((tabs) => new Set(tabs.map((t) => Math.round(t.getBoundingClientRect().top))).size);
    expect(tops).toBe(1);
  }
});
