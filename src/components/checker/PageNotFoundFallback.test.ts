import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { pageNotFound, planVerifiedPage } from '@/lib/checker-page';
import { planCheckerPicture } from '@/lib/checker-pictures';
import { flipStartPage, PAGE_NOT_FOUND_TITLE, ownPageNote, startPageIndex, type PaperPage } from '@/lib/paper-pages';
import { dummyQuestions } from '@/dummy/checker-fixtures';

// Owner, 26 Nov 2026: "If you can't find the question on the paper, just fall back to showing the pages".
// A question whose page was looked for and not found is now served when every page of its paper is stored
// (20261126200000). The screen must open the whole paper at page 1 and say plainly why.

const screen = readFileSync(resolve(__dirname, './VerifyScreen.tsx'), 'utf8');
const pages: PaperPage[] = [1, 2, 3, 4].map((page) => ({ page, object_path: `pages/p/${page}.jpg` }));

describe('page looked for and not found', () => {
  it('is told apart from "never looked for" and from a found page', () => {
    expect(pageNotFound({ page: 6, page_verified: false })).toBe(true);
    expect(pageNotFound({ page: 6 })).toBe(false);
    expect(pageNotFound({ page: 3, page_verified: true })).toBe(false);
    expect(pageNotFound(null)).toBe(false);
  });

  it('opens the flip at page 1, with no "this question is on page N" claim', () => {
    const src = { page: 3, page_verified: false };
    expect(flipStartPage(src)).toBeNull();
    expect(startPageIndex(pages, flipStartPage(src))).toBe(0);
    expect(ownPageNote(pages, flipStartPage({ page: 6, page_verified: false }))).toBe('');
  });

  it('still opens at the known page otherwise, exactly as before', () => {
    expect(flipStartPage({ page: 3, page_verified: true })).toBe(3);
    expect(flipStartPage({ page: '3' })).toBe(3);
    expect(flipStartPage(null)).toBeNull();
  });

  it('says it in one short plain line, with no dashes', () => {
    expect(PAGE_NOT_FOUND_TITLE).toBe('We could not find this question on the page; look through the pages below.');
    expect(PAGE_NOT_FOUND_TITLE).not.toMatch(/[–—]/);
  });
});

describe('the checker screen', () => {
  it('passes the not-found heading and the page-1 start to the whole-paper flip', () => {
    const flip = screen.slice(screen.indexOf('const flipBody = ('), screen.indexOf('const oneBoxBody'));
    expect(flip).toContain('questionPage={flipStartPage(question.source)}');
    expect(flip).toContain('pageNotFound(question.source) ? { title: PAGE_NOT_FOUND_TITLE } : {}');
  });

  it('the paper opened by a tap never starts on a guessed page either', () => {
    const paper = screen.slice(screen.indexOf('const paperBody = ('));
    expect(paper.slice(0, 400)).toContain('questionPage={flipStartPage(question.source)}');
    expect(screen).not.toContain('pageNumberOf(question.source?.page)');
  });

  it('shows the flip straight away when there is no crop and no page (no tap needed)', () => {
    expect(screen).toContain(
      "const flipShown = Boolean(picturePlanKey) && !hasPicture && pictureUrl !== undefined && (pagePath === '' || pageUrl !== undefined);",
    );
  });
});

describe('dummy mode (?dummy=1)', () => {
  it('has a question whose page was not found, with no crop, so the flip is its picture', () => {
    const q = dummyQuestions().find((x) => x.id.startsWith('d0000022'))!;
    expect(q).toBeTruthy();
    expect(pageNotFound(q.source)).toBe(true);
    expect(planCheckerPicture(q, null)).toBeNull();
    expect(planVerifiedPage(q)).toBeNull();
  });
});
