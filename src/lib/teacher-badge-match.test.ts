import { describe, it, expect } from 'vitest';
import { firstMatchingToken, tokenizeFacetField, subjectFilterSynonyms } from './teacher-badge-match';

describe('tokenizeFacetField', () => {
  it('splits on comma and slash, trimming whitespace', () => {
    expect(tokenizeFacetField('Salt Lake, Newtown / Rajarhat')).toEqual(['Salt Lake', 'Newtown', 'Rajarhat']);
  });
  it('returns an empty array for null/undefined/empty', () => {
    expect(tokenizeFacetField(null)).toEqual([]);
    expect(tokenizeFacetField(undefined)).toEqual([]);
    expect(tokenizeFacetField('')).toEqual([]);
  });
});

describe('firstMatchingToken', () => {
  it('returns the first active filter value present among the record tokens (RM1: area badge)', () => {
    // Teacher covers several areas; "Salt Lake" filter is active — the card
    // should show "Salt Lake", not "Bhowanipore" (the first-listed area).
    const recordTokens = ['Bhowanipore', 'Alipore', 'Salt Lake'];
    expect(firstMatchingToken(['Salt Lake'], recordTokens)).toBe('Salt Lake');
  });

  it('is case/spacing-insensitive', () => {
    const recordTokens = ['  salt lake  ', 'Alipore'];
    expect(firstMatchingToken(['Salt Lake'], recordTokens)).toBe('Salt Lake');
  });

  it('returns null when no active filter value matches (teacher matched on a different facet)', () => {
    const recordTokens = ['Bhowanipore', 'Alipore'];
    expect(firstMatchingToken(['Salt Lake'], recordTokens)).toBeNull();
  });

  it('returns null when no filter is active', () => {
    expect(firstMatchingToken([], ['Bhowanipore'])).toBeNull();
  });

  it('honours synonym expansion for subjects (Accountancy/Accounts)', () => {
    expect(firstMatchingToken(['Accountancy'], ['Accounts'], subjectFilterSynonyms)).toBe('Accountancy');
    expect(firstMatchingToken(['Accountancy'], ['Maths'], subjectFilterSynonyms)).toBeNull();
  });

  it('honours Social Studies mapping to History & Civics / Geography', () => {
    expect(firstMatchingToken(['Social Studies'], ['History & Civics'], subjectFilterSynonyms)).toBe('Social Studies');
    expect(firstMatchingToken(['Social Studies'], ['Geography'], subjectFilterSynonyms)).toBe('Social Studies');
  });

  it('picks the first matching FILTER value (not record order) when several filters are active', () => {
    // Filters were applied in this order; the teacher matches both, but the
    // badge should show whichever filter value comes first in the active list.
    const recordTokens = ['Newtown', 'Salt Lake'];
    expect(firstMatchingToken(['Newtown', 'Salt Lake'], recordTokens)).toBe('Newtown');
  });
});
