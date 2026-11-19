import { describe, it, expect } from 'vitest';
import { parsePaperQuery, paperMatchesParsedQuery, paperClassMatches, paperBoardMatches } from './paper-query';

describe('parsePaperQuery', () => {
  it('parses class + subject + board in any order', () => {
    expect(parsePaperQuery('12 math cbse')).toEqual({
      subjects: ['Maths'], classes: ['12'], boards: ['CBSE'], years: [], freeText: '',
    });
    expect(parsePaperQuery('cbse math 12')).toEqual({
      subjects: ['Maths'], classes: ['12'], boards: ['CBSE'], years: [], freeText: '',
    });
    expect(parsePaperQuery('cbse 12 math')).toEqual({
      subjects: ['Maths'], classes: ['12'], boards: ['CBSE'], years: [], freeText: '',
    });
  });

  it('handles "class 10", "icse", casing and plurals', () => {
    const parsed = parsePaperQuery('class 10 maths ICSE');
    expect(parsed.classes).toEqual(['10']);
    expect(parsed.subjects).toEqual(['Maths']);
    expect(parsed.boards).toEqual(['ICSE']);
    expect(parsed.freeText).toBe('');
  });

  it('widens ICSE to include ISC for class 11/12 (ISC administers those)', () => {
    const parsed = parsePaperQuery('icse 12 physics');
    expect(parsed.boards.sort()).toEqual(['ICSE', 'ISC']);
    expect(parsed.subjects).toEqual(['Physics']);
    expect(parsed.classes).toEqual(['12']);
  });

  it('does not widen ICSE for classes below 11', () => {
    const parsed = parsePaperQuery('icse 10 physics');
    expect(parsed.boards).toEqual(['ICSE']);
  });

  it('leaves an explicit ISC query alone', () => {
    const parsed = parsePaperQuery('isc maths');
    expect(parsed.boards).toEqual(['ISC']);
    expect(parsed.subjects).toEqual(['Maths']);
  });

  it('resolves roman-numeral classes ("x" -> 10)', () => {
    const parsed = parsePaperQuery('x maths');
    expect(parsed.classes).toEqual(['10']);
    expect(parsed.subjects).toEqual(['Maths']);
  });

  it('extracts a 4-digit year', () => {
    const parsed = parsePaperQuery('maths 2023');
    expect(parsed.subjects).toEqual(['Maths']);
    expect(parsed.years).toEqual([2023]);
    expect(parsed.freeText).toBe('');
  });

  it('resolves subject abbreviations and West Bengal board aliases', () => {
    expect(parsePaperQuery('chemistry 12').subjects).toEqual(['Chemistry']);
    expect(parsePaperQuery('bio').subjects).toEqual(['Biology']);
    expect(parsePaperQuery('cbse').boards).toEqual(['CBSE']);
    expect(parsePaperQuery('wb board').boards).toEqual(['State']);
    expect(parsePaperQuery('wbbse').boards).toEqual(['State']);
  });

  it('leaves an unrecognised school name as free text', () => {
    const parsed = parsePaperQuery('La Martiniere');
    expect(parsed.subjects).toEqual([]);
    expect(parsed.classes).toEqual([]);
    expect(parsed.boards).toEqual([]);
    expect(parsed.freeText).toBe('la martiniere');
  });

  it('drops filler words ("papers", "board") rather than leaking them into freeText', () => {
    const parsed = parsePaperQuery('cbse class 12 papers');
    expect(parsed.freeText).toBe('');
  });

  it('returns everything empty for a blank query', () => {
    expect(parsePaperQuery('')).toEqual({ subjects: [], classes: [], boards: [], years: [], freeText: '' });
    expect(parsePaperQuery('   ')).toEqual({ subjects: [], classes: [], boards: [], years: [], freeText: '' });
  });

  it('does not choke on nonsense input', () => {
    const parsed = parsePaperQuery('zzqx');
    expect(parsed.subjects).toEqual([]);
    expect(parsed.classes).toEqual([]);
    expect(parsed.boards).toEqual([]);
    expect(parsed.freeText).toBe('zzqx');
  });
});

describe('paperClassMatches', () => {
  it('matches an Arabic filter against an Arabic-native paper class', () => {
    expect(paperClassMatches('10', '10')).toBe(true);
  });
  it('matches an Arabic filter against a Roman-numeral bank class', () => {
    expect(paperClassMatches('10', 'X')).toBe(true);
    expect(paperClassMatches('12', 'xii')).toBe(true);
  });
  it('rejects a mismatched class', () => {
    expect(paperClassMatches('10', 'XII')).toBe(false);
  });
});

describe('paperBoardMatches', () => {
  it('is case-insensitive', () => {
    expect(paperBoardMatches('cbse', 'CBSE')).toBe(true);
    expect(paperBoardMatches('CBSE', 'cbse')).toBe(true);
  });
});

describe('paperMatchesParsedQuery', () => {
  const paper = { title: 'Class 12 Maths', school: 'La Martiniere', subject: 'Maths', class: '12', board: 'CBSE', year: 2023 };

  it('matches a paper against all extracted facets', () => {
    expect(paperMatchesParsedQuery(paper, parsePaperQuery('12 math cbse'))).toBe(true);
  });

  it('rejects a paper missing one facet', () => {
    expect(paperMatchesParsedQuery(paper, parsePaperQuery('12 math icse'))).toBe(false);
  });

  it('matches bank-style Roman-numeral classes', () => {
    const bankPaper = { ...paper, class: 'XII' };
    expect(paperMatchesParsedQuery(bankPaper, parsePaperQuery('12 math cbse'))).toBe(true);
  });

  it('applies leftover free text as a substring match on title/school/subject', () => {
    expect(paperMatchesParsedQuery(paper, parsePaperQuery('martiniere'))).toBe(true);
    expect(paperMatchesParsedQuery(paper, parsePaperQuery('loreto'))).toBe(false);
  });

  it('rejects nonsense that matches nothing', () => {
    expect(paperMatchesParsedQuery(paper, parsePaperQuery('zzqx'))).toBe(false);
  });
});
