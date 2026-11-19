import { describe, expect, it } from 'vitest';

import { questionMatchesSearch, searchableCount } from '@/lib/bank-question-search';

describe('questionMatchesSearch', () => {
  const mcq = {
    t: 'Who founded the Mughal empire in India?',
    o: ['Babur', 'Akbar', 'Humayun', 'Sher Shah Suri'],
  };

  it('finds the stem', () => {
    expect(questionMatchesSearch(mcq, 'mughal')).toBe(true);
  });

  it('finds text that lives only in an option', () => {
    expect(questionMatchesSearch(mcq, 'sher shah')).toBe(true);
    expect(questionMatchesSearch({ t: 'Stem only' }, 'sher shah')).toBe(false);
  });

  it('matches case-insensitively against a lower-cased needle', () => {
    expect(questionMatchesSearch({ t: 'Find THE Value', o: ['AB'] }, 'the value')).toBe(true);
    expect(questionMatchesSearch({ t: 'x', o: ['AB'] }, 'ab')).toBe(true);
  });

  it('an empty needle matches everything', () => {
    expect(questionMatchesSearch({ t: '' }, '')).toBe(true);
  });

  it('survives missing or malformed options', () => {
    expect(questionMatchesSearch({ t: 'abc', o: null }, 'zzz')).toBe(false);
    expect(questionMatchesSearch({ t: 'abc', o: [null as unknown as string, 'zzz'] }, 'zzz')).toBe(true);
  });

  it('never alters the stored text', () => {
    const row = { t: 'Mixed CASE', o: ['Opt One'] };
    questionMatchesSearch(row, 'case');
    expect(row).toEqual({ t: 'Mixed CASE', o: ['Opt One'] });
  });
});

describe('searchableCount', () => {
  it('leaves held placeholder cards out of "the N free questions"', () => {
    expect(searchableCount([{}, { held: true }, {}, { held: true }, { held: false }])).toBe(3);
    expect(searchableCount([])).toBe(0);
  });
});
