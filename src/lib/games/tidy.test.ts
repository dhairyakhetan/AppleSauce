import { describe, expect, it } from 'vitest';
import { EXAMPLE, format } from './format';
import type { ListChapter } from './rows';
import { tidyText } from './tidy';

const list: ListChapter[] = [
  { chapter_id: 'CB07SC04', board: 'CBSE', class: 7, subject: 'Science', chapter_no: 4, name: 'Heat', topics: [
    { topic_no: 1, name: 'Hot and Cold' }, { topic_no: 2, name: 'Transfer of Heat' },
  ] } as ListChapter,
  { chapter_id: 'CB06MA04', board: 'CBSE', class: 6, subject: 'Mathematics', chapter_no: 4, name: 'Basic Geometrical Ideas', topics: [] } as ListChapter,
];
const run = (text: string, caret: number | null = null, keep = {}) => tidyText(text, { list, caret, keep });

const HEAD = 'Board: CBSE\nClass: 7\nSubject: Science\nChapter 4: Heat\nTopic 1: Hot and Cold\n\n';
const Q = 'Q: Instrument that measures temperature\nA: Thermometer\nFill: Temperature is measured with an instrument called a ___.\nWrong: Barometer; Hygrometer; Ammeter\nLevel: easy';

describe('tidyText', () => {
  it('leaves a correct text exactly as it is', () => {
    expect(run(HEAD + Q).text).toBe(HEAD + Q);
    expect(run(HEAD + Q + '\n\n' + Q.replace('Thermometer', 'Thermometers')).text).toBe(HEAD + Q + '\n\n' + Q.replace('Thermometer', 'Thermometers'));
  });

  it('leaves the page\'s example as it is', () => {
    expect(run(EXAMPLE).text).toBe(EXAMPLE);
  });

  it('writes board, class and subject the site\'s way', () => {
    const t = run('board: cBsE\nClass: VII\nsubject: science\nChapter 4: Heat\n\n' + Q).text;
    expect(t.split('\n').slice(0, 3)).toEqual(['Board: CBSE', 'Class: 7', 'Subject: Science']);
    expect(run('Board: cbsu\n\n' + Q).text.split('\n')[0]).toBe('Board: CBSE');
  });

  it('puts chapter and topic lines in the list\'s wording', () => {
    const t = run('Board: CBSE\nClass: 7\nSubject: Science\nchapter 4: heat\ntopic: transfer of heat\n\n' + Q).text.split('\n');
    expect(t[3]).toBe('Chapter 4: Heat');
    expect(t[4]).toBe('Topic 2: Transfer of Heat');
    expect(run('Board: CBSE\nClass: 7\nSubject: Science\nChapter 4\nTopic 1\n\n' + Q).text.split('\n').slice(3, 5)).toEqual(['Chapter 4: Heat', 'Topic 1: Hot and Cold']);
    expect(run('Board: CBSE\nClass: 6\nSubject: Mathematics\nChapter 4: Basic Geometrical Idea\n\n' + Q).text.split('\n')[3]).toBe('Chapter 4: Basic Geometrical Ideas');
  });

  it('leaves a chapter or topic it can\'t be sure of', () => {
    const odd = 'Board: CBSE\nClass: 7\nSubject: Science\nChapter 4: Light\nTopic 3: Evaporation\n\n' + Q;
    expect(run(odd).text).toBe(odd);
  });

  it('leaves a Topic line whose number and name disagree', () => {
    for (const t of ['Topic 2: Hot and Cold', 'Topic 5: Hot and Cold']) {
      const text = HEAD.replace('Topic 1: Hot and Cold', t) + Q;
      expect(run(text).text).toBe(text);
    }
  });

  it('fixes no topic under a chapter it couldn\'t be sure of', () => {
    const text = 'Board: CBSE\nClass: 7\nSubject: Science\nChapter 4: Light\nTopic: transfer of heat\n\n' + Q;
    expect(run(text).text).toBe(text);
  });

  it('leaves the commas of a Wrong line still being typed', () => {
    const text = HEAD + Q.replace('Wrong: Barometer; Hygrometer; Ammeter', 'Wrong: Red, White, Blue');
    expect(run(text, text.indexOf('Blue') + 4).text).toBe(text);
  });

  it('leaves a line whose fix the writer took back', () => {
    const line = 'Wrong: Red, White, Blue';
    const text = HEAD + Q.replace('Wrong: Barometer; Hygrometer; Ammeter', line);
    expect(tidyText(text, { list, caret: null, leave: new Set([line]) }).text).toBe(text);
  });

  it('puts no blank line before a Q: line, and no chapter line back, when the writer took that back', () => {
    const q2 = 'Q: Instrument that measures pressure';
    const text = HEAD + Q + '\n' + q2 + '\nA: Barometer';
    expect(run(text).text).toContain('\n\n' + q2);
    expect(tidyText(text, { list, caret: null, leave: new Set([q2]) }).text).toBe(text);
    const keep = { board: 'CBSE', class: '7', subject: 'Science', chapter: '4: Heat' };
    const noBoard = 'Class: 7\nSubject: Science\nChapter 4: Heat\n\n' + Q;
    expect(tidyText(noBoard, { list, caret: null, keep }).text).toBe('Board: CBSE\n' + noBoard);
    expect(tidyText(noBoard, { list, caret: null, keep, leave: new Set(['Board: CBSE']) }).text).toBe(noBoard);
  });

  it('fixes only the code block of a pasted reply, never the chatbot\'s sentences around it', () => {
    const reply = 'Here you go.\nwrong: a note, with, commas\n\n```\n' + HEAD + Q.replace('Level: easy', 'Level: Easy') + '\n```\nLevel: Easy ones first, as you asked.';
    const t = run(reply).text;
    expect(t).toContain('wrong: a note, with, commas');
    expect(t).toContain('Level: Easy ones first, as you asked.');
    expect(t).toContain('Level: easy\n```');
  });

  it('leaves a Wrong line whose commas may be inside an option', () => {
    const text = HEAD + Q.replace('Wrong: Barometer; Hygrometer; Ammeter', 'Wrong: Copper, zinc and tin, Wood, Glass, Plastic');
    expect(run(text).text).toBe(text);
  });

  it('fixes labels, levels and commas, never the words', () => {
    const t = run(HEAD + 'q1: Instrument that measures temperature\na: Thermometer\nfill: Temperature is measured with a ___ here.\nwrong: Barometer, Hygrometer, Ammeter\nLEVEL: Easy.').text;
    expect(t).toBe(HEAD + 'Q: Instrument that measures temperature\nA: Thermometer\nFill: Temperature is measured with a ___ here.\nWrong: Barometer; Hygrometer; Ammeter\nLevel: easy');
    expect(run(HEAD + Q.replace('Barometer; Hygrometer; Ammeter', '1,000, 2,000, 3,000')).text).toContain('Wrong: 1,000, 2,000, 3,000');
  });

  it('puts a blank line before each question', () => {
    expect(run(HEAD.trimEnd() + '\n' + Q + '\n' + Q.replace('Thermometer', 'Thermometers')).text).toBe(HEAD + Q + '\n\n' + Q.replace('Thermometer', 'Thermometers'));
  });

  it('leaves the caret\'s line alone except for capitals', () => {
    const text = HEAD + 'q1: Instrument';
    const r = run(text, text.length);
    expect(r.text).toBe(text);
    expect(r.caret).toBe(text.length);
    const b = 'Board: cbsu';
    expect(run(b, b.length)).toEqual({ text: 'Board: CBSE', caret: b.length });
  });

  it('keeps the caret on its line when lines above change', () => {
    const text = HEAD.trimEnd() + '\n' + Q + '\n\nQ: Next';
    const r = run(text, text.length - 2);
    expect(r.text).toBe(HEAD + Q + '\n\nQ: Next');
    expect(r.caret).toBe(r.text.length - 2);
  });

  it('puts deleted chapter lines back once the writer has moved on', () => {
    const keep = { board: 'CBSE', class: '7', subject: 'Science', chapter: '4: Heat' };
    const text = 'Class: 7\nSubject: Science\nChapter 4: Heat\n\n' + Q;
    // still on the top lines: nothing yet
    expect(run(text, 0, keep).text).toBe(text);
    // below them: back, and the caret moves down with its line
    const at = text.indexOf('A: Thermometer');
    const r = run(text, at, keep);
    expect(r.text).toBe('Board: CBSE\n' + text);
    expect(r.text.slice(r.caret!)).toMatch(/^A: Thermometer/);
    // left the box
    expect(run(text, null, keep).text).toBe('Board: CBSE\n' + text);
    // not into a pasted reply that has them further down
    const reply = 'Here are your questions.\n\n```\n' + HEAD + Q + '\n```';
    expect(run(reply, null, keep).text).toBe(reply);
  });

  it('turns the worst-typed text into one the checker accepts', () => {
    const messy = 'board: cbsu\nclass: vii\nsubject: SCIENCE\nchapter 4: heat\ntopic 1: hot and cold\nq1: Instrument that measures temperature\na: Thermometer\nfill: Temperature is measured with an instrument called a ___.\nwrong: Barometer, Hygrometer, Ammeter\nlevel: Easy';
    const t = run(messy).text;
    expect(t).toBe(HEAD + Q);
    expect(format(t).issues).toEqual([]);
  });
});
