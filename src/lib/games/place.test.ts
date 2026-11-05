import { describe, expect, it } from 'vitest';
import { NO_PLACE, options, placeOf, whereOf } from './place';
import type { ListChapter } from './rows';

const ch = (board: string, cls: number, subject: string, no: number, name: string): ListChapter => ({
  chapter_id: `${board}${String(cls).padStart(2, '0')}${subject.slice(0, 3).toUpperCase()}${String(no).padStart(2, '0')}`, board, class: cls, subject, chapter_no: no, name, topics: [],
});
const LIST = [
  ch('CBSE', 9, 'Science', 5, 'The Fundamental Unit of Life'),
  ch('CBSE', 9, 'Science', 1, 'Matter in Our Surroundings'),
  ch('CBSE', 10, 'Science', 1, 'Chemical Reactions and Equations'),
  ch('ICSE', 9, 'Physics', 6, 'Heat and Energy'),
];
const at = (p: Partial<typeof NO_PLACE>) => ({ ...NO_PLACE, ...p });

describe('choosing the chapter', () => {
  it('offers only what the list has, each choice narrowing the next, and fills in a dropdown with one choice', () => {
    const o = options(LIST, at({ board: 'CBSE' }));
    expect(o.boards).toEqual(['CBSE', 'ICSE']);
    expect(o.classes).toEqual([9, 10]);
    expect(options(LIST, at({ board: 'ICSE' })).place).toEqual({ board: 'ICSE', cls: '9', subject: 'Physics', chapter: 'ICSE09PHY06' });
    expect(options(LIST, at({ board: 'CBSE', cls: '9', subject: 'Science' })).chapters.map((c) => c.chapter_no)).toEqual([1, 5]);
  });

  it('forgets a choice the list no longer has', () => {
    expect(options(LIST, at({ board: 'CBSE', cls: '7', subject: 'Science', chapter: 'X' })).place).toMatchObject({ cls: '', chapter: '' });
  });

  it('says what is still to choose, then which chapter the questions go to', () => {
    expect(whereOf(LIST, at({ board: 'CBSE' })).todo).toBe('Choose the board, class and subject.');
    expect(whereOf(LIST, at({ board: 'CBSE', cls: '9', subject: 'Science' })).todo).toBe('Choose the chapter.');
    const w = whereOf(LIST, at({ board: 'CBSE', cls: '9', subject: 'Science', chapter: 'CBSE09SCI05' }));
    expect(w.where).toEqual({ chapter_id: 'CBSE09SCI05', board: 'CBSE', class: 9, subject: 'Science', chapter_no: 5, chapter: 'The Fundamental Unit of Life' });
    expect(w.chapter?.name).toBe('The Fundamental Unit of Life');
  });

  it('finds the chapter of a question already sent ("Fix it")', () => {
    expect(placeOf(LIST, { chapter_id: 'ICSE09PHY06' })).toEqual({ board: 'ICSE', cls: '9', subject: 'Physics', chapter: 'ICSE09PHY06' });
    expect(placeOf(LIST, { chapter_id: 'NOPE' })).toEqual(NO_PLACE);
  });
});
