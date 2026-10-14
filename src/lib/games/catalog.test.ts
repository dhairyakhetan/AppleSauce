import { describe, expect, it } from 'vitest';
import { chaptersFor, checkList, sameName } from './catalog';
import { format } from './format';
import type { ListChapter } from './rows';

/* Questions can only be written for a chapter on the fixed list, under its name, and under its topics where the list
   gives them; a chapter it gives none takes topics of its own, one number and one name each. The database refuses the
   rest; this is what the person sees on the lines before sending. */

const LIST: ListChapter[] = [
  { chapter_id: 'CBSE07SCI04', board: 'CBSE', class: 7, subject: 'Science', chapter_no: 4, name: 'Heat', topics: [
    { topic_id: 'CBSE07SCI04T01', topic_no: 1, name: 'Hot and Cold' },
    { topic_id: 'CBSE07SCI04T02', topic_no: 2, name: 'Transfer of Heat' },
  ] },
  { chapter_id: 'CBSE07SCI05', board: 'CBSE', class: 7, subject: 'Science', chapter_no: 5, name: 'Acids, Bases and Salts', topics: [] },
  { chapter_id: 'CBSE07SCI02', board: 'CBSE', class: 7, subject: 'Science', chapter_no: 2, name: 'Nutrition in Animals', topics: [] },
  // open, with a topic already written with questions sent to it
  { chapter_id: 'CBSE07SCI01', board: 'CBSE', class: 7, subject: 'Science', chapter_no: 1, name: 'Nutrition in Plants', open: true, topics: [
    { topic_id: 'CBSE07SCI01T01', topic_no: 1, name: 'Photosynthesis' },
  ] },
];
const TOP = 'Board: CBSE\nClass: 7\nSubject: Science\n';
/** One question block: its Q: line, then its A: line. */
const qa = (q: string, a: string) => `Q: ${q}\nA: ${a}\n`;
const check = (text: string) => {
  const { rows } = format(text);
  return { rows, ...checkList(text, rows, LIST) };
};

describe('the list of chapters and topics', () => {
  it('compares names the way the database does', () => {
    expect(sameName('Transfer of Heat', '  transfer  of heat. ')).toBe(true);
    expect(sameName('Heat', 'Heating')).toBe(false);
  });

  it('gives the chapters for the boxes, in order, from names as written there', () => {
    expect(chaptersFor(LIST, 'cbse', 'Class 7', 'science').map((c) => c.chapter_no)).toEqual([1, 2, 4, 5]);
    expect(chaptersFor(LIST, 'CBSE', '8', 'Science')).toEqual([]);
    expect(chaptersFor(LIST, '', '7', 'Science')).toEqual([]);
  });

  it('passes questions written under a listed chapter and topic', () => {
    const r = check(`${TOP}Chapter 4: Heat\nTopic 2: Transfer of Heat\n${qa('Heat flowing through a solid', 'Conduction')}`);
    expect(r.issues).toEqual([]);
    expect(r.blocked.size).toBe(0);
    expect(r.rows).toHaveLength(1);
  });

  it('a chapter the list gives no topics takes topics of its own, or none', () => {
    expect(check(`${TOP}Chapter 5: Acids, Bases and Salts\n${qa('Taste of an acid', 'Sour')}`).issues).toEqual([]);
    const r = check(`${TOP}Chapter 5: Acids, Bases and Salts\nTopic 1: Acids\n${qa('Taste of an acid', 'Sour')}Topic 2: Bases\n${qa('Feel of a base', 'Soapy')}`);
    expect(r.issues).toEqual([]);
    expect(r.rows.map((x) => [x.topic_id, x.topic])).toEqual([['CBSE07SCI05T01', 'Acids'], ['CBSE07SCI05T02', 'Bases']]);
    // its topics in use, and new ones after them
    expect(check(`${TOP}Chapter 1: Nutrition in Plants\nTopic 1: Photosynthesis\n${qa('Gas plants give out by day', 'Oxygen')}Topic 2: Other Modes of Nutrition\n${qa('Plant that traps insects', 'Pitcher plant')}`).issues).toEqual([]);
  });

  it('keeps one number and one name for each topic of an open chapter, and says which number is free', () => {
    const taken = check(`${TOP}Chapter 1: Nutrition in Plants\nTopic 1: Saprotrophs\n${qa('Fungi feed on', 'Dead matter')}`);
    expect(taken.issues.map((x) => [x.line, x.text, x.fix])).toEqual([[5, 'Topic 1 of chapter 1 is already "Photosynthesis".',
      'Change it to "Topic 1: Photosynthesis" if its questions belong there; otherwise number it 2: "Topic 2: Saprotrophs".']]);
    expect([...taken.blocked]).toEqual([6]);
    const moved = check(`${TOP}Chapter 1: Nutrition in Plants\nTopic 3: photosynthesis\n${qa('Pigment in leaves', 'Chlorophyll')}`);
    expect(moved.issues.map((x) => [x.text, x.fix])).toEqual([['Chapter 1 already has "Photosynthesis" as topic 1.', 'Change it to "Topic 1: Photosynthesis", its number in this chapter.']]);
    // and within the text itself
    const twice = check(`${TOP}Chapter 5: Acids, Bases and Salts\nTopic 1: Acids\n${qa('Taste of an acid', 'Sour')}Topic 1: Bases\n${qa('Feel of a base', 'Soapy')}Topic 3: Acids\n${qa('Acid in lemons', 'Citric acid')}`);
    expect(twice.issues.map((x) => [x.line, x.text, x.fix])).toEqual([
      [8, 'Topic 1 is "Acids" earlier in the text.', 'Number it 4 instead: "Topic 4: Bases".'],
      [11, '"Acids" is topic 1 earlier in the text.', 'Change it to "Topic 1: Acids".'],
    ]);
    expect([...twice.blocked]).toEqual([9, 12]);
  });

  it('says on the Chapter line when the chapter is not on the list, and names what is', () => {
    const r = check(`${TOP}Chapter 9: Light\nTopic 1: Mirrors\n${qa('Image in a plane mirror', 'Virtual')}${qa('Another', 'One')}`);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ line: 4, level: 'error' });
    expect(r.issues[0].text).toContain('2: Nutrition in Animals; 4: Heat; 5: Acids, Bases and Salts');
    expect([...r.blocked]).toEqual([6, 8]);
  });

  it('says when the list has nothing for the board, class and subject', () => {
    const r = check(`Board: CBSE\nClass: 8\nSubject: Science\nChapter 1: Crop Production\nTopic 1: Crops\n${qa('A crop grown in winter', 'Rabi')}`);
    expect(r.issues[0].text).toMatch(/no chapters for CBSE class 8 Science yet/);
  });

  it('asks for the name on the list when the chapter or topic is called something else', () => {
    const r = check(`${TOP}Chapter 4: Heating\nTopic 1: Hot and cold things\n${qa('Unit of temperature', 'Celsius')}`);
    expect(r.issues.map((x) => [x.line, x.text, x.fix])).toEqual([
      [4, 'On the list, chapter 4 is called "Heat".', 'Change it to "Chapter 4: Heat", its name on the list.'],
      [5, 'On the list, topic 1 of chapter 4 is called "Hot and Cold".', 'Use one of these Topic lines, the one its questions belong to: "Topic 1: Hot and Cold", "Topic 2: Transfer of Heat".'],
    ]);
    expect([...r.blocked]).toEqual([6]);
  });

  it('needs a listed topic for a chapter that has topics', () => {
    const missing = check(`${TOP}Chapter 4: Heat\n${qa('Unit of temperature', 'Celsius')}`);
    expect(missing.issues).toEqual([{ line: 5, level: 'error', text: expect.stringMatching(/needs a Topic line.*1 Hot and Cold, 2 Transfer of Heat/),
      fix: 'Put it under the one of these Topic lines it belongs to: "Topic 1: Hot and Cold", "Topic 2: Transfer of Heat".' }]);
    const wrong = check(`${TOP}Chapter 4: Heat\nTopic 7: Sea Breeze\n${qa('Wind from the sea by day', 'Sea breeze')}`);
    expect(wrong.issues).toEqual([{ line: 5, level: 'error', text: expect.stringMatching(/no topic 7/),
      fix: 'Use one of these Topic lines, the one its questions belong to: "Topic 1: Hot and Cold", "Topic 2: Transfer of Heat".' }]);
  });

  it("tells a chatbot to renumber a listed topic or chapter under the wrong number, not to rename it", () => {
    const topic = check(`${TOP}Chapter 4: Heat\nTopic 1: Transfer of Heat\n${qa('Heat moving through a metal spoon', 'Conduction')}Topic 9: Transfer of heat\n${qa('A', 'B')}`);
    expect(topic.issues.map((x) => [x.line, x.fix])).toEqual([
      [5, 'Change it to "Topic 2: Transfer of Heat", its number on the list.'],
      [8, 'Change it to "Topic 2: Transfer of Heat", its number on the list.'],
    ]);
    const chapter = check(`${TOP}Chapter 2: Heat\n${qa('Unit of temperature', 'Celsius')}`);
    expect(chapter.issues.map((x) => x.fix)).toEqual(['Change it to "Chapter 4: Heat", its number on the list.']);
    const nowhere = check(`${TOP}Chapter 9: Light\nTopic 1: Mirrors\n${qa('Image in a plane mirror', 'Virtual')}`);
    expect(nowhere.issues[0].fix).toBe('Use one of these Chapter lines, the one the questions are from: "Chapter 1: Nutrition in Plants", "Chapter 2: Nutrition in Animals", "Chapter 4: Heat", "Chapter 5: Acids, Bases and Salts".');
  });

  it('blocks only the questions with a problem, and reports a shared line once', () => {
    const r = check(`${TOP}Chapter 4: Heat\nTopic 1: Hot and Cold\n${qa('Unit of temperature', 'Celsius')}Topic 3: Weather\n${qa('A', 'B')}${qa('C', 'D')}`);
    expect(r.issues).toHaveLength(1);
    expect([...r.blocked]).toEqual([9, 11]);
  });

  it('leaves questions with no chapter ID to the formatter', () => {
    expect(check(`Topic 1: Hot and Cold\n${qa('Unit of temperature', 'Celsius')}`).issues).toEqual([]);
  });
});
