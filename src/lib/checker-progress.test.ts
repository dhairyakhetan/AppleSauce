import { describe, expect, it } from 'vitest';
import { normaliseAssignment, paperLabel, paperProgress } from '@/lib/checker-progress';
import { clampPageIndex, normalisePaperPages, pageLabel, positionLabel, startPageIndex } from '@/lib/paper-pages';

describe('paper progress', () => {
  it('says "3 of 12 done" after three done and nine left', () => {
    const p = paperProgress({ done_count: 3, remaining_count: 9 });
    expect(p.label).toBe('3 of 12 done');
    expect(p.position).toBe(4);
    expect(p.total).toBe(12);
    expect(p.percent).toBe(25);
  });

  it('starts at 0 done with an empty bar', () => {
    const p = paperProgress({ done_count: 0, remaining_count: 12 });
    expect(p.label).toBe('0 of 12 done');
    expect(p.percent).toBe(0);
  });

  it('never reports more done than the total, and never a total of zero', () => {
    expect(paperProgress({ done_count: 5, remaining_count: 0 }).label).toBe('5 of 5 done');
    expect(paperProgress({ done_count: 0, remaining_count: 0 }).label).toBe('0 of 1 done');
    expect(paperProgress({ done_count: -2, remaining_count: -1 }).label).toBe('0 of 1 done');
  });

  it('does not move when a question is skipped (it stays to do)', () => {
    expect(paperProgress({ done_count: 0, remaining_count: 5 }).label).toBe('0 of 5 done');
  });

  it('matches the paper card when questions went to the HOD', () => {
    // Card: 4 done, 0 left, 1 with the HOD, total 5.
    const p = paperProgress({ done_count: 4, remaining_count: 0, total_count: 5 });
    expect(p.label).toBe('4 of 5 done');
    expect(p.percent).toBe(80);
  });

  it('is nearly full when one is left', () => {
    const p = paperProgress({ done_count: 11, remaining_count: 1 });
    expect(p.label).toBe('11 of 12 done');
    expect(p.percent).toBe(92);
  });
});

describe('checker_my_assignment mapping', () => {
  it('maps the row, with numbers from strings and the HOD flag', () => {
    const a = normaliseAssignment([
      { assignment_id: '9', paper_id: 'p1', subject: 'Maths', cls: 'X', school: 'S', year: '2024', given_by_hod: true, done_count: '3', remaining_count: 9, queued_count: 1 },
    ])!;
    expect(a.assignment_id).toBe(9);
    expect(a.given_by_hod).toBe(true);
    expect(a.done_count).toBe(3);
    expect(a.queued_count).toBe(1);
  });

  it('is null when nothing is assigned', () => {
    expect(normaliseAssignment([])).toBeNull();
    expect(normaliseAssignment(null)).toBeNull();
    expect(normaliseAssignment([{ subject: 'Maths' }])).toBeNull();
  });
});

describe('paper label', () => {
  it('joins what is known and leaves out what is not', () => {
    expect(paperLabel({ subject: 'Mathematics', cls: 'X', school: 'Sample School', year: '2025' })).toBe('Mathematics, Class X, Sample School, 2025');
    expect(paperLabel({ subject: 'Physics', cls: null, school: null, year: 'year-unknown' })).toBe('Physics');
    expect(paperLabel({})).toBe('Paper');
  });
});

describe('whole-paper page-flip', () => {
  it('sorts pages, drops bad rows and keeps one row per page', () => {
    const pages = normalisePaperPages([
      { page: 3, object_path: 'pages/p/3.jpg' },
      { page: '1', object_path: 'pages/p/1.jpg' },
      { page: 1, object_path: 'pages/p/dup.jpg' },
      { page: 0, object_path: 'pages/p/0.jpg' },
      { page: 2, object_path: '' },
      { page: 4, object_path: '../escape.jpg' },
      { page: 5, object_path: '/abs.jpg' },
      null,
    ]);
    expect(pages.map((p) => p.page)).toEqual([1, 3]);
    expect(pages[0].object_path).toBe('pages/p/1.jpg');
    expect(normalisePaperPages(undefined)).toEqual([]);
  });

  it('keeps the page index inside the list', () => {
    expect(clampPageIndex(-3, 5)).toBe(0);
    expect(clampPageIndex(9, 5)).toBe(4);
    expect(clampPageIndex(2, 0)).toBe(0);
  });

  it('opens at the question page when the paper has a picture of it, else the first', () => {
    const pages = normalisePaperPages([
      { page: 2, object_path: 'a' },
      { page: 5, object_path: 'b' },
    ]);
    expect(startPageIndex(pages, 5)).toBe(1);
    expect(startPageIndex(pages, 3)).toBe(0);
    expect(startPageIndex(pages, null)).toBe(0);
  });

  it('labels the page number and the position', () => {
    const pages = normalisePaperPages([
      { page: 2, object_path: 'a' },
      { page: 5, object_path: 'b' },
    ]);
    expect(pageLabel(pages, 1)).toBe('Page 5');
    expect(positionLabel(pages, 1)).toBe('2 of 2');
    expect(positionLabel([], 0)).toBe('');
  });
});
