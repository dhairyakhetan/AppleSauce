import { expect, test, type Page } from '@playwright/test';
import { writePage } from './helpers';

/* A batch with flagged questions ("Please check") from Write questions to Approve questions and back: Copy batch, the
   cross on a note, "Approve all" asking first, the flagged box (clear, send back, the summary with Approve all and
   Undo), and the sent-back questions on Write questions shown as the batch they went back in. */

const HEAD = 'Board: CBSE\nClass: 7\nSubject: Science\nChapter 7: Heat Transfer in Nature\nTopic 1: Hot and Cold\n\n';
// two flagged (the answer repeats the word before the gap; "always" in a True/False) and one that is fine
const BATCH = HEAD + [
  'Q: What happens to a metal spoon left in hot tea\nA: Becomes hotter\nFill: A metal spoon left in hot tea slowly becomes ___ over time.\nWrong: Colder; Lighter; Softer\nLevel: easy',
  'Q: Heat always flows from a hotter body to a colder one\nA: True\nLevel: medium',
  'Q: Unit in which body temperature is usually read in India\nA: Fahrenheit\nFill: Doctors in India often read body temperature in degrees ___ today.\nWrong: Kelvin; Newton; Joule\nLevel: easy',
].join('\n\n');

/** Sends the batch from Write questions and opens Approve questions (in the page, so dummy mode keeps its data). */
async function sendAndApprove(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const box = await writePage(page);
  await box.fill(BATCH);
  await page.locator('form button[type=submit]').click();
  await expect(page.getByText(/Sent \d+ questions? for approval/).first()).toBeVisible();
  await page.getByRole('link', { name: 'Approve questions' }).first().click();
  const batch = page.locator('section[aria-label^="Batch from"]').filter({ hasText: 'Becomes hotter' });
  await expect(batch).toBeVisible();
  return batch;
}

test('Approve all on a batch with flagged questions asks first, and View them shows only those', async ({ page }) => {
  const batch = await sendAndApprove(page);
  await batch.getByRole('button', { name: /^Approve all 3/ }).click();
  const ask = page.getByRole('dialog');
  await expect(ask).toContainText('There are 2 flagged questions in this batch');
  await ask.getByRole('button', { name: 'View them' }).click();
  const box = page.getByRole('dialog');
  await expect(box).toContainText('2 flagged questions');
  await expect(box).toContainText('Becomes hotter');
  await expect(box).toContainText('Heat always flows');
  await expect(box).not.toContainText('Fahrenheit');
});

test('clearing one and sending the other back, then Approve all the rest', async ({ page }) => {
  const batch = await sendAndApprove(page);
  await batch.getByRole('button', { name: /^Approve all 3/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'View them' }).click();
  const box = page.getByRole('dialog');
  await box.getByRole('button', { name: /^Clear: please check/ }).first().click();
  await expect(box).toContainText('1 flagged question');
  await box.getByRole('button', { name: 'Send all back' }).click();
  await box.getByLabel(/going back/).fill('The answer repeats a word of the sentence.');
  await box.getByRole('button', { name: 'Send 1 back' }).click();
  await expect(box).toContainText('1 question sent back');
  await expect(box).toContainText('1 question cleared');
  await box.getByRole('button', { name: 'Approve all 2' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(batch).toHaveCount(0); // nothing of it is waiting any more
});

test('Undo in the summary puts the questions and their notes back', async ({ page }) => {
  const batch = await sendAndApprove(page);
  await batch.getByRole('button', { name: /^Approve all 3/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'View them' }).click();
  const box = page.getByRole('dialog');
  await box.getByRole('button', { name: 'Clear all' }).click();
  await expect(box).toContainText('2 questions cleared');
  await box.getByRole('button', { name: 'Undo' }).click();
  await expect(box).toContainText('2 flagged questions');
});

test('Approve all anyway approves the whole batch', async ({ page }) => {
  const batch = await sendAndApprove(page);
  await batch.getByRole('button', { name: /^Approve all 3/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve all anyway' }).click();
  await expect(batch).toHaveCount(0);
});

test('the cross on a note hides it until the page is opened again', async ({ page }) => {
  const batch = await sendAndApprove(page);
  const notes = batch.getByText('Please check:');
  await expect(notes).toHaveCount(2);
  await batch.getByRole('button', { name: /^Clear: please check/ }).first().click();
  await expect(notes).toHaveCount(1);
  // with one note left, Approve all still asks, about one
  await batch.getByRole('button', { name: /^Approve all 3/ }).click();
  await expect(page.getByRole('dialog')).toContainText('There is 1 flagged question in this batch');
});

test('Copy batch copies its questions as text', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const batch = await sendAndApprove(page);
  await batch.getByRole('button', { name: 'Copy batch' }).click();
  await expect(batch.getByRole('button', { name: 'Copied' })).toBeVisible();
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('Chapter 7: Heat Transfer in Nature');
  expect(text).toContain('A: Becomes hotter');
  expect(text).toContain('A: Fahrenheit');
});

test('questions sent back together show on Write questions as one batch, with its reason', async ({ page }) => {
  const batch = await sendAndApprove(page);
  await batch.getByRole('button', { name: /^Approve all 3/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'View them' }).click();
  const box = page.getByRole('dialog');
  await box.getByRole('button', { name: 'Send all back' }).click();
  await box.getByLabel(/going back/).fill('Both need another look.');
  await box.getByRole('button', { name: 'Send 2 back' }).click();
  await box.getByRole('button', { name: 'Approve all 1' }).click();
  await page.getByRole('link', { name: 'Write questions' }).first().click();
  const panel = page.locator('section[aria-labelledby="back-h"]');
  await panel.getByRole('button', { name: 'See why' }).click();
  const group = panel.getByRole('listitem').filter({ hasText: 'Both need another look.' });
  await expect(group).toHaveCount(1);
  await expect(group).toContainText('2 questions from one batch, sent back together');
  await group.getByText('Show the 2 questions').click();
  await expect(group).toContainText('Becomes hotter');
  await group.getByRole('button', { name: 'Fix them in the Questions box' }).click();
  await expect(page.locator('textarea#q')).toHaveValue(/A: Becomes hotter[\s\S]*A: True/);
});
