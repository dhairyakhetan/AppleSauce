import { describe, expect, it } from 'vitest';

import {
  isBlankBody,
  looksGarbled,
  codePointOffset,
  splitHalves,
  canSplitAt,
  editSize,
  bigEdit,
  matchLeadingNumberPrefix,
  stripLeadingNumberPrefix,
  displayBodyWithoutDuplicateNumber,
  FIX_RULE_TITLE,
  FIX_RULE_NOTE,
  BIG_EDIT_WARNING,
} from './checker-body';

describe('isBlankBody', () => {
  it('treats null, empty and whitespace-only as blank', () => {
    for (const b of [null, undefined, '', '   ', '\n\t ']) expect(isBlankBody(b)).toBe(true);
  });
  it('treats any real character as not blank', () => {
    expect(isBlankBody('4')).toBe(false);
  });
});

describe('looksGarbled', () => {
  // The body the owner was served on 2026-09-28 (an English row, now out of
  // the kid bucket). OCR garbage, not question text anyone wrote.
  const OWNER_SAW =
    '\\ling p p r b g a a part f our\nf gi ing nd h ,\nu r a\\iz d\nelect any on of th following:\n{101\nvtrY ou collected funds for the ne dy hHdr n by m king nd\nSUPW board project. Write a letter to your frind ab ut th j\nthe importance of UPW as a p rt o your h o\\urri ulum.';

  it('catches the scrambled English body the owner was served', () => {
    expect(looksGarbled(OWNER_SAW, 'English').garbled).toBe(true);
  });

  it('catches text from a legacy Indian-language font read as Latin', () => {
    expect(looksGarbled('(i) BcmWnhnsS ImØncn°p∂Xv? (a) Xpº (b) ap°p‰n (c) s\\ømº¬ (d) Dj v', 'English').garbled).toBe(true);
  });

  it('leaves ordinary prose alone, option labels included', () => {
    const q =
      '10. What does Tom do when Becky is about to be punished for tearing the book? (a) He stays quiet. (b) He blames another student. (c) He takes the blame himself. (d) He tells the teacher.';
    expect(looksGarbled(q, 'English').garbled).toBe(false);
  });

  it('never trips on maths, where single letters are variables', () => {
    const q = 'Find the values of a, b, c and d if a + b = 7, c - d = 2, a - b = 1 and c + d = 8, then find p, q, r and s.';
    expect(looksGarbled(q, 'Mathematics').garbled).toBe(false);
  });

  it('needs enough words to judge', () => {
    expect(looksGarbled('p r b g', 'English').garbled).toBe(false);
  });
});

describe('codePointOffset', () => {
  it('equals the caret for plain text', () => {
    expect(codePointOffset('abc def', 4)).toBe(4);
  });

  it('counts a character outside the BMP once, as Postgres left() does', () => {
    const t = 'Let 𝑥 = 2. Next question'; // U+1D465 is two UTF-16 units
    const caret = t.indexOf('Next');
    expect(caret).toBe(12);
    expect(codePointOffset(t, caret)).toBe(11);
    expect(Array.from(t).slice(0, 11).join('')).toBe('Let 𝑥 = 2. ');
  });

  it('never splits inside a surrogate pair', () => {
    const t = 'a𝑥b';
    expect(codePointOffset(t, 2)).toBe(1); // caret between the pair: before the whole character
  });

  it('clamps out-of-range carets', () => {
    expect(codePointOffset('abc', 99)).toBe(3);
    expect(codePointOffset('abc', -4)).toBe(0);
  });
});

describe('splitHalves / canSplitAt', () => {
  const body = '7. State two uses of a lever. 8. Define power.';
  it('cuts at a code-point offset, losing nothing', () => {
    const at = body.indexOf('8.');
    const { first, second } = splitHalves(body, at);
    expect(first + second).toBe(body);
    expect(second.startsWith('8.')).toBe(true);
  });

  it('refuses the start, the end, nothing chosen, and a half with no words', () => {
    expect(canSplitAt(body, null)).toBe(false);
    expect(canSplitAt(body, 0)).toBe(false);
    expect(canSplitAt(body, Array.from(body).length)).toBe(false);
    expect(canSplitAt('abc   ', 3)).toBe(false);
    expect(canSplitAt(body, body.indexOf('8.'))).toBe(true);
  });
});

describe('editSize / bigEdit (D76: only fix reading mistakes)', () => {
  it('is 0 for no change and small for a misread letter', () => {
    expect(editSize('Find the area', 'Find the area')).toBe(0);
    expect(editSize('Fmd the area of the circle', 'Find the area of the circle')).toBe(2);
  });

  it('does not warn on a typical OCR fix', () => {
    const before = 'A man observes the angle of e1evation of the top of the tower to be 45 degrees. He walks towards it.';
    const after = 'A man observes the angle of elevation of the top of the tower to be 45 degrees. He walks towards it.';
    expect(bigEdit(before, after)).toBe(false);
  });

  it('warns when the question is reworded', () => {
    const before = 'State two uses of a lever in daily life.';
    const after = 'Give two everyday examples where a lever is useful, and explain each one.';
    expect(bigEdit(before, after)).toBe(true);
  });

  it('does not warn when text is only removed (an answer typed in, page furniture)', () => {
    const before = 'Solve for x and verify your answer: 2x^2 - 7x + 3 = 0 Answer: x = 3 or x = 1/2';
    const after = 'Solve for x and verify your answer: 2x^2 - 7x + 3 = 0';
    expect(bigEdit(before, after)).toBe(false);
  });

  it('stays fast and bounded on a long body with a big middle change', () => {
    const a = 'x'.repeat(2000);
    const b = 'y'.repeat(2000);
    expect(editSize(a, b)).toBe(2000);
  });
});

describe('fix-it copy', () => {
  it('says only reading mistakes are fixed, in plain words with no dashes', () => {
    for (const s of [FIX_RULE_TITLE, FIX_RULE_NOTE, BIG_EDIT_WARNING]) {
      expect(s).not.toMatch(/[–—]/);
      expect(s).not.toMatch(/\bOCR\b/);
    }
    expect(FIX_RULE_NOTE).toMatch(/Do not reword/);
    expect(FIX_RULE_NOTE).toMatch(/exactly/);
  });
});

describe('matchLeadingNumberPrefix / stripLeadingNumberPrefix', () => {
  it('strips a plain numeric prefix that repeats display_number', () => {
    const m = matchLeadingNumberPrefix('15. Solve for x.', '15');
    expect(m).not.toBeNull();
    expect(m!.rest).toBe('Solve for x.');
    expect(stripLeadingNumberPrefix('15. Solve for x.', '15')).toEqual({
      stripped: 'Solve for x.',
      removed: '15. ',
    });
  });

  it('strips "Q15)" and "(15)" forms', () => {
    expect(matchLeadingNumberPrefix('Q15) Name the capital.', '15')?.rest).toBe('Name the capital.');
    expect(matchLeadingNumberPrefix('(15) Name the capital.', '15')?.rest).toBe('Name the capital.');
  });

  it('strips a sub-part label like "(a)"', () => {
    expect(matchLeadingNumberPrefix('(a) Name the district with the most trees.', '(a)')?.rest).toBe(
      'Name the district with the most trees.',
    );
  });

  it('is a no-op when there is no displayNumber or body', () => {
    expect(matchLeadingNumberPrefix('15. Solve for x.', null)).toBeNull();
    expect(matchLeadingNumberPrefix('', '15')).toBeNull();
    expect(matchLeadingNumberPrefix(null, '15')).toBeNull();
  });

  it('does not strip when the number does not match', () => {
    expect(matchLeadingNumberPrefix('16. Solve for x.', '15')).toBeNull();
  });

  it('never mistakes "15 marks" for a numbering prefix (no glue punctuation)', () => {
    expect(matchLeadingNumberPrefix('15 marks for this question.', '15')).toBeNull();
  });

  it('never mistakes a decimal like "1.5" for prefix "1."', () => {
    expect(matchLeadingNumberPrefix('1.5 kg of sand is poured in.', '1')).toBeNull();
  });

  it('leaves "(a) and (b)" alone unless display_number really is "(a)"/"a"', () => {
    expect(matchLeadingNumberPrefix('(a) and (b) both apply.', '5')).toBeNull();
    // When it genuinely is this question's own number, stripping is correct:
    // that is the exact double-numbering the owner asked to fix.
    expect(matchLeadingNumberPrefix('(a) and (b) both apply.', '(a)')?.rest).toBe('and (b) both apply.');
  });

  it('leaves ordinary text with no leading number alone', () => {
    expect(matchLeadingNumberPrefix('Solve for x and verify.', '15')).toBeNull();
  });

  it('stripLeadingNumberPrefix is byte-identical when there is nothing to strip', () => {
    expect(stripLeadingNumberPrefix('Solve for x.', '15')).toEqual({ stripped: 'Solve for x.', removed: null });
  });
});

describe('displayBodyWithoutDuplicateNumber', () => {
  it('hides a leading number that repeats the shown badge, render-only', () => {
    expect(displayBodyWithoutDuplicateNumber('15. Solve for x.', '15')).toBe('Solve for x.');
  });

  it('leaves the body alone when there is no badge', () => {
    expect(displayBodyWithoutDuplicateNumber('15. Solve for x.', null)).toBe('15. Solve for x.');
  });

  it('leaves the body alone when the badge does not match', () => {
    expect(displayBodyWithoutDuplicateNumber('15. Solve for x.', '16')).toBe('15. Solve for x.');
  });
});
