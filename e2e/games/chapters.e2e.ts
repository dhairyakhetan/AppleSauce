import { expect, test } from '@playwright/test';
import { open } from './helpers';

/* The Chapters page's Bulk add and Bulk remove, in a real browser (dummy mode, signed in as an admin). */

test.beforeEach(async ({ page }) => {
  await open(page, '/games/chapters');
  await expect(page.locator('#bulk-text')).toBeVisible();
});

test('Bulk remove has its own text: a list written to add is never read as one to delete', async ({ page }) => {
  await page.locator('#bulk-text').fill('Board: CBSE\nClass: 9\nSubject: Mathematics');
  await page.getByRole('button', { name: 'Switch to Bulk remove' }).click();
  await expect(page.locator('#bulk-text')).toHaveValue('');
  await page.getByRole('button', { name: /Back to Bulk add/ }).click();
  await expect(page.locator('#bulk-text')).toHaveValue('Board: CBSE\nClass: 9\nSubject: Mathematics');
});

test('Bulk remove asks twice, and changing the text disarms it', async ({ page }) => {
  await page.getByRole('button', { name: 'Switch to Bulk remove' }).click();
  await page.locator('#bulk-text').fill('Board: CBSE\nClass: 9\nSubject: Mathematics\n1');
  const first = page.getByRole('button', { name: /^Delete 1 chapter/ });
  await first.click();
  await expect(page.getByRole('button', { name: /^Yes, delete 1 chapter/ })).toBeVisible();
  await page.locator('#bulk-text').fill('Board: CBSE\nClass: 9\nSubject: Mathematics\n2');
  await expect(page.getByRole('button', { name: /^Delete 1 chapter/ })).toBeVisible();
});

test('a block with no chapter lines removes the whole subject, even if another block names one', async ({ page }) => {
  await page.getByRole('button', { name: 'Switch to Bulk remove' }).click();
  await page.locator('#bulk-text').fill('Board: CBSE\nClass: 9\nSubject: Mathematics\n\nBoard: CBSE\nClass: 9\nSubject: Mathematics\n4');
  await expect(page.getByRole('button', { name: /^Delete 14 chapters/ })).toBeVisible();
});

test('Bulk add takes Subject before Class', async ({ page }) => {
  await page.locator('#bulk-text').fill('Board: CBSE\nSubject: Mathematics\nClass: 9\n15. A new chapter');
  await expect(page.getByRole('alert', { name: 'Lines to fix' })).toHaveCount(0);
  await expect(page.getByRole('listitem').filter({ hasText: '15. A new chapter' })).toBeVisible();
});
