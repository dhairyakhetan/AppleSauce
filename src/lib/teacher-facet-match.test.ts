import { describe, it, expect } from 'vitest';
import { filterShikshaqRecords, fillFilterStateDefaults, hasTeacherFacets } from './teacher-facet-match';

const juhi = {
  Subjects: 'Maths, Physics',
  'Classes Taught': 'Class 9 - 12',
  'Classes Taught for Backend': '9,10,11,12',
  'School Boards Catered': 'CBSE',
  Area: 'Salt Lake',
};

const ranjan = {
  Subjects: 'Physics, Chemistry, Biology',
  'Classes Taught': 'Class VIII - X',
  'Classes Taught for Backend': '8,9,10',
  'School Boards Catered': 'ICSE, ISC',
  Area: 'Behala',
};

describe('fillFilterStateDefaults', () => {
  it('defaults every missing array/scalar field', () => {
    expect(fillFilterStateDefaults({})).toEqual({
      subjects: [], classes: [], boards: [], classSize: [], areas: [],
      modeOfTeaching: [], placeOfTeaching: [], minFees: null, maxFees: null,
      minExperience: null, schools: [], examTypes: [],
    });
  });
});

describe('hasTeacherFacets', () => {
  it('is true when any of subject/class/board/area is present', () => {
    expect(hasTeacherFacets({ subjects: ['Maths'] })).toBe(true);
    expect(hasTeacherFacets({ classes: ['10'] })).toBe(true);
    expect(hasTeacherFacets({ boards: ['CBSE'] })).toBe(true);
    expect(hasTeacherFacets({ areas: ['Behala'] })).toBe(true);
  });
  it('is false for an empty extraction (a name-only query)', () => {
    expect(hasTeacherFacets({})).toBe(false);
    expect(hasTeacherFacets({ subjects: [], classes: [] })).toBe(false);
  });
});

describe('filterShikshaqRecords', () => {
  const records = [juhi, ranjan];

  it('matches subject + class + board together ("cbse 12 chemistry" style)', () => {
    const filters = fillFilterStateDefaults({ subjects: ['Maths'], classes: ['12'], boards: ['CBSE'] });
    expect(filterShikshaqRecords(records, filters)).toEqual([juhi]);
  });

  it('matches subject + area ("english behala" style, subject swapped for one both have)', () => {
    const filters = fillFilterStateDefaults({ subjects: ['Physics'], areas: ['Behala'] });
    expect(filterShikshaqRecords(records, filters)).toEqual([ranjan]);
  });

  it('matches board tokens exactly, not as a substring ("IB" must not match inside "ICSE")', () => {
    const filters = fillFilterStateDefaults({ boards: ['IB'] });
    expect(filterShikshaqRecords(records, filters)).toEqual([]);
  });

  it('matches ICSE and ISC as distinct tokens in a combined "ICSE, ISC" field', () => {
    expect(filterShikshaqRecords(records, fillFilterStateDefaults({ boards: ['ICSE'] }))).toEqual([ranjan]);
    expect(filterShikshaqRecords(records, fillFilterStateDefaults({ boards: ['ISC'] }))).toEqual([ranjan]);
  });

  it('matches class 5 against neither record (no false positive on "15" etc.)', () => {
    expect(filterShikshaqRecords(records, fillFilterStateDefaults({ classes: ['5'] }))).toEqual([]);
  });

  it('returns every record when no facet is set', () => {
    expect(filterShikshaqRecords(records, fillFilterStateDefaults({}))).toEqual(records);
  });
});
