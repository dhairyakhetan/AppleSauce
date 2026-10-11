import { describe, expect, it } from 'vitest';
import { boardOf } from './bank-source';

describe('boardOf', () => {
  it('never turns an exam type into a board', () => {
    // 297 papers once got board 'Board' from "Pre-board Examination".
    expect(boardOf('Bombay Scottish School', 'X')).toBe('ICSE');
    expect(boardOf('School not recorded', 'XII')).toBe('ISC');
  });

  it('takes a board name from the school column', () => {
    expect(boardOf('cbse', 'X')).toBe('CBSE');
    expect(boardOf(' ISC ', 'XI')).toBe('ISC');
  });

  it('falls back by class the way the PDF sorter does', () => {
    expect(boardOf(null, 'XI')).toBe('ISC');
    expect(boardOf(null, 'IX')).toBe('ICSE');
    expect(boardOf(null, null)).toBe('ICSE');
  });
});
