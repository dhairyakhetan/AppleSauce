import { describe, expect, it } from 'vitest';
import { formatPaperTime, optionHasOwnLabel, paperHeaderLines, partIndent } from './bank-paper-display';

describe('printed paper helpers', () => {
  it('formatPaperTime words a duration the way the HOD preview does', () => {
    expect(formatPaperTime(150)).toBe('2 hours 30 minutes');
    expect(formatPaperTime(45)).toBe('45 minutes');
    expect(formatPaperTime(60)).toBe('1 hour');
    expect(formatPaperTime(61)).toBe('1 hour 1 minute');
  });

  it('formatPaperTime is null when no usable time was recorded', () => {
    expect(formatPaperTime(null)).toBeNull();
    expect(formatPaperTime(undefined)).toBeNull();
    expect(formatPaperTime(0)).toBeNull();
    expect(formatPaperTime(-5)).toBeNull();
    expect(formatPaperTime(Number.NaN)).toBeNull();
  });

  it('optionHasOwnLabel spots printed letters and numbers, and only those', () => {
    for (const t of ['a. Dominion status', '(c) 1947', 'B) Delhi', '(ii) the second', '1. One', 'a.']) {
      expect(optionHasOwnLabel(t), t).toBe(true);
    }
    for (const t of ['Delhi', 'Apple pie', '1947', '', null, undefined, 'Abcd. not a label']) {
      expect(optionHasOwnLabel(t), String(t)).toBe(false);
    }
  });

  it('paperHeaderLines joins what exists and drops what does not', () => {
    expect(paperHeaderLines({ exam: 'Pre-board', year: '2024', cls: 'X', subject: 'Maths', board: 'ICSE' })).toEqual({
      headline: 'Pre-board 2024',
      sub: 'Class X · Maths · ICSE',
    });
    expect(paperHeaderLines({ exam: '', year: null, cls: '', subject: 'History', board: null })).toEqual({
      headline: '',
      sub: 'History',
    });
    expect(paperHeaderLines({ exam: null, year: 2023, cls: '9', subject: 'Maths', board: ' ' }).headline).toBe('2023');
  });

  it('partIndent is nothing at the top and 20px a level up to three', () => {
    expect(partIndent(0)).toBeUndefined();
    expect(partIndent(1)).toEqual({ marginLeft: '20px' });
    expect(partIndent(3)).toEqual({ marginLeft: '60px' });
    expect(partIndent(8)).toEqual({ marginLeft: '60px' });
  });
});
