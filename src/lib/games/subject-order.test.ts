import { describe, expect, it } from 'vitest';
import { bySubject, CORE_SUBJECTS, SUBJECTS } from './details';

describe('the order of subjects', () => {
  const names = new Set(SUBJECTS.map((s) => s.name));
  it('groups only subjects the site knows (a misspelt one would fall to the electives)', () => {
    expect([...CORE_SUBJECTS].filter((n) => !names.has(n))).toEqual([]);
  });
  it('puts core subjects first, then electives, each alphabetical', () => {
    expect(['Yoga', 'Psychology', 'Physics', 'Computer Science', 'Accountancy', 'Retail', 'Mathematics'].sort(bySubject))
      .toEqual(['Accountancy', 'Mathematics', 'Physics', 'Computer Science', 'Psychology', 'Retail', 'Yoga']);
  });
});
