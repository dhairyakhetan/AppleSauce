import { describe, expect, it } from 'vitest';
import {
  addChapter, addMany, addTopic, changeCount, changedInside, chapterChanged, chaptersOf, deleteChapter, deleteTopic, draftOf, isOpen, keepChapter, keepTopic,
  nextNumber, renameChapter, renameTopic, renumberChapter, renumberTopic, setOpen, toSave, topicChanged,
} from './list-draft';
import type { AdminChapter } from './rows';

/* The Chapters page's unsaved changes: each edit checked the way the database checks it, what changed worked out
   against the list as loaded, and what "Save changes" sends. */

const G = { board: 'CBSE', class: 8, subject: 'History' };
const ch = (no: number, name: string, questions: number, topics: [number, string, number][] = [], open = !topics.length): AdminChapter => ({
  chapter_id: `CBSE08HIS0${no}`, board: 'CBSE', class: 8, subject: 'History', chapter_no: no, name, open, questions,
  topics: topics.map(([tno, tname, q]) => ({ topic_id: `CBSE08HIS0${no}T0${tno}`, topic_no: tno, name: tname, questions: q })),
});
const LOADED = [
  ch(2, 'From Trade to Territory', 17, [[1, 'The East India Company Comes East', 5], [2, 'From Trade to Wars', 6], [3, 'Company Rule Expands', 6]], false),
  ch(1, 'How, When and Where', 0),
  ch(3, 'Ruling the Countryside', 3, [[1, 'Revenue for the Company', 2]], true),
];
const start = () => draftOf(chaptersOf([...LOADED, { ...ch(1, 'Elsewhere', 0), subject: 'Geography' }], G));

describe('the draft of a subject\'s chapters', () => {
  it('starts as loaded, in order, with nothing changed', () => {
    const d = start();
    expect(d.map((c) => [c.key, c.chapter_no, c.untopiced])).toEqual([['CBSE08HIS01', 1, 0], ['CBSE08HIS02', 2, 0], ['CBSE08HIS03', 3, 1]]);
    expect(changeCount(d)).toBe(0);
    expect(nextNumber(d)).toBe(4);
    expect(toSave(G, LOADED, d).after).toEqual(toSave(G, LOADED, d).before.map((c) => ({ ...c, topics: c.topics.map((t) => ({ was: t.topic_no, ...t })) })));
  });

  it('renames, checking the name the way the database does, and an edit undone by hand is no change', () => {
    let d = start();
    expect(() => renameChapter(d, 'CBSE08HIS01', '  ')).toThrow('A name needs 1 to 120 characters.');
    expect(() => renameChapter(d, 'CBSE08HIS01', 'Trade – Territory')).toThrow('No dashes in a name: use a colon or a comma.');
    expect(() => renameChapter(d, 'CBSE08HIS01', 'from trade to territory.')).toThrow('There is already a chapter called "From Trade to Territory".');
    d = renameChapter(d, 'CBSE08HIS01', '  How, When and Where: Dates  ');
    expect(chapterChanged(d[0])).toMatchObject({ renamed: 'How, When and Where', renumbered: null, added: false });
    expect([d[0].name, changeCount(d)]).toEqual(['How, When and Where: Dates', 1]);
    d = renameChapter(d, 'CBSE08HIS01', 'How, When and Where');
    expect(changeCount(d)).toBe(0);
    // its own name in another case is fine
    expect(renameChapter(d, 'CBSE08HIS01', 'how, when and where')[0].name).toBe('how, when and where');
  });

  it('changes a number only while nothing has been sent, and to a free one', () => {
    let d = start();
    expect(() => renumberChapter(d, 'CBSE08HIS02', 5)).toThrow("It has 17 questions, so its number stays: the number is part of each question's ID.");
    expect(() => renumberChapter(d, 'CBSE08HIS01', 3)).toThrow('Chapter 3 is "Ruling the Countryside". Give that one another number first.');
    expect(() => renumberChapter(d, 'CBSE08HIS01', 100)).toThrow('A number must be from 1 to 99.');
    d = renumberChapter(d, 'CBSE08HIS01', 4);
    expect(d.map((c) => c.chapter_no)).toEqual([2, 3, 4]);
    expect(chapterChanged(d[2]).renumbered).toBe(1);
    // its topics' numbers too, while they have no questions
    expect(() => renumberTopic(d, 'CBSE08HIS02', 't1', 4)).toThrow(/It has 5 questions, so its number stays/);
  });

  it('deletes only what has no questions: a new one goes at once, a loaded one is marked until kept', () => {
    let d = start();
    expect(() => deleteChapter(d, 'CBSE08HIS03')).toThrow("It has 3 questions, so it can't be deleted. Rename it instead.");
    d = deleteChapter(d, 'CBSE08HIS01');
    expect([d.length, d[0].deleted, chapterChanged(d[0]).deleted, changeCount(d)]).toEqual([3, true, true, 1]);
    // its number is free while it is marked; taking it blocks keeping it
    d = addChapter(d, 1, 'Civilising the Native');
    expect(() => keepChapter(d, 'CBSE08HIS01')).toThrow('Chapter 1 is now "Civilising the Native". Give that one another number first.');
    d = deleteChapter(d, 'new1');
    expect(d.some((c) => c.key === 'new1')).toBe(false);
    d = keepChapter(d, 'CBSE08HIS01');
    expect(changeCount(d)).toBe(0);
  });

  it('adds chapters and topics under free numbers and names, and counts each once', () => {
    let d = start();
    expect(() => addChapter(d, 2, 'Tribals')).toThrow('Chapter 2 is "From Trade to Territory". Give the new one another number.');
    d = addChapter(d, 4, 'Tribals, Dikus and the Vision of a Golden Age');
    d = addTopic(d, 'new1', 1, 'How Did Tribal Groups Live?');
    d = addTopic(d, 'new1', 2, 'Birsa Munda');
    expect(() => addTopic(d, 'new1', 3, 'birsa munda')).toThrow('This chapter already has a topic called "Birsa Munda".');
    expect(d.map((c) => c.key)).toEqual(['CBSE08HIS01', 'CBSE08HIS02', 'CBSE08HIS03', 'new1']);
    expect(changeCount(d)).toBe(3);
    expect(isOpen(d[3])).toBe(true); // a new chapter's topics are open until they are fixed
  });

  it('edits topics: rename, number, delete and keep, by the same rules', () => {
    let d = start();
    expect(() => renameTopic(d, 'CBSE08HIS02', 't2', 'company rule expands')).toThrow('This chapter already has a topic called "Company Rule Expands".');
    d = renameTopic(d, 'CBSE08HIS02', 't2', 'From Trade to War');
    expect(topicChanged(d[1].topics[1]).renamed).toBe('From Trade to Wars');
    expect(changedInside(d[1])).toBe(true);
    expect(() => deleteTopic(d, 'CBSE08HIS02', 't3')).toThrow(/It has 6 questions, so it can't be deleted/);
    d = addTopic(d, 'CBSE08HIS01', 1, 'Dates');
    d = addTopic(d, 'CBSE08HIS01', 2, 'Colonial Records');
    d = deleteTopic(d, 'CBSE08HIS01', 'n1');
    d = renumberTopic(d, 'CBSE08HIS01', 'n2', 1);
    expect(d[0].topics.map((t) => [t.key, t.topic_no])).toEqual([['n2', 1]]);
    expect(() => keepTopic(d, 'CBSE08HIS02', 't1')).not.toThrow();
  });

  it('fixes topics only when there are some, and a chapter with none left is open', () => {
    let d = start();
    expect(() => setOpen(d, 'CBSE08HIS01', false)).toThrow('Add its topics first, then fix them.');
    d = setOpen(d, 'CBSE08HIS03', false);
    expect(chapterChanged(d[2]).topics).toBe('fixed');
    d = setOpen(d, 'CBSE08HIS03', true);
    expect(changeCount(d)).toBe(0);
    // a fixed chapter whose topics all go is open again
    d = addTopic(d, 'CBSE08HIS01', 1, 'Dates');
    d = setOpen(d, 'CBSE08HIS01', false);
    expect(isOpen(d[0])).toBe(false);
    d = deleteTopic(d, 'CBSE08HIS01', 'n1');
    expect([isOpen(d[0]), chapterChanged(d[0]).topics]).toEqual([true, null]);
  });

  it('saves the list as loaded and as it is to be: deleted ones left out, each topic with the number it had', () => {
    let d = start();
    d = renameTopic(d, 'CBSE08HIS02', 't2', 'From Trade to War');
    d = deleteChapter(d, 'CBSE08HIS01');
    d = addChapter(d, 4, 'Tribals');
    d = addTopic(d, 'CBSE08HIS03', 2, 'The Permanent Settlement');
    const save = toSave(G, LOADED, d);
    expect(save.before.map((c) => [c.chapter_id, c.open, c.topics.length])).toEqual([['CBSE08HIS01', true, 0], ['CBSE08HIS02', false, 3], ['CBSE08HIS03', true, 1]]);
    expect(Object.keys(save.before[0])).toEqual(['chapter_id', 'chapter_no', 'name', 'open', 'topics']);
    expect(save.after).toEqual([
      { chapter_id: 'CBSE08HIS02', chapter_no: 2, name: 'From Trade to Territory', open: false, topics: [
        { was: 1, topic_no: 1, name: 'The East India Company Comes East' }, { was: 2, topic_no: 2, name: 'From Trade to War' }, { was: 3, topic_no: 3, name: 'Company Rule Expands' },
      ] },
      { chapter_id: 'CBSE08HIS03', chapter_no: 3, name: 'Ruling the Countryside', open: true, topics: [
        { was: 1, topic_no: 1, name: 'Revenue for the Company' }, { was: null, topic_no: 2, name: 'The Permanent Settlement' },
      ] },
      { chapter_id: null, chapter_no: 4, name: 'Tribals', open: true, topics: [] },
    ]);
  });

  it('adds many chapters at once, with their topics, numbered in order unless a line gives its number', () => {
    const { draft, chapters, topics } = addMany(start(), [
      'Civilising the Native',
      '- Educating the Nation',
      '- 3. The Agenda for National Education',
      '',
      '  Women, Caste and Reform  ',
      '9) Colonialism and the City',
      '* Delhi',
    ].join('\n'));
    expect([chapters, topics]).toEqual([3, 3]);
    expect(draft.filter((c) => !c.was).map((c) => [c.chapter_no, c.name, c.topics.map((t) => `${t.topic_no} ${t.name}`)])).toEqual([
      [4, 'Civilising the Native', ['1 Educating the Nation', '3 The Agenda for National Education']],
      [5, 'Women, Caste and Reform', []],
      [9, 'Colonialism and the City', ['1 Delhi']],
    ]);
    expect(changeCount(draft)).toBe(6);
  });

  it('names the line with a problem, and then adds none of them', () => {
    const d = start();
    expect(() => addMany(d, 'Tribals\nFrom Trade to Territory')).toThrow('Line 2: There is already a chapter called "From Trade to Territory".');
    expect(() => addMany(d, '- Dates\nTribals')).toThrow('Line 1: A topic needs its chapter on a line above it.');
    expect(() => addMany(d, 'Tribals\n2. Weavers')).toThrow('Line 2: Chapter 2 is "From Trade to Territory". Give the new one another number.');
    expect(() => addMany(d, 'Tribals – Dikus')).toThrow('Line 1: No dashes in a name: use a colon or a comma.');
    expect(() => addMany(d, '\n \n')).toThrow('Write at least one chapter, one per line.');
    expect(d.filter((c) => !c.was)).toEqual([]);
  });
});
