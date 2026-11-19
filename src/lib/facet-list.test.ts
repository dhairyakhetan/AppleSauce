import { describe, expect, it } from 'vitest';
import { FACET_LIMIT, facetView, orderFacets, searchFacets } from '@/lib/facet-list';

const KNOWN = ['Maths', 'Physics', 'Chemistry', 'Biology'];

describe('orderFacets', () => {
  it('lists the biggest first, breaks ties by the curated order then name, and drops zeros', () => {
    const counts = { Biology: 4, Maths: 10, Zoology: 4, Astronomy: 4, Physics: 0, Geology: 9 };
    expect(orderFacets(KNOWN, counts)).toEqual(['Maths', 'Geology', 'Biology', 'Astronomy', 'Zoology']);
  });

  it('never drops a value just because the curated list does not know it', () => {
    expect(orderFacets([], { Philosophy: 1 })).toEqual(['Philosophy']);
  });
});

describe('facetView', () => {
  const many = Array.from({ length: 30 }, (_, i) => `Subject ${String(i).padStart(2, '0')}`);

  it('shows the first few and says how many are hidden', () => {
    const v = facetView(many, '', false);
    expect(v.shown).toHaveLength(FACET_LIMIT);
    expect(v.hidden).toBe(30 - FACET_LIMIT);
    expect(v.searchable).toBe(true);
  });

  it('shows everything once expanded', () => {
    const v = facetView(many, '', true);
    expect(v.shown).toHaveLength(30);
    expect(v.hidden).toBe(0);
  });

  it('a search shows every match, including ones past the limit, case-insensitively', () => {
    const v = facetView(many, '  SUBJECT 2 ', false);
    expect(v.shown).toEqual(many.filter((s) => s.includes('Subject 2')));
    expect(v.shown.length).toBeGreaterThan(0);
    expect(v.hidden).toBe(0);
  });

  it('reports no match, and does not offer search for a short list', () => {
    expect(facetView(many, 'zzz', false).shown).toEqual([]);
    expect(facetView(['Maths', 'Physics'], '', false).searchable).toBe(false);
    expect(searchFacets(['Maths'], '')).toEqual(['Maths']);
  });
});
