import { describe, expect, it } from 'vitest';
import { blockOf, checkPlace, EXAMPLE, MAX_PER_SEND, read, toRows, visibleIssues, type Where } from './format';
import { counts, setStatus, toCSV, toJSON, toRecord, type Bank } from './rows';

/** A question with every part, which passes every check. */
const GOOD = `Q: Gas that green plants take in from the air to make their food
A: Carbon dioxide
Also: CO2
Fill: Green plants take in ___ from the air to make their food.
Wrong: Oxygen; Nitrogen; Hydrogen
Level: easy`;
/** The problems with a text, as [line, text]. */
const problems = (text: string) => read(text).issues.map((x) => [x.line, x.text]);
/** The problems' texts only. */
const says = (text: string) => read(text).issues.map((x) => x.text);
const WHERE: Where = {
  chapter_id: 'CBSE10SCI01', board: 'CBSE', class: 10, subject: 'Science', chapter_no: 1, chapter: 'Chemical Reactions and Equations',
  topic_no: 2, topic: 'Types of Chemical Reactions',
};

describe('reading questions', () => {
  it('reads each part from its labelled line, and a question with every part has no problems', () => {
    const { drafts, issues, headers } = read(GOOD);
    expect(issues).toEqual([]);
    expect(headers).toEqual([]);
    expect(drafts).toEqual([{
      question: 'Gas that green plants take in from the air to make their food', answer: 'Carbon dioxide', also: ['CO2'],
      fill: 'Green plants take in ___ from the air to make their food.', wrong: ['Oxygen', 'Nitrogen', 'Hydrogen'], level: 'easy', line: 1, end: 6,
    }]);
  });

  it('reads the labels chatbots write in other ways: bullets, numbers, bold, headings, words written out', () => {
    const text = `1. **Q:** Gas that green plants take in from the air to make their food
- **Answer:** Carbon dioxide
* Also accepted: CO2
**Fill in the blank:** Green plants take in ___ from the air to make their food.
Wrong options: Oxygen; Nitrogen; Hydrogen
Difficulty: Easy.

### Q2. Number of sides of a hexagon
Ans: 6
Also: Six
Fill-in sentence: A hexagon has ___ sides.
Distractors: 5; 7; 8`;
    const { drafts, issues } = read(text);
    expect(issues).toEqual([]);
    expect(drafts.map((d) => [d.question, d.answer, d.also, d.wrong, d.level])).toEqual([
      ['Gas that green plants take in from the air to make their food', 'Carbon dioxide', ['CO2'], ['Oxygen', 'Nitrogen', 'Hydrogen'], 'easy'],
      ['Number of sides of a hexagon', '6', ['Six'], ['5', '7', '8'], null],
    ]);
  });

  it('takes several answers on one Also: line, and several Wrong: lines, as they look', () => {
    const { drafts, issues } = read(GOOD.replace('Also: CO2', 'Also: CO2; Carbonic gas').replace('Wrong: Oxygen; Nitrogen; Hydrogen', 'Wrong: Oxygen\nWrong: Nitrogen\nWrong: Hydrogen'));
    expect(issues).toEqual([]);
    expect(drafts[0].also).toEqual(['CO2', 'Carbonic gas']);
    expect(drafts[0].wrong).toEqual(['Oxygen', 'Nitrogen', 'Hydrogen']);
  });

  it('leaves out code fences, lines of dashes and headings that name nothing', () => {
    expect(read(`\`\`\`\n## Questions\n${GOOD}\n---\n\`\`\``).issues).toEqual([]);
    expect(read(`\`\`\`\n## Questions\n${GOOD}\n---\n\`\`\``).drafts).toHaveLength(1);
  });

  it('never changes the wording: only extra spaces, and quotes or bold around a whole part, go', () => {
    const { drafts } = read('Q:   "Symbol | of [iron] (Fe); in 1:1"  \nA: **Fe**\nFill: The symbol of iron is ___ .\nWrong: Ir; In; I');
    expect(drafts[0].question).toBe('Symbol | of [iron] (Fe); in 1:1');
    expect(drafts[0].answer).toBe('Fe');
    expect(drafts[0].fill).toBe('The symbol of iron is ___ .');
  });

  it('reads a True/False question with nothing else', () => {
    const { drafts, issues } = read('Q: The Sun is a star\nA: True');
    expect(issues).toEqual([]);
    expect(drafts[0]).toMatchObject({ answer: 'True', fill: null, wrong: [], also: [] });
  });
});

describe('what every question needs', () => {
  it('needs an A:, a Fill: and a Wrong: line, except a True/False question', () => {
    expect(says('Q: Gas that plants take in')).toEqual(['This question has no A: line. Write the answer on the next line, as A: ...']);
    expect(says('Q: Gas that plants take in\nA: Carbon dioxide')).toEqual([
      'This question has no Fill: line. Add the same fact as a sentence, with ___ where the answer goes.',
      'This question has no Wrong: line. Add 3 wrong options, separated by ";".',
    ]);
    expect(read('Q: Gas that plants take in\nA: Carbon dioxide').issues.every((x) => x.missing && x.q === 0)).toBe(true);
  });

  it('a True/False question has no Also, Fill or Wrong line', () => {
    expect(says('Q: The Sun is a star\nA: True\nAlso: T\nFill: The Sun is a ___.\nWrong: False; No; Never')).toEqual([
      'A True/False question has no Also: line. Remove it.',
      'A True/False question has no Fill: line. Remove it.',
      'A True/False question has no Wrong: line. Remove it.',
    ]);
  });
});

describe('the checks, each on the line to fix', () => {
  const swap = (from: string, to: string) => problems(GOOD.replace(from, to));

  it('the question', () => {
    expect(swap('Q: Gas that green plants take in from the air to make their food', 'Q: Which of the following gases do plants take in?')).toEqual([
      [1, 'The question must make sense on its own, without "of the following": the options only appear in one game.'],
    ]);
    expect(swap('Q: Gas that green plants take in from the air to make their food', 'Q: Name the gas shown in the figure below')).toEqual([
      [1, "The question can't need a figure, diagram, map, table or passage: the games show only text."],
    ]);
    expect(swap('Q: Gas that green plants take in from the air to make their food', 'Q: Green plants take in ___ from the air')).toEqual([
      [1, 'No ___ in the question. Ask it as a question or a clue, and put the sentence with ___ on the Fill: line.'],
    ]);
    expect(swap('Q: Gas that green plants take in from the air to make their food', 'Q: Carbon dioxide is the gas that green plants take in')).toEqual([
      [1, 'The question gives away the answer ("Carbon dioxide"). Rewrite it without those words.'],
    ]);
    expect(problems('Q: True or false: the Sun is a star\nA: True')).toEqual([[1, 'Write only the statement after Q:, without "True or false". The A: line says True or False.']]);
    expect(swap('Q: Gas that green plants take in from the air to make their food', `Q: ${'x'.repeat(301)}`)[0]).toEqual([1, 'The question is longer than 300 characters. Make it shorter.']);
  });

  it('the answer', () => {
    expect(swap('A: Carbon dioxide', 'A: The gas called carbon dioxide in the air')).toEqual([[2, 'The answer is too long (8 words). At most 6 words: move the rest into the question.']]);
    expect(swap('A: Carbon dioxide', 'A: Carbon dioxide (CO2)')).toEqual([[2, 'Students would have to type "(CO2)" too. If it is another right answer, move it to an Also: line; if it is a note, leave it out.']]);
    expect(swap('A: Carbon dioxide', 'A: Carbon dioxide / CO2')[0]).toEqual([2, 'Write one answer after A:, and each other right answer on an Also: line.']);
    expect(problems('Q: Is the Sun a star?\nA: Yes')).toEqual([[2, 'Yes or No can\'t be an answer. Turn the question into a statement, with "A: True" or "A: False".']]);
    expect(problems('Q: Area of a square of side 3 m\nA: 9 m²\nFill: A square of side 3 m has an area of ___.\nWrong: 6 m²; 12 m²; 3 m²')).toEqual([
      [2, 'Students can\'t type "²". Put the unit in the question ("..., in square metres") and write the answer as the number alone.'],
    ]);
    expect(problems('Q: Square root of three\nA: √3\nFill: The square root of three is written ___.\nWrong: 3; 9; 1')[0][1]).toMatch(/^Students can't type "√"\. Add an Also: line/);
    // a symbol is fine when an Also line gives a way to type it
    expect(problems('Q: Square root of three\nA: √3\nAlso: sqrt 3\nFill: The square root of three is written ___.\nWrong: 3; 9; 1')).toEqual([]);
    // a number or a single letter in the question is not a giveaway
    expect(problems('Q: x + 4 = 8. Find x\nA: 4\nFill: If x + 4 = 8, then x is ___.\nWrong: 2; 8; 12')).toEqual([]);
  });

  it('other answers', () => {
    expect(swap('Also: CO2', 'Also: carbon  dioxide')).toEqual([[3, '"carbon dioxide" is the answer again (capitals and spaces already don\'t matter). Remove it.']]);
    expect(swap('Also: CO2', 'Also: CO2\nAlso: co2')).toEqual([[4, '"co2" is written twice. Remove one.']]);
    expect(swap('Also: CO2', 'Also:')).toEqual([[3, 'This Also: line is empty. Remove it.']]);
  });

  it('the Fill sentence', () => {
    expect(swap('Fill: Green plants take in ___ from the air to make their food.', 'Fill: Green plants take in carbon dioxide.')).toEqual([[4, 'The Fill: sentence needs ___ (three underscores) where the answer goes.']]);
    expect(swap('Fill: Green plants take in ___ from the air to make their food.', 'Fill: ___ and ___ are gases.')).toEqual([[4, 'Only one ___ in the Fill: sentence. It stands for the whole answer.']]);
    expect(swap('Fill: Green plants take in ___ from the air to make their food.', 'Fill: Gas: ___')).toEqual([[4, 'Write a whole sentence around the ___, so it can be answered on its own.']]);
    expect(swap('Fill: Green plants take in ___ from the air to make their food.', 'Fill: Carbon dioxide is ___, which plants take in.')).toEqual([[4, 'The Fill: sentence gives away the answer. Only the ___ should stand for it.']]);
  });

  it('the wrong options', () => {
    expect(swap('Wrong: Oxygen; Nitrogen; Hydrogen', 'Wrong: Oxygen, Nitrogen, Hydrogen')).toEqual([[5, 'Separate the wrong options with ";", not commas.']]);
    expect(swap('Wrong: Oxygen; Nitrogen; Hydrogen', 'Wrong: Oxygen; Nitrogen')).toEqual([[5, 'Write 3 wrong options, separated by ";" (there are 2).']]);
    expect(swap('Wrong: Oxygen; Nitrogen; Hydrogen', 'Wrong: Oxygen; CO2; Hydrogen')).toEqual([[5, '"CO2" is a right answer, so it can\'t be a wrong option.']]);
    expect(swap('Wrong: Oxygen; Nitrogen; Hydrogen', 'Wrong: Oxygen; Nitrogen; All of the above')).toEqual([[5, '"All of the above" doesn\'t work: the options are shuffled. Write a real wrong option.']]);
    expect(swap('Wrong: Oxygen; Nitrogen; Hydrogen', 'Wrong: Oxygen; Nitrogen; 42')).toEqual([[5, 'The wrong options must be the same kind as the answer: words, not numbers on their own.']]);
    // the kind of an Also answer counts too ("Zero", also "0", with numbers)
    expect(problems('Q: The number that is neither positive nor negative\nA: Zero\nAlso: 0\nFill: The number that is neither positive nor negative is ___.\nWrong: 1; -1; 10')).toEqual([]);
  });

  it('the level', () => {
    expect(swap('Level: easy', 'Level: tricky')).toEqual([[6, 'The level must be easy, medium or hard.']]);
  });

  it('flags a question written twice, and more than one send can take', () => {
    expect(problems(`${GOOD}\n\n${GOOD.replace('food', 'food.')}`)).toEqual([[8, 'The same question is on line 1. Remove one of them.']]);
    const many = Array.from({ length: MAX_PER_SEND + 2 }, (_, i) => `Q: Statement number ${i + 1}\nA: True`).join('\n\n');
    expect(problems(many)).toEqual([
      [91, 'At most 30 questions are sent at a time. This one and the ones after it go in the next send.'],
      [94, 'More than 30 questions: this one goes in the next send.'],
    ]);
  });
});

describe('lines that are not questions', () => {
  it('says what to do with each, and ties a line under a question to that question', () => {
    const r = read(`Here are your questions:\n\n${GOOD}\nIt is a gas.\n\nA) Oxygen\nB: Nitrogen\nQ | A\nFill: A loose sentence with ___.`);
    expect(r.issues.map((x) => [x.line, x.q, x.text])).toEqual([
      [1, undefined, 'This line isn\'t a question. Start each question with Q:, or remove the line.'],
      [9, 0, 'This line isn\'t part of the question: every line starts with Q:, A:, Also:, Fill:, Wrong: or Level:. A question or answer must fit on one line.'],
      [11, undefined, 'Don\'t list options as a), b), c). Put the 3 wrong options on one Wrong: line, separated by ";".'],
      [12, undefined, 'Don\'t list options as a), b), c). Put the 3 wrong options on one Wrong: line, separated by ";".'],
      [13, undefined, 'Write each question as a block of lines (Q:, A:, Fill:, Wrong:), not on one line.'],
      [14, undefined, 'This Fill: line has no Q: line above it. Each question starts with Q:.'],
    ]);
    expect(r.drafts).toHaveLength(1);
  });

  it('asks for one A: line, and one Fill: line', () => {
    expect(problems(GOOD.replace('A: Carbon dioxide', 'A: Carbon dioxide\nA: CO2'))).toEqual([[3, 'This question already has a A: line. Keep one.']]);
  });
});

describe('Board, Class, Subject, Chapter and Topic lines', () => {
  const head = (lines: string) => checkPlace(read(`${lines}\n\n${GOOD}`).headers, WHERE).map((x) => [x.line, x.text.split('.')[0]]);

  it('are fine when they name what is chosen above, written any common way', () => {
    expect(head('Board: cbse\nClass: X\nSubject: science\nChapter 1: Chemical reactions and equations\nTopic 2: Types of chemical reactions')).toEqual([]);
    expect(head('**Chapter 1**\n## Topic: Types of Chemical Reactions')).toEqual([]);
  });

  it('are a problem when they name somewhere else, as their questions would go to the wrong place', () => {
    expect(head('Class: 9\nChapter 1: Matter\nTopic 3: Oxidation')).toEqual([
      [1, 'This line names somewhere else'], [2, 'This line names somewhere else'], [3, 'This line names somewhere else'],
    ]);
    expect(checkPlace(read('Topic 1: Equations').headers, { ...WHERE, topic_no: null, topic: '' })).toHaveLength(1);
    expect(checkPlace(read('Topic 1: Equations').headers, null)).toEqual([]);
  });
});

describe('letting people finish writing before flagging', () => {
  const text = 'Q: Gas that plants take in\nA: Carbon dioxide\n';
  const { drafts, issues } = read(text);

  it('holds back what a question is missing while the cursor is in it or just below it', () => {
    expect(visibleIssues(issues, 3, drafts)).toEqual([]);
    expect(visibleIssues(issues, null, drafts)).toHaveLength(2);
    expect(visibleIssues(issues, 6, drafts)).toHaveLength(2);
  });

  it('holds back a problem on the line being typed, and shows it once the cursor moves on', () => {
    const r = read('Q: Gas that plants take in\nA: Carbon dioxide (CO2)\nFill: Plants take in ___ gas.\nWrong: Oxygen; Nitrogen; Hydrogen');
    expect(visibleIssues(r.issues, 2, r.drafts)).toEqual([]);
    expect(visibleIssues(r.issues, 4, r.drafts)).toHaveLength(1);
  });
});

describe('rows for the database', () => {
  const rows = toRows(read(`${GOOD}\n\nQ: The Sun is a star\nA: True`).drafts, WHERE);

  it('puts every question under the chosen chapter and topic, numbered in order', () => {
    expect(toRecord(rows[0])).toEqual({
      chapter_id: 'CBSE10SCI01', topic_id: 'CBSE10SCI01T02', board: 'CBSE', class: 10, subject: 'Science', chapter_no: 1,
      chapter: 'Chemical Reactions and Equations', topic_no: 2, topic: 'Types of Chemical Reactions', question_no: 1,
      question: 'Gas that green plants take in from the air to make their food', answer: 'Carbon dioxide', also: ['CO2'],
      fill: 'Green plants take in ___ from the air to make their food.', wrong_options: ['Oxygen', 'Nitrogen', 'Hydrogen'], difficulty: 'easy',
    });
    expect(rows[1]).toMatchObject({ question_no: 2, fill: null, wrong_options: [], difficulty: null });
    expect(JSON.parse(toJSON(rows))).toHaveLength(2);
  });

  it('with no topic chosen, has no topic', () => {
    expect(toRows(read(GOOD).drafts, { ...WHERE, topic_no: null, topic: '' })[0]).toMatchObject({ topic_id: null, topic_no: null, topic: '' });
  });

  it('writes CSV with proper quoting and no byte-order mark', () => {
    const csv = toCSV(toRows(read('Q: He said "hi", then left\nA: Hi, there').drafts, WHERE));
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(csv.split('\n')[1]).toBe('CBSE10SCI01,CBSE10SCI01T02,CBSE,10,Science,1,Chemical Reactions and Equations,2,Types of Chemical Reactions,1,"He said ""hi"", then left","Hi, there",,,,');
  });

  it('writes a question back as its block, which reads back the same ("Fix it")', () => {
    const block = blockOf(rows[0]);
    expect(block).toBe(GOOD);
    expect(read(block).drafts[0]).toMatchObject({ question: rows[0].question, answer: rows[0].answer, also: rows[0].also, fill: rows[0].fill, wrong: rows[0].wrong_options });
  });
});

describe('"Try an example"', () => {
  it('uses every part; three questions pass, and the last shows two problems', () => {
    const { drafts, issues } = read(EXAMPLE);
    expect(drafts).toHaveLength(4);
    expect(issues.map((x) => x.q)).toEqual([3, 3]);
    expect(issues.map((x) => x.text.split(':')[0])).toEqual(['The question must make sense on its own, without "of the following"', 'Write 3 wrong options, separated by ";" (there are 2).'].map((t) => t.split(':')[0]));
  });
});

describe('the question bank (behind the HoD desk)', () => {
  const at = '2026-10-09T10:00:00.000Z';

  it("approves, sends back with a reason, and moves back to waiting, on the page's copy", () => {
    const bank: Bank = {
      batches: [{ id: 'B20261009-01', by: 'A', email: '', at }],
      questions: toRows(read(EXAMPLE).drafts, WHERE).map((r, i) => ({ ...r, id: `q${i}`, batch: 'B20261009-01', status: 'pending', note: '', reviewedAt: null })),
    };
    const [a, b, c] = bank.questions.map((q) => q.id);
    let next = setStatus(bank, [a, b], 'approved', 'ignored', at);
    next = setStatus(next, [c], 'rejected', '  Answer should be Rusting  ', at);
    expect(counts(next)).toEqual({ pending: 1, approved: 2, rejected: 1 });
    expect(next.questions.find((q) => q.id === a)).toMatchObject({ status: 'approved', note: '', reviewedAt: at });
    expect(next.questions.find((q) => q.id === c)).toMatchObject({ status: 'rejected', note: 'Answer should be Rusting' });
    const back = setStatus(next, [c], 'pending', '', at);
    expect(back.questions.find((q) => q.id === c)).toMatchObject({ status: 'pending', note: '', reviewedAt: null });
    expect(bank.questions.every((q) => q.status === 'pending')).toBe(true); // the original is untouched (so undo works)
  });
});
