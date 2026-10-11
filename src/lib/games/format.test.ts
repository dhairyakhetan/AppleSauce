import { describe, expect, it } from 'vitest';
import {
  ALL_BOARDS, chapterId, checkBoard, checkClass, checkDetail, checkSubject, detailsId, parseNumbered, readDetails, readMeta, standardDetail,
  SUBJECTS, titleCase, writeDetail,
} from './details';
import {
  asText, baseName, EXAMPLE, format, lineLevels, MAX_ANSWER, MAX_QUESTION, missing, NO_ANSWER, visibleIssues,
} from './format';
import { counts, setStatus, toCSV, toJSON, toRecord, toTSV, type Bank } from './rows';

const qa = (raw: string) => format(raw).rows.map((r) => [r.question, r.answer]);
const HEAD = 'Board: CBSE\nClass: 10\nSubject: Science\nChapter 1: Matter\n';
/** The same questions in many shapes at once: what people really paste. */
const MIXED = `Board: cbse
Class: X
Subject: science
Chapter 1: chemical reactions and equations

Topic 1: chemical equations
1. Equation with the same number of atoms of each element on both sides? Ans: Balanced equation
2. Q. Which law requires a chemical equation to be balanced?
Ans. Law of conservation of mass

## Topic 2: types of chemical reactions
- Reaction in which two or more reactants form a single product | Combination reaction | easy
- Reaction in which a single reactant breaks down into simpler products = Decomposition reaction
- Gain of oxygen by a substance during a reaction - Oxidation

Topic 3: effects of oxidation in everyday life
Q3) Common name for the corrosion of iron? Rusting
Gas filled in chip packets to keep the chips from going rancid | Nitrogen | easy
What do fats and oils become when they are oxidised?
`;

describe('reading questions and answers', () => {
  it('reads every common shape the same way', () => {
    const shapes = [
      'What is the capital of France? | Paris',
      'What is the capital of France?\tParis',
      '| What is the capital of France? | Paris |',
      '1. What is the capital of France? Paris',
      'Q1. What is the capital of France? Ans: Paris',
      'Q: What is the capital of France? A: Paris',
      '- What is the capital of France? - Paris',
      '**What is the capital of France?** Paris',
      'What is the capital of France? → Paris',
      'Q. What is the capital of France?\nAns. Paris',
      '2) What is the capital of France?\nParis',
      'Question 3: What is the capital of France?\nAnswer: Paris',
      '﻿What is the capital of France? | Paris\r\n',
    ];
    for (const s of shapes) expect(qa(s), s).toEqual([['What is the capital of France?', 'Paris']]);
  });

  it('splits statement lines on =, a spaced dash or a colon', () => {
    expect(qa('SI unit of force = Newton')).toEqual([['SI unit of force', 'Newton']]);
    expect(qa('Powerhouse of the cell - Mitochondria')).toEqual([['Powerhouse of the cell', 'Mitochondria']]);
    expect(qa('Powerhouse of the cell: Mitochondria')).toEqual([['Powerhouse of the cell', 'Mitochondria']]);
    expect(qa('Q1. Name the gas plants take in\nAns: Carbon dioxide')).toEqual([['Name the gas plants take in', 'Carbon dioxide']]);
  });

  it('never changes the wording of questions and answers', () => {
    expect(qa('The ___ is the powerhouse of the cell | mitochondria')).toEqual([['The ___ is the powerhouse of the cell', 'mitochondria']]);
    expect(qa('3.14 is the value of which constant? | Pi')).toEqual([['3.14 is the value of which constant?', 'Pi']]);
    expect(qa('Quartz is made of which element besides oxygen? | silicon')).toEqual([['Quartz is made of which element besides oxygen?', 'silicon']]);
    expect(qa('What is v = u + at called? Equation of motion')).toEqual([['What is v = u + at called?', 'Equation of motion']]);
    expect(qa('Relation between f and R for a spherical mirror | f = R/2')).toEqual([['Relation between f and R for a spherical mirror', 'f = R/2']]);
    expect(qa('पानी का रासायनिक सूत्र क्या है? | H₂O')).toEqual([['पानी का रासायनिक सूत्र क्या है?', 'H₂O']]);
  });

  it('skips code fences, Markdown dividers and table headers', () => {
    const raw = '```\n| Question | Answer |\n|---|---|\n| Capital of France | Paris |\n```';
    expect(qa(raw)).toEqual([['Capital of France', 'Paris']]);
    expect(format(raw).issues).toEqual([]);
  });

  it('reports every line it cannot use, as an error with its line number', () => {
    const { rows, issues } = format([
      'Just a note without an answer',
      'What is the capital of France?',
      'Ans: Paris',
      'Ans: Rome',
      'What is the capital of Italy?',
      'Chapter 2: Maps',
      `${'q'.repeat(MAX_QUESTION + 1)} | a`,
      `q | ${'a'.repeat(MAX_ANSWER + 1)}`,
      ' | answer',
      'a | b | c | d',
      'What is the capital of France? | Paris',
      'What is the capital of France? | Paris',
      'What is the capital of Spain?',
    ].join('\n'));
    expect(rows.map((r) => r.line)).toEqual([2, 11]);
    expect(issues.filter((x) => x.level === 'error').map((x) => x.line)).toEqual([1, 4, 5, 7, 8, 9, 10, 12, 13]);
    expect(issues.find((x) => x.line === 5)!.text).toBe('This question has no answer.');
    expect(issues.find((x) => x.line === 13)!.text).toBe('This question has no answer.');
    expect(issues.find((x) => x.line === 12)!.text).toBe('Same question as line 11, skipped.');
  });

  it('marks each line with its worst problem, for the underline', () => {
    const { issues } = format('Board: Xyz\nClass: 13\nq1 | a1\nwhat?');
    expect([...lineLevels(issues)]).toEqual([[1, 'error'], [2, 'error'], [4, 'error']]);
  });
});

describe('"Try an example"', () => {
  it('shows only the one format, and reads cleanly with nothing missing', () => {
    const { rows, issues } = format(EXAMPLE);
    expect(issues).toEqual([]);
    expect(missing(rows)).toEqual({ board: 0, class: 0, subject: 0, chapter: 0, topic: 0, id: 0 });
    for (const line of EXAMPLE.split('\n').filter(Boolean)) {
      expect(line).toMatch(/^(Board|Class|Subject): \S|^(Chapter|Topic) \d+: \S|^[^|]+ \| [^|]+( \| (easy|medium|hard))?$/);
    }
    expect(rows.map((r) => r.answer)).toEqual(format(MIXED).rows.map((r) => r.answer));
  });
});

describe('details: board, class, subject, chapter, topic, difficulty', () => {
  it('takes them from lines in any common style and writes names the standard way', () => {
    const { rows, issues } = format(MIXED);
    expect(issues.map((x) => [x.line, x.level, x.text])).toEqual([[19, 'error', 'This question has no answer.']]);
    expect(rows).toHaveLength(7);
    expect(new Set(rows.map((r) => `${r.chapter_id} ${r.board}/${r.class}/${r.subject}/${r.chapter_no}/${r.chapter}`)))
      .toEqual(new Set(['CBSE10SCI01 CBSE/10/Science/1/Chemical Reactions and Equations']));
    expect(rows.map((r) => [r.topic_id, r.question_no])).toEqual([
      ['CBSE10SCI01T01', 1], ['CBSE10SCI01T01', 2], ['CBSE10SCI01T02', 1], ['CBSE10SCI01T02', 2], ['CBSE10SCI01T02', 3], ['CBSE10SCI01T03', 1], ['CBSE10SCI01T03', 2],
    ]);
    expect([...new Set(rows.map((r) => r.topic))]).toEqual(['Chemical Equations', 'Types of Chemical Reactions', 'Effects of Oxidation in Everyday Life']);
    expect(rows.map((r) => r.answer)).toEqual(['Balanced equation', 'Law of conservation of mass', 'Combination reaction', 'Decomposition reaction', 'Oxidation', 'Rusting', 'Nitrogen']);
    expect(rows.map((r) => r.difficulty)).toEqual([null, null, 'easy', null, null, null, 'easy']);
  });

  it('numbers topics by order of appearance unless numbered, and a new chapter clears the topic', () => {
    const rows = format(`${HEAD}Topic: a\nq1 | a\nTopic: b\nq2 | a\nTopic 7: c\nq3 | a\nTopic: a\nq4 | a\nChapter 2: x\nq5 | a`).rows;
    expect(rows.map((r) => [r.topic, r.topic_no, r.question_no, r.topic_id])).toEqual([
      ['A', 1, 1, 'CBSE10SCI01T01'], ['B', 2, 1, 'CBSE10SCI01T02'], ['C', 7, 1, 'CBSE10SCI01T07'], ['A', 1, 2, 'CBSE10SCI01T01'], ['', null, 1, null],
    ]);
    expect(rows[4].chapter_id).toBe('CBSE10SCI02');
  });

  it('reads "10.2" in a topic line as topic 2', () => {
    expect(format(`${HEAD}Topic 1.2: Atoms\nq1 | a1`).rows[0].topic_id).toBe('CBSE10SCI01T02');
  });

  it('gives no ID until board, class, subject and chapter number are all known', () => {
    expect(format('Chapter 1: Matter\nTopic 1: Atoms\nq1 | a1').rows[0]).toMatchObject({ chapter_id: null, topic_id: null, chapter_no: 1, topic_no: 1 });
    const noNumber = format('Board: CBSE\nClass: 10\nSubject: Science\nChapter: Matter\nq1 | a1');
    expect(noNumber.rows[0].chapter_id).toBeNull();
    expect(noNumber.issues).toEqual([{ line: 4, level: 'warn', text: 'Add the chapter number, for example "3: Acids". It is part of the chapter ID.' }]);
  });

  it('accepts difficulty as a third part or a line, and warns about unknown values', () => {
    const { rows, issues } = format('q1 | a | Hard\nDifficulty: medium\nq2 | a\nq3 | a | e\nq4 | a | tricky');
    expect(rows.map((r) => r.difficulty)).toEqual(['hard', 'medium', 'easy', 'medium']);
    expect(issues).toEqual([{ line: 5, level: 'warn', text: '"tricky" is not easy, medium or hard, so no difficulty was set.' }]);
  });

  it('flags a wrong class, board or subject as an error, and its questions get no chapter ID', () => {
    const { rows, issues } = format('Board: cbsc\nClass: 13\nSubject: chemsitry\nChapter 1: x\nq1 | a1');
    expect(issues.map((x) => [x.line, x.level, x.text])).toEqual([
      [1, 'error', 'Did you mean CBSE?'],
      [2, 'error', 'Class must be from 1 to 12.'],
      [3, 'error', 'Did you mean Chemistry?'],
    ]);
    expect(rows[0]).toMatchObject({ class: null, chapter_id: null });
  });

  it('warns about ICSE in class 11, two names for one chapter number, unused details and empty topics', () => {
    const { issues } = format([
      'Board: ICSE', 'Class: 11', 'Subject: Physics', 'Chapter 1: Units', 'q1 | a',
      'Chapter 1: Motion', 'q2 | a',
      'Topic 1: Empty', 'Topic 2: Full', 'q3 | a',
      'Class: 9', 'Class: 11', 'q4 | a',
    ].join('\n'));
    expect(issues.map((x) => [x.line, x.text])).toEqual([
      [1, 'ICSE ends at class 10. Classes 11 and 12 are ISC.'],
      [6, 'Chapter ID ICSE11PHY01 is already "Units" (line 4). Check the chapter number.'],
      [8, 'No questions under this topic.'],
      [11, 'Not used: Class is set again on line 12 before any question.'],
    ]);
  });

  it('does not mistake sentences for detail lines', () => {
    expect(qa('Class of compounds that turn litmus red | Acids')).toEqual([['Class of compounds that turn litmus red', 'Acids']]);
    expect(qa('Section of a plant cell that holds sap? Vacuole')).toEqual([['Section of a plant cell that holds sap?', 'Vacuole']]);
    expect(qa('Chlorophyll is found in which organelle? Chloroplast')).toEqual([['Chlorophyll is found in which organelle?', 'Chloroplast']]);
    expect(qa('Class civil engineering as a branch? Yes')).toEqual([['Class civil engineering as a branch?', 'Yes']]);
  });

  it('reads spreadsheet tables with a header row, in any column order, checking each value once', () => {
    const tsv = 'Board\tClass\tSubject\tChapter\tTopic\tQuestion\tAnswer\tLevel\ncbse\t10th\tchem\t3: acids\tindicators\tColour of litmus in acid\tRed\teasy\ncbse\t10th\tchem\t3: acids\tindicators\tColour of litmus in base\tBlue\t\nxyz\t10\tchem\t3: acids\t\tA third\tC\t\nxyz\t10\tchem\t3: acids\t\tA fourth\tD\t';
    const { rows, issues } = format(tsv);
    expect(rows.map((r) => [r.chapter_id, r.topic_id, r.chapter, r.topic, r.question_no, r.answer, r.difficulty])).toEqual([
      ['CBSE10CHE03', 'CBSE10CHE03T01', 'Acids', 'Indicators', 1, 'Red', 'easy'],
      ['CBSE10CHE03', 'CBSE10CHE03T01', 'Acids', 'Indicators', 2, 'Blue', null],
      [null, null, 'Acids', '', 1, 'C', null], // xyz isn't a board on the list
      [null, null, 'Acids', '', 2, 'D', null],
    ]);
    expect(issues.map((x) => x.line)).toEqual([4]);
    const csv = 'question,answer,topic\n"Capital of France, the country",Paris,Europe\n"He said ""hi""",Hi,Words';
    expect(format(csv).rows.map((r) => [r.question, r.answer, r.topic])).toEqual([['Capital of France, the country', 'Paris', 'Europe'], ['He said "hi"', 'Hi', 'Words']]);
    expect(qa('1\tCapital of France\tParis')).toEqual([['Capital of France', 'Paris']]);
  });

  it('keeps detail lines that contain commas after a CSV header', () => {
    const rows = format('question,answer\nq1,a1\nChapter 3: Acids, Bases and Salts\nq2,a2').rows;
    expect(rows.map((r) => r.chapter)).toEqual(['', 'Acids, Bases and Salts']);
  });

  it('counts questions missing a detail', () => {
    const { rows } = format('Class: 10\nq1 | a\nTopic: T\nq2 | a');
    expect(missing(rows)).toEqual({ board: 2, class: 0, subject: 2, chapter: 2, topic: 1, id: 2 });
  });
});

describe('output for the database', () => {
  const { rows } = format(MIXED);

  it('has one flat record per question, with null for missing values', () => {
    expect(toRecord(rows[0])).toEqual({
      chapter_id: 'CBSE10SCI01', topic_id: 'CBSE10SCI01T01', board: 'CBSE', class: 10, subject: 'Science', chapter_no: 1,
      chapter: 'Chemical Reactions and Equations', topic_no: 1, topic: 'Chemical Equations', question_no: 1,
      question: 'Equation with the same number of atoms of each element on both sides?', answer: 'Balanced equation', difficulty: null,
    });
    expect(JSON.parse(toJSON(rows))).toHaveLength(7);
  });

  it('writes CSV with proper quoting and no byte-order mark', () => {
    const csv = toCSV(format('He said "hi", then left | Hi, there').rows);
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(csv.split('\n')[0]).toBe('chapter_id,topic_id,board,class,subject,chapter_no,chapter,topic_no,topic,question_no,question,answer,difficulty');
    expect(csv.split('\n')[1]).toBe(',,,,,,,,,1,"He said ""hi"", then left","Hi, there",');
  });

  it('reads its own CSV and spreadsheet copy back into the same rows', () => {
    const strip = (rs: typeof rows) => rs.map(({ line: _line, ...r }) => r);
    expect(strip(format(toCSV(rows)).rows)).toEqual(strip(rows));
    expect(strip(format(toTSV(rows)).rows)).toEqual(strip(rows));
  });

  it('writes rows back in the one format, which reads back into the same rows ("Fix in the formatter")', () => {
    const strip = (rs: typeof rows) => rs.map(({ line: _line, ...r }) => r);
    const text = asText(rows);
    expect(format(text).issues).toEqual([]);
    expect(strip(format(text).rows)).toEqual(strip(rows));
    expect(text.split('\n').slice(0, 6)).toEqual(['Board: CBSE', 'Class: 10', 'Subject: Science', 'Chapter 1: Chemical Reactions and Equations', 'Topic 1: Chemical Equations', 'Equation with the same number of atoms of each element on both sides? | Balanced equation']);
    // one question on its own, a question with no topic after one with a topic, and a bar inside an answer
    expect(strip(format(asText([rows[3]])).rows)).toEqual(strip([{ ...rows[3], question_no: 1 }]));
    const mixed = format(`${HEAD}Topic 1: Atoms\nQ1 | A1\nChapter 2: Molecules\nQ2 | A2\nQ3\tA | B`).rows;
    expect(strip(format(asText(mixed)).rows)).toEqual(strip(mixed));
  });

  it('writes a spreadsheet copy with the same columns', () => {
    const lines = toTSV(rows).split('\n');
    expect(lines).toHaveLength(8);
    expect(lines[1].split('\t')).toHaveLength(13);
  });

  it('names files after the chapter ID', () => {
    expect(baseName(rows)).toBe('CBSE10SCI01-chemical-reactions-and-equations');
    expect(baseName(format('Subject: Physics\nq1 | a1').rows)).toBe('physics-questions');
    expect(baseName([])).toBe('questions');
  });
});

describe('letting people finish writing before flagging', () => {
  // 1 bad class, 2 no answer (a topic line follows), 4 unreadable, 5 too many parts
  const { issues } = format('Class: 13\nWhat is H2O?\nTopic 1: Water\njust some words\nQ1 | A1 | x | y');
  const lines = (xs: typeof issues) => xs.map((x) => x.line);

  it('shows everything when nobody is typing', () => {
    expect(lines(visibleIssues(issues, {}))).toEqual([1, 2, 4, 5]);
    expect(issues.find((x) => x.line === 2)!.text).toBe(NO_ANSWER);
  });

  it('holds back the line being typed, and "no answer" on the line just above it', () => {
    expect(lines(visibleIssues(issues, { caret: 4 }))).toEqual([1, 2, 5]);
    expect(lines(visibleIssues(issues, { caret: 3 }))).toEqual([1, 4, 5]);
  });

  it('only holds back "no answer" above, not other problems there', () => {
    expect(lines(visibleIssues(issues, { caret: 5 }))).toEqual([1, 2, 4]);
  });

  it('holds back the line a detail box is writing while it is typed in', () => {
    expect(lines(visibleIssues(issues, { line: 1 }))).toEqual([2, 4, 5]);
  });
});

describe('capitalising names', () => {
  it('capitalises each word, keeps joining words small, and leaves acronyms, formulas and other scripts alone', () => {
    expect(titleCase('chemical reactions and equations')).toBe('Chemical Reactions and Equations');
    expect(titleCase('the french revolution')).toBe('The French Revolution');
    expect(titleCase('light: reflection and refraction')).toBe('Light: Reflection and Refraction');
    expect(titleCase('light – the nature of light')).toBe('Light – The Nature of Light');
    expect(titleCase('acid-base indicators')).toBe('Acid-Base Indicators');
    expect(titleCase('newton’s laws of motion')).toBe('Newton’s Laws of Motion');
    expect(titleCase('the pH scale and DNA')).toBe('The pH Scale and DNA');
    expect(titleCase('co2 in the air')).toBe('co2 in the Air');
    expect(titleCase('part ii: x-rays')).toBe('Part II: X-Rays');
    expect(titleCase('रासायनिक अभिक्रियाएँ')).toBe('रासायनिक अभिक्रियाएँ');
  });
});

describe('boards', () => {
  it('knows the national boards and their other names', () => {
    expect(['cbse', 'CBSE board', 'NCERT', 'Central Board of Secondary Education'].map((b) => checkBoard(b))).toEqual(Array(4).fill({ name: 'CBSE', code: 'CBSE' }));
    expect(checkBoard('cisce')).toEqual({ name: 'ICSE', code: 'ICSE' });
    expect(checkBoard('a levels')).toEqual({ name: 'Cambridge', code: 'CAIE' });
  });

  it('knows state boards by state or by the board’s own name', () => {
    for (const b of ['Maharashtra', 'maharashtra state board', 'MSBSHSE', 'State Board (Maharashtra)']) expect(checkBoard(b)).toEqual({ name: 'Maharashtra State Board', code: 'MH' });
    expect(checkBoard('UP Board')).toEqual({ name: 'Uttar Pradesh State Board', code: 'UP' });
    expect(checkBoard('Jammu & Kashmir')).toEqual({ name: 'Jammu and Kashmir State Board', code: 'JK' });
    expect(checkBoard('samacheer kalvi').code).toBe('TN');
  });

  it('knows a state\'s board written its own way, and its open school, madrasa and Sanskrit boards', () => {
    for (const b of ['Bihar School Examination Board', 'UP Board of High School & Intermediate Education', 'Kerala Board of Public Examination', 'Karnataka Pre-University Board', 'Kerala syllabus']) {
      expect(checkBoard(b).problem, b).toBeUndefined();
    }
    expect(checkBoard('Bihar madrasa board')).toEqual({ name: 'Bihar State Madrasa Education Board', code: 'BSMEB' });
    expect(checkBoard('UP Sanskrit board').code).toBe('UPSSP');
    expect(checkBoard('MP open school').code).toBe('MPSOS');
    expect(checkBoard('Edexcel IGCSE')).toEqual({ name: 'Edexcel', code: 'EDEX' });
  });

  it('refuses anything not on the list, with a message: typos, schools, made-up boards, a bare "state board"', () => {
    expect(checkBoard('cbsc').problem).toEqual({ level: 'error', text: 'Did you mean CBSE?' });
    expect(checkBoard('maharastra').problem?.text).toBe('Did you mean Maharashtra State Board?');
    expect(checkBoard('State board').problem).toEqual({ level: 'error', text: 'Which state? For example: Maharashtra State Board.' });
    expect(checkBoard('Sikkim').problem?.text).toBe('Sikkim has no school board of its own. Write the board the school follows, such as CBSE.');
    for (const b of ['Delhi Public School', 'Assam Rifles Public School', 'Indian Baccalaureate', 'Kendriya Vidyalaya', 'Xavier Board of Studies']) {
      expect(checkBoard(b), b).toMatchObject({ code: null, problem: { level: 'error', text: `"${b}" isn't a board on this site's list. Write the board the textbook is for, such as CBSE, ICSE or Maharashtra State Board. The guide lists them all.` } });
    }
    expect(checkBoard('').problem).toBeUndefined();
  });

  it('has unique codes and names', () => {
    const codes = ALL_BOARDS.map((b) => b.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => /^[A-Z]{2,5}$/.test(c))).toBe(true);
    const names = ALL_BOARDS.flatMap((b) => [b.name.toLowerCase(), ...b.also]);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
    for (const b of ALL_BOARDS) expect(checkBoard(b.name), b.name).toEqual({ name: b.name, code: b.code });
  });
});

describe('classes', () => {
  it('reads numbers, ordinals, labels and Roman numerals', () => {
    expect(['10', '10th', '10 th', 'Class 10', 'X', 'x', 'Std. 8', 'Grade: 7', 'XII', 'i'].map((c) => checkClass(c).value)).toEqual([10, 10, 10, 10, 10, 10, 8, 7, 12, 1]);
  });

  it('rejects anything outside 1 to 12', () => {
    for (const c of ['0', '13', 'nursery', '11-12', '10.5']) expect(checkClass(c).problem?.level, c).toBe('error');
    expect(checkClass('')).toEqual({ value: null });
  });
});

describe('subjects', () => {
  it('knows subjects and short names, and gives each a unique three-letter code', () => {
    expect(checkSubject('maths')).toEqual({ name: 'Mathematics', code: 'MAT' });
    expect(checkSubject('Chem')).toEqual({ name: 'Chemistry', code: 'CHE' });
    expect(checkSubject('history & civics')).toEqual({ name: 'History and Civics', code: 'HCV' });
    const codes = SUBJECTS.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => /^[A-Z]{3}$/.test(c))).toBe(true);
  });

  it('refuses a subject not on the list, suggesting the one meant', () => {
    expect(checkSubject('Phisics').problem).toEqual({ level: 'error', text: 'Did you mean Physics?' });
    expect(checkSubject('Artificial Inteligence').problem?.text).toBe('Did you mean Artificial Intelligence?');
    for (const x of ['Astronomy', 'Biochemistry', 'Science (Physics)']) {
      expect(checkSubject(x), x).toMatchObject({ code: null, problem: { level: 'error', text: `"${x}" isn't a subject on this site's list. Write the textbook's subject, such as Science or Mathematics. The guide lists them all.` } });
    }
    expect(checkSubject('हिंदी')).toEqual({ name: 'Hindi', code: 'HIN' });
    expect(checkSubject('Hindi Course B').code).toBe('HIN');
    expect(checkSubject('Kathak').code).toBe('DAN');
    const names = SUBJECTS.flatMap((x) => [x.name.toLowerCase(), ...x.also]);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });
});

describe('chapters, topics and IDs', () => {
  it('reads a number and a name in any common style', () => {
    expect(['10: Light', 'Chapter 10 - Light', '10. Light', 'Ch. 10 Light', 'Light', '10'].map((c) => parseNumbered(c, 'chapter'))).toEqual([
      { no: 10, name: 'Light' }, { no: 10, name: 'Light' }, { no: 10, name: 'Light' }, { no: 10, name: 'Light' }, { no: null, name: 'Light' }, { no: 10, name: '' },
    ]);
    expect(parseNumbered('10.3 Lenses', 'topic')).toEqual({ no: 3, name: 'Lenses' });
    expect(parseNumbered('10.3 Lenses', 'chapter').no).toBe(10);
  });

  it('builds short IDs that sort by board, class, subject and chapter', () => {
    expect(chapterId('CBSE', 11, 'CHE', 1)).toBe('CBSE11CHE01');
    expect(chapterId('MH', 9, 'SCI', 12)).toBe('MH09SCI12');
    expect(chapterId('CBSE', null, 'CHE', 1)).toBeNull();
    const ids = [chapterId('CBSE', 9, 'SCI', 2), chapterId('CBSE', 10, 'SCI', 1), chapterId('CBSE', 9, 'SCI', 10)];
    expect([...ids].sort()).toEqual([chapterId('CBSE', 9, 'SCI', 2), chapterId('CBSE', 9, 'SCI', 10), chapterId('CBSE', 10, 'SCI', 1)]);
  });

  it('recognises detail lines but not sentences', () => {
    expect(readMeta('**Class:** 10')).toEqual({ key: 'class', value: '10' });
    expect(readMeta('## Topic 2 - Indicators')).toEqual({ key: 'topic', value: '2 - Indicators' });
    expect(readMeta('Ch. 3: Acids')).toEqual({ key: 'chapter', value: '3: Acids' });
    expect(readMeta('Class XI')).toEqual({ key: 'class', value: 'XI' });
    expect(readMeta('Board: Computer ')).toEqual({ key: 'board', value: 'Computer ' }); // spaces kept while typing
    for (const s of ['Class of compounds', 'Chapters are long', 'Topic', 'Board games | fun', 'Section of a cell']) expect(readMeta(s), s).toBeNull();
  });
});

describe('the four boxes and the text', () => {
  it('writes each box as a line at the top, in a fixed order, and reads it back exactly as typed', () => {
    let t = '';
    t = writeDetail(t, 'chapter', '1: Matter');
    t = writeDetail(t, 'board', 'CBSE');
    t = writeDetail(t, 'subject', 'Computer ');
    t = writeDetail(t, 'class', '10');
    expect(t).toBe('Board: CBSE\nClass: 10\nSubject: Computer \nChapter 1: Matter\n');
    expect(readDetails(t)).toEqual({ board: 'CBSE', class: '10', subject: 'Computer ', chapter: '1: Matter' });
  });

  it('round-trips every keystroke of every box', () => {
    const typed = { board: 'Maharashtra State Board', class: 'XI', subject: 'Political Science', chapter: '12: Rights, Duties - and More?' };
    for (const [k, word] of Object.entries(typed) as [keyof typeof typed, string][]) {
      let t = 'Topic 1: Start\nq1 | a1';
      for (let i = 1; i <= word.length; i++) {
        t = writeDetail(t, k, word.slice(0, i));
        expect(readDetails(t)[k], `${k} "${word.slice(0, i)}"`).toBe(word.slice(0, i).trim() ? word.slice(0, i) : '');
      }
      expect(t.endsWith('Topic 1: Start\nq1 | a1')).toBe(true);
    }
  });

  it('edits the existing line, removes it when emptied, and leaves later chapters alone', () => {
    const t = 'Class 9\nChapter 1: A\nq1 | a1\nChapter 2: B\nq2 | b';
    expect(writeDetail(t, 'class', '10')).toBe('Class: 10\nChapter 1: A\nq1 | a1\nChapter 2: B\nq2 | b');
    expect(writeDetail(t, 'chapter', '')).toBe('Class 9\nq1 | a1\nChapter 2: B\nq2 | b');
    expect(writeDetail(t, 'board', 'ICSE')).toBe(`Board: ICSE\n${t}`);
    expect(readDetails('q1 | a1\nChapter 2: B').chapter).toBe('');
  });

  it('keeps bars, tabs and line breaks out of a box', () => {
    expect(writeDetail('', 'subject', 'Maths | Physics\tand\nmore')).toBe('Subject: Maths Physics and more\n');
  });

  it('warns under a box as soon as something is wrong, and tidies the value when leaving it', () => {
    expect(checkDetail('class', '15')?.level).toBe('error');
    expect(checkDetail('chapter', 'Light')?.text).toContain('chapter number');
    expect(checkDetail('board', 'cbse')).toBeUndefined();
    expect(standardDetail('board', 'cbse')).toBe('CBSE');
    expect(standardDetail('class', 'xi')).toBe('11');
    expect(standardDetail('class', 'fifteen')).toBe('fifteen');
    expect(standardDetail('subject', 'maths')).toBe('Mathematics');
    expect(standardDetail('chapter', 'chapter 3 - acids, bases and salts')).toBe('3: Acids, Bases and Salts');
    expect(detailsId({ board: 'cbse', class: '11th', subject: 'chem', chapter: '1: Some basic concepts' })).toBe('CBSE11CHE01');
    expect(detailsId({ board: 'cbse', class: '11th', subject: 'chem', chapter: 'Some basic concepts' })).toBeNull();
  });
});

describe('the question bank (behind the HoD desk)', () => {
  const at = '2026-10-09T10:00:00.000Z';

  it('approves, sends back with a reason, and moves back to waiting, on the page\'s copy', () => {
    const bank: Bank = {
      batches: [{ id: 'B20261009-01', by: 'A', email: '', at }],
      questions: format(MIXED).rows.map((r, i) => ({ ...r, id: `q${i}`, batch: 'B20261009-01', status: 'pending', note: '', reviewedAt: null })),
    };
    const [a, b, c] = bank.questions.map((q) => q.id);
    let next = setStatus(bank, [a, b], 'approved', 'ignored', at);
    next = setStatus(next, [c], 'rejected', '  Answer should be Rusting  ', at);
    expect(counts(next)).toEqual({ pending: 4, approved: 2, rejected: 1 });
    expect(next.questions.find((q) => q.id === a)).toMatchObject({ status: 'approved', note: '', reviewedAt: at });
    expect(next.questions.find((q) => q.id === c)).toMatchObject({ status: 'rejected', note: 'Answer should be Rusting' });
    const back = setStatus(next, [c], 'pending', '', at);
    expect(back.questions.find((q) => q.id === c)).toMatchObject({ status: 'pending', note: '', reviewedAt: null });
    expect(bank.questions.every((q) => q.status === 'pending')).toBe(true); // the original is untouched (so undo works)
  });
});
