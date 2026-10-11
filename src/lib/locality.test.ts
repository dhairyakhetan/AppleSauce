import { describe, expect, it } from 'vitest';
import {
  areaSlug,
  classRanges,
  computeLocalityCombos,
  localityDescription,
  localityFacts,
  localityPath,
  localitySeoTitle,
  normaliseAreas,
  parseLocalityPath,
  teacherMatchesSubject,
  type LocalityTeacher,
} from './locality';

const teacher = (over: Partial<LocalityTeacher> & { slug: string }): LocalityTeacher => ({
  name: over.slug,
  honorific: '',
  subjects: 'Maths',
  classes: 'Class IX - XII',
  area: 'Salt Lake',
  boards: 'ICSE/ISC, CBSE',
  ...over,
});

const crowd = (n: number, over: Partial<LocalityTeacher> = {}) =>
  Array.from({ length: n }, (_, i) => teacher({ slug: `t${i}`, ...over }));

describe('normaliseAreas', () => {
  it('folds spellings and aliases onto the canonical area', () => {
    expect(normaliseAreas('Salt lake')).toEqual(['Salt Lake']);
    expect(normaliseAreas('Bidhannagar, Ballygunge / Kasba')).toEqual(['Salt Lake', 'Ballygunge', 'Kasba']);
  });
  it('drops empty and unknown areas', () => {
    expect(normaliseAreas(null)).toEqual([]);
    expect(normaliseAreas('Kalighat')).toEqual([]);
  });
});

describe('paths', () => {
  it('builds and parses a locality path', () => {
    const path = localityPath('/maths-tuition-teachers-in-kolkata', 'Salt Lake');
    expect(path).toBe('/maths-tuition-teachers-in-salt-lake');
    expect(parseLocalityPath(path)).toEqual({ subjectPath: '/maths-tuition-teachers-in-kolkata', area: 'Salt Lake' });
    expect(areaSlug('New Alipore')).toBe('new-alipore');
  });
  it('does not treat the Kolkata subject page or unknown areas as localities', () => {
    expect(parseLocalityPath('/maths-tuition-teachers-in-kolkata')).toBeNull();
    expect(parseLocalityPath('/maths-tuition-teachers-in-mars')).toBeNull();
    expect(parseLocalityPath('/faq')).toBeNull();
  });
});

describe('teacherMatchesSubject', () => {
  it('matches whole tokens, OR across a comma filter, and synonyms', () => {
    expect(teacherMatchesSubject('English, Maths', 'Maths')).toBe(true);
    expect(teacherMatchesSubject('Mathematics only', 'Maths')).toBe(false);
    expect(teacherMatchesSubject('Chemistry', 'Physics,Chemistry,Biology')).toBe(true);
    expect(teacherMatchesSubject('Computer', 'Computers')).toBe(true);
  });
});

describe('computeLocalityCombos', () => {
  it('needs 5 teachers for one subject in one area', () => {
    expect(computeLocalityCombos(crowd(4))).toEqual([]);
    const combos = computeLocalityCombos(crowd(5));
    expect(combos.map((c) => c.path)).toContain('/maths-tuition-teachers-in-salt-lake');
    expect(combos.find((c) => c.path === '/maths-tuition-teachers-in-salt-lake')?.count).toBe(5);
  });
  it('never makes a page for the commercial-studies alias', () => {
    const combos = computeLocalityCombos(crowd(6, { subjects: 'Commerce' }));
    expect(combos.some((c) => c.path.startsWith('/commercial-studies'))).toBe(false);
    expect(combos.some((c) => c.path.startsWith('/commerce'))).toBe(true);
  });
  it('counts a teacher in each area they list', () => {
    const combos = computeLocalityCombos(crowd(5, { area: 'Salt Lake, Behala' }));
    const paths = combos.map((c) => c.path);
    expect(paths).toContain('/maths-tuition-teachers-in-salt-lake');
    expect(paths).toContain('/maths-tuition-teachers-in-behala');
  });
});

describe('copy', () => {
  it('writes the approved title', () => {
    expect(localitySeoTitle('Maths', 'Salt Lake', 8)).toBe(
      'Maths Home Tutor in Salt Lake, Kolkata: 8 Verified Teachers | Shikshaq',
    );
  });
  it('reads class ranges in roman numerals, digits and mixed text', () => {
    expect(classRanges('Class IX - XII, UG')).toEqual([[9, 12]]);
    expect(classRanges('Class 6 to 8')).toEqual([[6, 8]]);
    expect(classRanges('Class V')).toEqual([[5, 5]]);
    expect(classRanges('Undergraduate')).toEqual([]);
  });
  it('summarises the real board and class mix', () => {
    const facts = localityFacts([
      teacher({ slug: 'a', boards: 'ICSE/ISC, CBSE', classes: 'Class IX - XII' }),
      teacher({ slug: 'b', boards: 'CBSE', classes: 'Class V - VIII' }),
    ]);
    expect(facts.boards[0]).toEqual({ board: 'CBSE', count: 2 });
    expect(facts.bands).toEqual([
      { band: 'Classes 1 to 5', count: 1 },
      { band: 'Classes 6 to 8', count: 1 },
      { band: 'Classes 9 and 10', count: 1 },
      { band: 'Classes 11 and 12', count: 1 },
    ]);
    const text = localityDescription('Maths', 'Salt Lake', 2, facts);
    expect(text).toContain('Find 2 verified Maths tutors in Salt Lake, Kolkata covering CBSE and ICSE/ISC');
    expect(text).not.toMatch(/[–—]/);
  });
});
