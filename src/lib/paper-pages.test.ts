import { describe, expect, it } from 'vitest';
import { missingPagesNote, ownPageNote, pageNumberOf, pageOfLabel, startPageIndex, type PaperPage } from '@/lib/paper-pages';

const page = (n: number): PaperPage => ({ page: n, object_path: `pages/p/${n}.jpg` });

describe('pageNumberOf: the page a question says it is on', () => {
  it('reads a whole number, as a number or as text', () => {
    expect(pageNumberOf(4)).toBe(4);
    expect(pageNumberOf('4')).toBe(4);
    expect(pageNumberOf(' 12 ')).toBe(12);
  });

  it('refuses everything that is not a page', () => {
    for (const bad of [0, -1, 1.5, 1000, '', 'four', '4a', '1e2', null, undefined, {}, [], true, NaN]) {
      expect(pageNumberOf(bad), String(bad)).toBeNull();
    }
  });
});

describe('ownPageNote: the flip says when the question\'s own page has no picture', () => {
  it('is empty when the page has a picture', () => {
    expect(ownPageNote([page(1), page(2), page(3)], 2)).toBe('');
  });

  it('is empty when the page is not known, or the paper has no pictures at all', () => {
    expect(ownPageNote([page(1)], null)).toBe('');
    expect(ownPageNote([page(1)], undefined)).toBe('');
    expect(ownPageNote([], 3)).toBe('');
  });

  it('names the missing page and says what to do', () => {
    const note = ownPageNote([page(1), page(3)], 2);
    expect(note).toContain('page 2');
    expect(note).toContain('no picture yet');
    expect(note).toContain('do not pass it');
  });
});

describe('the flip around a paper with a hole in it', () => {
  const pages = [page(1), page(3), page(4)];

  it('opens on the question\'s page when it is stored, on the first page when it is not', () => {
    expect(startPageIndex(pages, 3)).toBe(1);
    expect(startPageIndex(pages, 2)).toBe(0);
  });

  it('labels with real page numbers, so a gap never reads as "2 of 3" beside page 3', () => {
    expect(pageOfLabel(pages, 1)).toBe('Page 3 of 4');
  });

  it('names the page that is missing in the middle', () => {
    expect(missingPagesNote(pages)).toContain('Page 2 is');
  });
});
