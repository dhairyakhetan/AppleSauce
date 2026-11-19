import { describe, expect, it } from 'vitest';

import { filterToKnownVocabulary } from './paper-filter-validation';

/**
 * R4G6: PaperResults used to reflect any filter_* query value straight into
 * the heading and <title> -- ?filter_classes=%25%25%25 rendered as literally
 * "Class %%% papers | Shikshaq". filterToKnownVocabulary is the guard: it
 * keeps only values a known vocabulary recognises.
 */
describe('filterToKnownVocabulary', () => {
  const CLASSES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', 'UG'];

  it('drops a value the vocabulary does not recognise', () => {
    expect(filterToKnownVocabulary(['%%%'], CLASSES)).toEqual([]);
  });

  it('drops a spam value while keeping a legitimate one in the same list', () => {
    expect(filterToKnownVocabulary(['10', 'BUY CHEAP WATCHES'], CLASSES)).toEqual(['10']);
  });

  it('keeps a value that matches exactly', () => {
    expect(filterToKnownVocabulary(['10'], CLASSES)).toEqual(['10']);
  });

  it('matches case-insensitively but returns the vocabulary\'s own casing', () => {
    expect(filterToKnownVocabulary(['icse'], ['ICSE', 'CBSE'])).toEqual(['ICSE']);
  });

  it('trims surrounding whitespace before matching', () => {
    expect(filterToKnownVocabulary([' 10 '], CLASSES)).toEqual(['10']);
  });

  it('dedupes case-insensitive duplicates to one canonical value', () => {
    expect(filterToKnownVocabulary(['Maths', 'maths', 'MATHS'], ['Maths', 'History & Civics'])).toEqual(['Maths']);
  });

  it('returns an empty array for an empty input', () => {
    expect(filterToKnownVocabulary([], CLASSES)).toEqual([]);
  });

  it('preserves input order among the values that survive', () => {
    expect(filterToKnownVocabulary(['12', '%%%', '10', '5'], CLASSES)).toEqual(['12', '10', '5']);
  });
});
