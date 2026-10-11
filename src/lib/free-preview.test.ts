import { describe, expect, it } from 'vitest';

import { FREE_PREVIEW_QUESTIONS, FREE_PREVIEW_WORD } from './free-preview';

/**
 * This is the smallest test here and the one with the clearest history: the
 * gate moved from five questions to two, the copy did not move with it, and
 * for a while seven places across the site promised a reader five free
 * questions immediately before withholding three of them.
 *
 * The number and the word are two exports that must agree. Nothing enforced
 * that, so a one-line edit could put them back out of step without any
 * visible failure -- the site would simply lie again.
 */

const NUMBER_WORDS: Record<number, string> = {
  1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five',
  6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten',
};

describe('the free preview constants', () => {
  it('spells the number it advertises', () => {
    expect(FREE_PREVIEW_WORD).toBe(NUMBER_WORDS[FREE_PREVIEW_QUESTIONS]);
  });

  it('is a whole number of at least one', () => {
    /* Zero would make every "free to read" sentence on the site false, and a
       fraction would render as "the first 2.5 questions". */
    expect(Number.isInteger(FREE_PREVIEW_QUESTIONS)).toBe(true);
    expect(FREE_PREVIEW_QUESTIONS).toBeGreaterThanOrEqual(1);
  });

  it('is small enough to still be a preview', () => {
    /* A guard rather than an assertion about today's value: if someone raises
       this to 40 the gate stops gating, and that should be a deliberate
       decision with a failing test in front of it. */
    expect(FREE_PREVIEW_QUESTIONS).toBeLessThanOrEqual(10);
  });

  it('has a word form the prose can use directly', () => {
    /* Every call site drops this straight into a sentence, so it has to be
       lowercase with no digits or padding. */
    expect(FREE_PREVIEW_WORD).toBe(FREE_PREVIEW_WORD.trim().toLowerCase());
    expect(FREE_PREVIEW_WORD).toMatch(/^[a-z]+$/);
  });
});
