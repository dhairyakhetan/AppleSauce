import { describe, expect, it } from 'vitest';
import { NO_PLACE, options, placeOf, whereOf } from './place';
import type { ListChapter } from './rows';

const ch = (board: string, cls: number, subject: string, no: number, name: string, topics: string[], open?: boolean): ListChapter => ({
  chapter_id: `${board}${String(cls).padStart(2, '0')}${subject.slice(0, 3).toUpperCase()}${String(no).padStart(2, '0')}`, board, class: cls, subject, chapter_no: no, name,
  topics: topics.map((t, i) => ({ topic_id: `x${i}`, topic_no: i + 1, name: t })), open,
});
const LIST = [
  ch('CBSE', 7, 'Science', 4, 'Heat', ['Hot and Cold', 'Transfer of Heat']),
  ch('CBSE', 7, 'Science', 2, 'Nutrition in Animals', []),
  ch('CBSE', 7, 'Science', 6, 'Respiration', ['Breathing']),
  ch('CBSE', 10, 'Science', 1, 'Chemical Reactions', ['Equations'], true),
  ch('ICSE', 6, 'Geography', 2, 'Landforms', ['Mountains']),
];
const at = (p: Partial<typeof NO_PLACE>) => ({ ...NO_PLACE, ...p });

describe('choosing where questions go', () => {
  it('offers only what the list has, each choice narrowing the next, and fills in a dropdown with one choice', () => {
    const o = options(LIST, at({ board: 'CBSE' }));
    expect(o.boards).toEqual(['CBSE', 'ICSE']);
    expect(o.classes).toEqual([7, 10]);
    expect(options(LIST, at({ board: 'ICSE' })).place).toMatchObject({ cls: '6', subject: 'Geography', chapter: 'ICSE06GEO02', topic: 't1' });
    expect(options(LIST, at({ board: 'CBSE', cls: '7', subject: 'Science' })).chapters.map((c) => c.chapter_no)).toEqual([2, 4, 6]);
  });

  it('forgets a choice the list no longer has', () => {
    expect(options(LIST, at({ board: 'CBSE', cls: '9', subject: 'Science', chapter: 'X', topic: 't1' })).place).toMatchObject({ cls: '', chapter: '', topic: '' });
  });

  it("offers a fixed chapter's topics only; an open chapter's, a new topic, and no topic", () => {
    expect(options(LIST, at({ board: 'CBSE', cls: '7', subject: 'Science', chapter: 'CBSE07SCI04' })).topics.map((t) => t.value)).toEqual(['t1', 't2']);
    expect(options(LIST, at({ board: 'CBSE', cls: '7', subject: 'Science', chapter: 'CBSE07SCI02' })).topics.map((t) => t.value)).toEqual(['new', 'none']);
    expect(options(LIST, at({ board: 'CBSE', cls: '10', chapter: 'CBSE10SCI01' })).topics.map((t) => t.value)).toEqual(['t1', 'new', 'none']);
  });

  it('says what is still to choose, then where the questions go', () => {
    expect(whereOf(LIST, at({ board: 'CBSE' })).todo).toBe('Choose the board, class and subject.');
    expect(whereOf(LIST, at({ board: 'CBSE', cls: '7', subject: 'Science' })).todo).toBe('Choose the chapter.');
    expect(whereOf(LIST, at({ board: 'CBSE', cls: '7', subject: 'Science', chapter: 'CBSE07SCI04' })).todo).toBe('Choose the topic.');
    expect(whereOf(LIST, at({ board: 'CBSE', cls: '7', subject: 'Science', chapter: 'CBSE07SCI04', topic: 't2' })).where).toEqual({
      chapter_id: 'CBSE07SCI04', board: 'CBSE', class: 7, subject: 'Science', chapter_no: 4, chapter: 'Heat', topic_no: 2, topic: 'Transfer of Heat',
    });
    expect(whereOf(LIST, at({ board: 'CBSE', cls: '7', subject: 'Science', chapter: 'CBSE07SCI02', topic: 'none' })).where).toMatchObject({ topic_no: null, topic: '' });
  });

  it('numbers a new topic after the others, writes its name the standard way, and refuses one the chapter has', () => {
    const p = at({ board: 'CBSE', cls: '10', chapter: 'CBSE10SCI01', topic: 'new' });
    expect(whereOf(LIST, p)).toMatchObject({ where: null, todo: "Write the new topic's name.", newNo: 2 });
    expect(whereOf(LIST, { ...p, newName: '  types of   reactions ' }).where).toMatchObject({ topic_no: 2, topic: 'Types of Reactions' });
    expect(whereOf(LIST, { ...p, newName: 'equations.' }).todo).toBe('This chapter already has "Equations". Choose it in the Topic list instead.');
  });

  it('finds the place of a question already sent ("Fix it")', () => {
    expect(placeOf(LIST, { chapter_id: 'CBSE07SCI04', topic_no: 2, topic: 'Transfer of Heat' })).toMatchObject({ chapter: 'CBSE07SCI04', topic: 't2' });
    expect(placeOf(LIST, { chapter_id: 'CBSE07SCI02', topic_no: null, topic: '' })).toMatchObject({ topic: 'none' });
    expect(placeOf(LIST, { chapter_id: 'CBSE07SCI02', topic_no: 1, topic: 'Digestion' })).toMatchObject({ topic: 'new', newName: 'Digestion' });
    expect(placeOf(LIST, { chapter_id: 'NOPE', topic_no: 1, topic: '' })).toEqual(NO_PLACE);
  });
});
