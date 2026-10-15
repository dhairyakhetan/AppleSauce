import { describe, expect, it } from 'vitest';
import { parseList } from './list-rows';
import { STARTING_LIST } from './starting-list';

/* What an admin pastes on the Chapters page: one row per chapter (or per topic), each problem on its line, and nothing
   added while any remains. Names are read the way the Write page reads them. */

describe('pasted chapters', () => {
  it('reads rows written by hand or copied from a spreadsheet, skipping a header and notes', () => {
    const { chapters, problems } = parseList([
      'Board | Class | Subject | Chapter number | Chapter | Topic number | Topic',
      '# Physics',
      'icse | X | physics | 1 | Force',
      'ICSE\t10\tPhysics\t2\tWork, Energy and Power\t1\tWork',
      'ICSE\t10\tPhysics\t2\tWork, Energy and Power\t2\tEnergy',
      'ICSE | 10 | Physics | 3 | Machines |  |  ',
      'CBSE | 9 | Maths | 1 | Number Systems',
    ].join('\n'));
    expect(problems).toEqual([]);
    expect(chapters).toEqual([
      { board: 'ICSE', class: 10, subject: 'Physics', chapter_no: 1, name: 'Force', topics: [] },
      { board: 'ICSE', class: 10, subject: 'Physics', chapter_no: 2, name: 'Work, Energy and Power', topics: [{ topic_no: 1, name: 'Work' }, { topic_no: 2, name: 'Energy' }] },
      { board: 'ICSE', class: 10, subject: 'Physics', chapter_no: 3, name: 'Machines', topics: [] },
      { board: 'CBSE', class: 9, subject: 'Mathematics', chapter_no: 1, name: 'Number Systems', topics: [] },
    ]);
  });

  it('puts each problem on its line and says what to change', () => {
    const { problems } = parseList([
      'ICSE | 10 | Physics | Force', // 1: four columns
      'Kolkata Board | 13 | Physix | 0 | Force', // 2
      'ICSE | 10 | Physics | 1 | Light – Reflection', // 3: a dash
      'ICSE | 10 | Physics | 2 | Sound',
      'ICSE | 10 | Physics | 2 | Noise', // 5: chapter 2 has another name
      'ICSE | 10 | Physics | 3 | sound', // 6: the same name under another number
      'ICSE | 10 | Physics | 4 | Heat | 1 | Calorimetry',
      'ICSE | 10 | Physics | 4 | Heat', // 8: a row without a topic
      'ICSE | 10 | Physics | 4 | Heat | 1 | Specific Heat', // 9: topic 1 has another name
      'ICSE | 10 | Physics | 4 | Heat | 2 | calorimetry', // 10: the same topic under another number
    ].join('\n'));
    expect(problems.map((p) => p.line)).toEqual([1, 2, 3, 5, 6, 8, 9, 10]);
    const at = (n: number) => problems.find((p) => p.line === n)!.text;
    expect(at(1)).toMatch(/has 4 columns\. It needs 5/);
    expect(at(2)).toMatch(/"Kolkata Board" isn't a board.*Class must be from 1 to 12.*"Physix" isn't a subject.*chapter number "0" must be from 1 to 99/);
    expect(at(3)).toBe('No dashes in a chapter name ("Light – Reflection"): use a colon or a comma.');
    expect(at(5)).toBe('Chapter 2 is "Sound" on line 4, so it can\'t be "Noise" here.');
    expect(at(6)).toBe('"sound" is already chapter 2 (line 4).');
    expect(at(8)).toMatch(/has topics on other lines/);
    expect(at(9)).toMatch(/Topic 1 of chapter 4 is "Calorimetry" above/);
    expect(at(10)).toMatch(/"calorimetry" is already topic 1 of chapter 4/);
  });

  it('the starting list reads with no problems: 564 chapters, no topics, numbered from 1 in each subject', () => {
    const { chapters, problems } = parseList(STARTING_LIST);
    expect(problems).toEqual([]);
    expect(chapters).toHaveLength(564);
    expect(chapters.every((c) => !c.topics.length)).toBe(true);
    const groups = new Map<string, number[]>();
    for (const c of chapters) groups.set(`${c.board} ${c.class} ${c.subject}`, [...(groups.get(`${c.board} ${c.class} ${c.subject}`) ?? []), c.chapter_no]);
    for (const [g, nos] of groups) expect(nos, g).toEqual(nos.map((_, i) => i + 1));
    expect(groups.size).toBe(46); // 12 from the site, 34 drafted
  });
});
