import { describe, expect, it } from 'vitest';

import * as save from './checker-save';
import { checkerSaveRoute, typoSaveProblem, TYPO_NEEDS_CHANGE } from './checker-save';
import { planVerifiedPage, planWholePage } from './checker-page';
import { checkerErrorAdvice } from './checker-errors';

describe('checkerSaveRoute', () => {
  it('uses the version lock whenever the question came with a version', () => {
    expect(checkerSaveRoute(1, false)).toBe('locked');
    expect(checkerSaveRoute(7, true)).toBe('locked');
  });

  it('falls back to the old RPCs before the migration, but never for a typo correction', () => {
    expect(checkerSaveRoute(undefined, false)).toBe('legacy');
    expect(checkerSaveRoute(null, false)).toBe('legacy');
    expect(checkerSaveRoute(undefined, true)).toBe('refuse');
    expect(checkerSaveRoute(null, true)).toBe('refuse');
  });

  it('treats a nonsense version as no version', () => {
    expect(checkerSaveRoute(0, false)).toBe('legacy');
    expect(checkerSaveRoute(1.5, true)).toBe('refuse');
    expect(checkerSaveRoute(Number.NaN, false)).toBe('legacy');
  });
});

describe('typoSaveProblem', () => {
  it('a typo correction must change the words', () => {
    expect(typoSaveProblem(true, false)).toBe(TYPO_NEEDS_CHANGE);
    expect(typoSaveProblem(true, true)).toBeNull();
    expect(typoSaveProblem(false, false)).toBeNull();
  });
});

describe('printed typo copy', () => {
  it('has no em or en dashes anywhere', () => {
    for (const v of Object.values(save)) if (typeof v === 'string') expect(v).not.toMatch(/[–—]/);
  });

  it('the server refusals read as plain words, never raw SQL', () => {
    const typo = checkerErrorAdvice({ code: '22023', message: 'A printed typo fix must change the words' });
    expect(typo.moveOn).toBe(false);
    expect(typo.message).toMatch(/untick/);
    const off = checkerErrorAdvice(new Error(save.TYPO_NEEDS_VERSION));
    expect(off.message).toMatch(/not switched on/);
    const stale = checkerErrorAdvice({ code: '40001', message: 'stale question: you saw version 2, it is now at version 3' });
    expect(stale.moveOn).toBe(true);
    expect(stale.message).not.toMatch(/version|40001/);
  });
});

describe('planVerifiedPage', () => {
  const paper = '00000000-0000-4000-8000-00000000d0d0';
  const base = { paper_id: paper, display_number: '8', subject: 'Mathematics' };

  it('shows the verified page even when a trusted crop exists', () => {
    const q = { ...base, source: { page: 3, page_verified: true, snippet_object: 'x.png', align_score: 0.99 } };
    expect(planWholePage(q, true)).toBeNull();
    expect(planVerifiedPage(q)).toMatchObject({ page: 3, path: `pages/${paper}/3.jpg` });
  });

  it('never shows an unverified page', () => {
    expect(planVerifiedPage({ ...base, source: { page: 3 } })).toBeNull();
    expect(planVerifiedPage({ ...base, source: { page: 3, page_verified: 'true' } })).toBeNull();
    expect(planVerifiedPage({ ...base, source: { page: 3, page_verified: false } })).toBeNull();
  });
});
