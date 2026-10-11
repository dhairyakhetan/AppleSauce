import { describe, expect, it } from 'vitest';

import {
  PAGE_ZOOM_STEPS,
  findQuestionNote,
  isPageFallbackSubject,
  pageObjectPath,
  planWholePage,
  sourcePage,
  stepZoom,
} from './checker-page';

const PAPER = '0c999229-6844-447a-b5cb-a3eabbc9d27b';

describe('the whole-page fallback', () => {
  const q = (over: Record<string, unknown> = {}) => ({
    paper_id: PAPER,
    display_number: '6' as string | null,
    subject: 'Mathematics' as string | null,
    source: { page: 3, page_verified: true, align_score: 0.4 } as Record<string, unknown> | null,
    ...over,
  });

  it('plans the page image for a Maths question with no trusted crop', () => {
    expect(planWholePage(q(), false)).toEqual({
      path: `pages/${PAPER}/3.jpg`,
      page: 3,
      note: 'Find question 6 on this page.',
    });
  });

  it('needs the page to be verified against the PDF, not just recorded', () => {
    expect(planWholePage(q({ source: { page: 3, align_score: 0.4 } }), false)).toBeNull();
    expect(planWholePage(q({ source: { page: 3, page_verified: false } }), false)).toBeNull();
    expect(planWholePage(q({ source: { page: 3, page_verified: 'true' } }), false)).toBeNull();
    expect(planWholePage(q({ source: { page: 3, page_verified: true } }), false)?.page).toBe(3);
  });

  it('never plans a page when a trusted crop exists', () => {
    expect(planWholePage(q(), true)).toBeNull();
  });

  it('plans a page for every subject, and needs a recorded page', () => {
    expect(planWholePage(q({ subject: 'Economics' }), false)?.page).toBe(3);
    expect(planWholePage(q({ subject: 'Geography' }), false)?.page).toBe(3);
    expect(planWholePage(q({ subject: null }), false)?.page).toBe(3);
    expect(planWholePage(q({ source: { page_verified: true, align_score: 0.4 } }), false)).toBeNull();
    expect(planWholePage(q({ source: null }), false)).toBeNull();
    expect(isPageFallbackSubject('Maths')).toBe(true);
    expect(isPageFallbackSubject('  mathematics ')).toBe(true);
    expect(isPageFallbackSubject('English')).toBe(true);
    expect(isPageFallbackSubject(null)).toBe(true);
  });

  it('reads pages as 1-based whole numbers only', () => {
    expect(sourcePage({ page: 1 })).toBe(1);
    expect(sourcePage({ page: '12' })).toBe(12);
    expect(sourcePage({ page: 0 })).toBeNull();
    expect(sourcePage({ page: -2 })).toBeNull();
    expect(sourcePage({ page: 2.5 })).toBeNull();
    expect(sourcePage({ page: 'abc' })).toBeNull();
    expect(sourcePage({ page: 100000 })).toBeNull();
    expect(sourcePage(null)).toBeNull();
  });

  it('refuses a path that is not a real uuid and page', () => {
    expect(pageObjectPath(PAPER, 8)).toBe(`pages/${PAPER}/8.jpg`);
    expect(pageObjectPath('../other', 8)).toBeNull();
    expect(pageObjectPath(`${PAPER}/../x`, 8)).toBeNull();
    expect(pageObjectPath('', 8)).toBeNull();
    expect(pageObjectPath(PAPER, null)).toBeNull();
    expect(pageObjectPath(PAPER, 0)).toBeNull();
  });

  it('words the note plainly, with no dash', () => {
    expect(findQuestionNote('4(ii)')).toBe('Find question 4(ii) on this page.');
    expect(findQuestionNote(null)).toBe('Find this question on this page.');
    expect(findQuestionNote('   ')).toBe('Find this question on this page.');
    expect(findQuestionNote('a very long printed number')).toBe('Find this question on this page.');
    expect(findQuestionNote('6')).not.toMatch(/[–—]/);
  });

  it('steps the zoom within its bounds', () => {
    expect(stepZoom(1, 'in')).toBe(1.5);
    expect(stepZoom(1.5, 'in')).toBe(2);
    expect(stepZoom(3, 'in')).toBe(3);
    expect(stepZoom(1, 'out')).toBe(1);
    expect(stepZoom(2, 'out')).toBe(1.5);
    expect(stepZoom(99, 'out')).toBe(PAGE_ZOOM_STEPS[PAGE_ZOOM_STEPS.length - 2]);
  });
});
