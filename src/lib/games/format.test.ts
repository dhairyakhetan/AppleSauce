import { describe, expect, it } from 'vitest';
import {
  ALL_BOARDS, chapterId, checkBoard, checkClass, checkDetail, checkSubject, detailsId, parseNumbered, readDetails, readMeta, standardDetail,
  SUBJECTS, titleCase, writeDetail,
} from './details';
import {
  asText, baseName, blockOf, EXAMPLE, format, lineLevels, MAX_ANSWER_WORDS, MAX_PER_CHAPTER, MAX_PER_TOPIC, MAX_QUESTION, missing, NO_ANSWER, NO_FILL,
  problemsByRow, visibleIssues,
} from './format';
import { counts, setStatus, toCSV, toJSON, toRecord, toTSV, type Bank } from './rows';

const HEAD = 'Board: CBSE\nClass: 10\nSubject: Science\nChapter 1: Matter\n';
/** A question block with every part, which passes every check. */
const GOOD = `Q: Gas that green plants take in from the air to make their food
A: Carbon dioxide
Also: CO2
Fill: Green plants take in ___ from the air to make their food.
Wrong: Oxygen; Nitrogen; Hydrogen
Level: easy`;
const one = (block: string) => format(`${HEAD}\n${block}`);
/** The problems with one block, as [line within the block (Q: is 1), level, text]. */
const problems = (block: string) => one(block).issues.map((x) => [x.line - 5, x.level, x.text]);

describe('reading question blocks', () => {
  it('reads each part from its labelled line', () => {
    const { rows, issues } = one(GOOD);
    expect(issues).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      question: 'Gas that green plants take in from the air to make their food', answer: 'Carbon dioxide', also: ['CO2'],
      fill: 'Green plants take in ___ from the air to make their food.', wrong_options: ['Oxygen', 'Nitrogen', 'Hydrogen'], difficulty: 'easy',
      chapter_id: 'CBSE10SCI01', question_no: 1, line: 6, end: 11,
    });
  });

  it('lets a question, answer or sentence contain any symbol: only the label at the start of a line counts', () => {
    const { rows, issues } = one([
      'Q: Value of |-7| + 3 [in the set {1, 2}]; note: A: is not a label here',
      'A: 10',
      'Fill: |-7| + 3 = ___ (so the answer is a number)',
      'Wrong: -4; 4; -10',
      '',
      'Q: Name of the Python method __init__ is called a',
      'A: Constructor',
      'Fill: In Python, __init__ is the ___ of a class.',
      'Wrong: Destructor; Decorator; Iterator',
    ].join('\n'));
    expect(issues).toEqual([]);
    expect(rows.map((r) => [r.question, r.fill])).toEqual([
      ['Value of |-7| + 3 [in the set {1, 2}]; note: A: is not a label here', '|-7| + 3 = ___ (so the answer is a number)'],
      ['Name of the Python method __init__ is called a', 'In Python, __init__ is the ___ of a class.'],
    ]);
  });

  it('accepts labels in any case, and the bullets, numbers and bold a chatbot may add before them', () => {
    const shapes = [
      'q: Gas that green plants take in\na: Carbon dioxide',
      '1. Q: Gas that green plants take in\n   A: Carbon dioxide',
      '- Q: Gas that green plants take in\n- A: Carbon dioxide',
      '**Q:** Gas that green plants take in\n**A:** Carbon dioxide',
      '**Q**: Gas that green plants take in\n**A**: Carbon dioxide',
      'Q:Gas that green plants take in\nA:   Carbon dioxide  ',
      '```\nQ: Gas that green plants take in\n\nA: Carbon dioxide\n```',
      'Q: Gas that green plants take in\r\nA: "Carbon dioxide"',
    ];
    for (const s of shapes) expect(one(s).rows.map((r) => [r.question, r.answer]), s).toEqual([['Gas that green plants take in', 'Carbon dioxide']]);
  });

  it('never changes the wording: only extra spaces, and quotes or bold around a whole part, go', () => {
    const { rows } = one('Q:   Who said "Swaraj is my birthright"?\nA: **Bal Gangadhar Tilak**\nWrong: "Mahatma Gandhi"; Lala Lajpat Rai; Bipin Chandra Pal');
    expect(rows[0]).toMatchObject({ question: 'Who said "Swaraj is my birthright"?', answer: 'Bal Gangadhar Tilak', wrong_options: ['Mahatma Gandhi', 'Lala Lajpat Rai', 'Bipin Chandra Pal'] });
  });

  it('reads True/False questions with nothing else', () => {
    expect(problems('Q: The Sun is a star\nA: True\nLevel: easy')).toEqual([]);
  });
});

describe('the checks, each on the line to fix', () => {
  const cases: [string, string, number, 'error' | 'warn', RegExp][] = [
    ['no answer', 'Q: Gas that green plants take in', 1, 'error', /^No A: line/],
    ['empty question', 'Q:\nA: Oxygen', 1, 'error', /question is empty/],
    ['question too long', `Q: ${'a '.repeat(160)}\nA: Oxygen`, 1, 'error', new RegExp(`longer than ${MAX_QUESTION}`)],
    ['answer in the question', 'Q: Mitochondria is called the powerhouse of the cell\nA: Mitochondria', 1, 'error', /shows the answer \("Mitochondria"\)/],
    ['other answer in the question', 'Q: Brain of the computer, the CPU\nA: Central Processing Unit\nAlso: CPU', 1, 'error', /shows the answer \("CPU"\)/],
    ['of the following', 'Q: Which of the following is a noble gas?\nA: Neon', 1, 'error', /make sense on its own/],
    ['the above', 'Q: Name the process shown above\nA: Osmosis', 1, 'error', /make sense on its own/],
    ['a figure', 'Q: Name the part labelled X in the diagram given\nA: Nucleus', 1, 'error', /figure, diagram/],
    ['true or false in the question', 'Q: True or false: the Sun is a star\nA: True', 1, 'error', /Write only the statement/],
    ['two blanks in the question', 'Q: The ___ and the ___ of a cell\nA: Nucleus', 1, 'error', /Only one ___/],
    ['empty answer', 'Q: Gas plants take in\nA:', 2, 'error', /answer is empty/],
    ['answer of punctuation', 'Q: Gas plants take in\nA: ...', 2, 'error', /no letters or digits/],
    ['answer too long', 'Q: What does a plant need\nA: Sunlight water air and carbon dioxide gas', 2, 'error', new RegExp(`at most ${MAX_ANSWER_WORDS} words`)],
    ['yes/no', 'Q: Is the Sun a star\nA: Yes', 2, 'error', /Yes or No/],
    ['two answers in one', 'Q: Capital of West Bengal\nA: Kolkata / Calcutta', 2, 'error', /each other answer that counts on its own Also/],
    ['a short form in brackets', 'Q: Brain of the computer\nA: Central Processing Unit (CPU)', 2, 'error', /type the brackets/],
    ['a note in brackets', 'Q: Time sunlight takes to reach the Earth\nA: 8 minutes (approx.)', 2, 'error', /type the brackets/],
    ['the old [optional] notation', 'Q: Splitting of a compound\nA: Decomposition [reaction]', 2, 'error', /type the brackets/],
    ['a symbol nobody can type', 'Q: Square root of 2, written with the root sign\nA: √2', 2, 'error', /can't type "√"/],
    ['a blank in the answer', 'Q: Powerhouse of the cell\nA: Mito___', 2, 'error', /No ___ in the answer/],
    ['Also same as the answer', 'Q: Highest mountain range in the world\nA: Himalayas\nAlso: The Himalayas', 3, 'error', /same as the answer/],
    ['Also twice', 'Q: Brain of the computer\nA: Central Processing Unit\nAlso: CPU\nAlso: cpu', 4, 'error', /written twice/],
    ['two answers on one Also line', 'Q: Capital of West Bengal\nA: Kolkata\nAlso: Calcutta; Calcutta city', 3, 'error', /One answer per Also/],
    ['Fill with no blank', 'Q: Gas plants take in\nA: Carbon dioxide\nFill: Plants take in carbon gas.', 3, 'error', /needs ___/],
    ['Fill with two blanks', 'Q: Gas plants take in\nA: Carbon dioxide\nFill: Plants take in ___ and give out ___.', 3, 'error', /Only one ___/],
    ['Fill showing the answer', 'Q: Gas plants take in\nA: Carbon dioxide\nFill: Plants take in ___, which is carbon dioxide.', 3, 'error', /shows the answer/],
    ['Fill too short', 'Q: Gas plants take in\nA: Carbon dioxide\nFill: ___ gas', 3, 'error', /whole sentence/],
    ['no Fill line', 'Q: Gas plants take in\nA: Carbon dioxide', 1, 'warn', /^No Fill: line/],
    ['too few wrong options', 'Q: Gas plants take in\nA: Carbon dioxide\nWrong: Oxygen; Nitrogen', 3, 'error', /at least 3 wrong options/],
    ['too many wrong options', 'Q: Gas plants take in\nA: Carbon dioxide\nWrong: a; b; c; d; e; f', 3, 'error', /At most 5 wrong options/],
    ['a wrong option twice', 'Q: Gas plants take in\nA: Carbon dioxide\nWrong: Oxygen; oxygen.; Nitrogen', 3, 'error', /written twice/],
    ['the answer as a wrong option', 'Q: Gas plants take in\nA: Carbon dioxide\nAlso: CO2\nWrong: Oxygen; co2; Nitrogen', 4, 'error', /"co2" counts as the answer/],
    ['All of the above', 'Q: Gas plants take in\nA: Carbon dioxide\nWrong: Oxygen; Nitrogen; All of the above', 3, 'error', /options are shuffled/],
    ['options of another kind', 'Q: Year of the Battle of Plassey\nA: 1757\nWrong: 1764; 1857; Buxar', 3, 'error', /same kind as the answer: numbers/],
    ['a second A line', 'Q: Gas plants take in\nA: Carbon dioxide\nA: Oxygen', 3, 'error', /already has a A: line/],
    ['a second Wrong line', 'Q: Gas plants take in\nA: Carbon dioxide\nWrong: Oxygen; Nitrogen; Helium\nWrong: Argon', 4, 'error', /all the wrong options on one line/],
    ['a level that is not one', 'Q: Gas plants take in\nA: Carbon dioxide\nLevel: tricky', 3, 'error', /easy, medium or hard/],
    ['Fill on True/False', 'Q: The Sun is a star\nA: True\nFill: The Sun is a ___.', 3, 'error', /True\/False question has no Fill/],
    ['Wrong on True/False', 'Q: The Sun is a star\nA: True\nWrong: False', 3, 'error', /needs no Wrong/],
    ['a line that is not part of anything', 'Q: Gas plants take in\nA: Carbon dioxide\nit is also called CO2', 3, 'error', /isn't part of the question/],
    ['options listed as a) b)', 'Q: Gas plants take in\nA: Carbon dioxide\na) Oxygen', 3, 'error', /Don't list options as a\), b\)/],
    ['a label written another way', 'Question: Gas plants take in\nAnswer: Carbon dioxide', 1, 'error', /Write this label as Q:/],
    ['a one-line question', 'Gas plants take in | Carbon dioxide', 1, 'error', /Write each question as a block/],
    ['an answer with no question', 'A: Carbon dioxide', 1, 'error', /has no Q: line above it/],
  ];
  it.each(cases)('%s', (_name, block, line, level, text) => {
    const found = problems(block);
    expect(found.some(([l, lv, t]) => l === line && lv === level && text.test(String(t))), JSON.stringify(found)).toBe(true);
  });

  it('a number or a single letter in the question is not a giveaway (x + 4 = 8, Vitamin A)', () => {
    expect(problems('Q: If x + 4 = 8, what is x?\nA: 4\nFill: When x + 4 = 8, x is ___.\nWrong: 2; 8; 12')).toEqual([]);
    expect(problems('Q: Deficiency of which vitamin causes night blindness, a common eye problem\nA: Vitamin A\nFill: Lack of ___ causes night blindness.\nWrong: Vitamin C; Vitamin D; Vitamin K')).toEqual([]);
  });

  it('wrong options may be the kind of an Also answer: "Zero", also "0", with numbers', () => {
    expect(problems('Q: Temperature at which pure water freezes, in degrees Celsius\nA: Zero\nAlso: 0\nFill: Pure water freezes at ___ degrees Celsius.\nWrong: 10; 32; 100')).toEqual([]);
  });

  it('a symbol is fine when an Also line gives a way to type it', () => {
    expect(problems('Q: Square root of 2, written with the root sign\nA: √2\nAlso: sqrt 2\nFill: The square root of 2 is written ___.\nWrong: 2²; 1/2; 2')).toEqual([]);
  });

  it('allows at most 30 questions in a topic and 80 in a chapter', () => {
    const blocks = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `Q: Question number ${from + i}\nA: Answer ${from + i}\nFill: Sentence ${from + i} with ___ in it.`).join('\n\n');
    const topic = format(`${HEAD}Topic 1: T\n${blocks(MAX_PER_TOPIC + 2)}`);
    expect(topic.issues.filter((x) => /per topic|in topic 1/.test(x.text))).toHaveLength(2);
    const chapter = format(`${HEAD}${[1, 2, 3].map((t) => `Topic ${t}: T${t}\n${blocks(MAX_PER_TOPIC - 1, t * 100)}`).join('\n')}`);
    expect(chapter.issues.filter((x) => /per chapter|in this chapter/.test(x.text))).toHaveLength(3 * (MAX_PER_TOPIC - 1) - MAX_PER_CHAPTER);
  });

  it('flags the same question twice in a chapter', () => {
    expect(format(`${HEAD}\n${GOOD}\n\n${GOOD}`).issues.map((x) => [x.line, x.text])).toEqual([[13, 'Same question as line 6. Leave one of them out.']]);
  });

  it('marks each line with its worst problem, for the underline', () => {
    const levels = lineLevels([{ line: 1, level: 'warn', text: 'a' }, { line: 1, level: 'error', text: 'b' }, { line: 2, level: 'warn', text: 'c' }]);
    expect([...levels]).toEqual([[1, 'error'], [2, 'warn']]);
  });
});

describe('which questions have problems', () => {
  it('ties each problem to its question, or to the questions under the detail line it is on', () => {
    const text = `Board: CBSE\nClass: 13\nSubject: Science\nChapter 1: Matter\n\n${GOOD}\n\nQ: Gas plants take in\nA: Carbon dioxide\n\nstray words`;
    const { rows, issues } = format(text);
    const { byRow, general } = problemsByRow(rows, issues);
    expect(byRow.get(0)!.map((x) => x.text)).toEqual(['Class must be from 1 to 12.']); // the Class line is above it
    expect(byRow.get(1)!.map((x) => x.text)).toEqual(['Class must be from 1 to 12.', NO_FILL]);
    expect(general.map((x) => [x.line, x.text])).toEqual([[16, 'Start each question with Q:, and its answer on the next line with A:.']]); // after a blank line
    const under = format(`${HEAD}\nQ: Gas plants take in\nA: Carbon dioxide\nstray words`);
    expect(problemsByRow(under.rows, under.issues).byRow.get(0)!.map((x) => x.text)).toContainEqual(expect.stringMatching(/isn't part of the question/)); // right under it
    const loose = format(`stray words\n${HEAD}\n${GOOD}`);
    expect(problemsByRow(loose.rows, loose.issues).general.map((x) => x.line)).toEqual([1]);
    // a one-line question after a blank line is not part of the good question above it
    const after = format(`${HEAD}\n${GOOD}\n\nWhich gas do plants give out? | Oxygen`);
    expect(problemsByRow(after.rows, after.issues)).toMatchObject({ byRow: new Map(), general: [{ line: 13 }] });
  });
});

describe('"Try an example"', () => {
  it('uses every part, in the one format, with one amber and one red question to show the marks', () => {
    const { rows, issues } = format(EXAMPLE);
    expect(missing(rows)).toEqual({ board: 0, class: 0, subject: 0, chapter: 0, topic: 0, id: 0 });
    expect(issues.map((x) => [x.level, x.text.slice(0, 20)])).toEqual([['warn', NO_FILL.slice(0, 20)], ['error', 'The question must ma'], ['warn', NO_FILL.slice(0, 20)]]);
    for (const line of EXAMPLE.split('\n').filter(Boolean)) {
      expect(line).toMatch(/^(Board|Class|Subject): \S|^(Chapter|Topic) \d+: \S|^(Q|A|Also|Fill|Wrong|Level): \S/);
    }
    expect(rows.some((r) => r.also.length) && rows.some((r) => r.fill) && rows.some((r) => r.wrong_options.length) && rows.some((r) => r.answer === 'True')).toBe(true);
  });
});

describe('details: board, class, subject, chapter, topic', () => {
  const q = (n: number) => `Q: Question ${n}\nA: Answer ${n}\nFill: Sentence ${n} has ___ in it.`;

  it('takes them from lines in any common style and writes names the standard way', () => {
    const { rows, issues } = format(`Board: cbse\nClass: X\nSubject: science\n## Chapter 1 - chemical reactions and equations\n**Topic 1:** chemical equations\n${q(1)}\nTopic 2: types of reactions\n${q(2)}\n${q(3)}`);
    expect(issues).toEqual([]);
    expect(rows.map((r) => [r.chapter_id, r.board, r.class, r.subject, r.chapter, r.topic_id, r.topic, r.question_no])).toEqual([
      ['CBSE10SCI01', 'CBSE', 10, 'Science', 'Chemical Reactions and Equations', 'CBSE10SCI01T01', 'Chemical Equations', 1],
      ['CBSE10SCI01', 'CBSE', 10, 'Science', 'Chemical Reactions and Equations', 'CBSE10SCI01T02', 'Types of Reactions', 1],
      ['CBSE10SCI01', 'CBSE', 10, 'Science', 'Chemical Reactions and Equations', 'CBSE10SCI01T02', 'Types of Reactions', 2],
    ]);
  });

  it('numbers topics by order of appearance unless numbered, and a new chapter clears the topic', () => {
    const rows = format(`${HEAD}Topic: a\n${q(1)}\nTopic: b\n${q(2)}\nTopic 7: c\n${q(3)}\nTopic: a\n${q(4)}\nChapter 2: x\n${q(5)}`).rows;
    expect(rows.map((r) => [r.topic, r.topic_no, r.question_no, r.topic_id])).toEqual([
      ['A', 1, 1, 'CBSE10SCI01T01'], ['B', 2, 1, 'CBSE10SCI01T02'], ['C', 7, 1, 'CBSE10SCI01T07'], ['A', 1, 2, 'CBSE10SCI01T01'], ['', null, 1, null],
    ]);
    expect(rows[4].chapter_id).toBe('CBSE10SCI02');
  });

  it('reads "10.2" in a topic line as topic 2', () => {
    expect(format(`${HEAD}Topic 1.2: Atoms\n${q(1)}`).rows[0].topic_id).toBe('CBSE10SCI01T02');
  });

  it('gives no ID until board, class, subject and chapter number are all known', () => {
    expect(format(`Chapter 1: Matter\nTopic 1: Atoms\n${q(1)}`).rows[0]).toMatchObject({ chapter_id: null, topic_id: null, chapter_no: 1, topic_no: 1 });
    const noNumber = format(`Board: CBSE\nClass: 10\nSubject: Science\nChapter: Matter\n${q(1)}`);
    expect(noNumber.rows[0].chapter_id).toBeNull();
    expect(noNumber.issues).toEqual([{ line: 4, level: 'warn', text: 'Add the chapter number, for example "3: Acids". It is part of the chapter ID.' }]);
  });

  it('takes the level from each question, not from a Difficulty line', () => {
    const { rows, issues } = format(`${q(1)}\nLevel: Hard\nDifficulty: medium\n${q(2)}`);
    expect(rows.map((r) => r.difficulty)).toEqual(['hard', null]);
    expect(issues.map((x) => [x.line, x.text])).toEqual([[5, 'Write the level under each question, as Level: easy (or medium, or hard).']]);
  });

  it('flags a wrong class, board or subject as an error, and its questions get no chapter ID', () => {
    const { rows, issues } = format(`Board: cbsc\nClass: 13\nSubject: chemsitry\nChapter 1: x\n${q(1)}`);
    expect(issues.map((x) => [x.line, x.level, x.text])).toEqual([
      [1, 'error', 'Did you mean CBSE?'],
      [2, 'error', 'Class must be from 1 to 12.'],
      [3, 'error', 'Did you mean Chemistry?'],
    ]);
    expect(rows[0]).toMatchObject({ class: null, chapter_id: null });
  });

  it('warns about ICSE in class 11, two names for one chapter number, unused details and empty topics', () => {
    const { issues } = format([
      'Board: ICSE', 'Class: 11', 'Subject: Physics', 'Chapter 1: Units', q(1),
      'Chapter 1: Motion', q(2),
      'Topic 1: Empty', 'Topic 2: Full', q(3),
      'Class: 9', 'Class: 11', q(4),
    ].join('\n'));
    expect(issues.map((x) => [x.line, x.text])).toEqual([
      [1, 'ICSE ends at class 10. Classes 11 and 12 are ISC.'],
      [8, 'Chapter ID ICSE11PHY01 is already "Units" (line 4). Check the chapter number.'],
      [12, 'No questions under this topic.'],
      [17, 'Not used: Class is set again on line 18 before any question.'],
    ]);
  });

  it('does not mistake questions for detail lines', () => {
    const { rows } = format('Q: Class of compounds that turn litmus red\nA: Acids\nQ: Topic sentence of a paragraph is usually the\nA: First sentence');
    expect(rows.map((r) => [r.question, r.answer])).toEqual([['Class of compounds that turn litmus red', 'Acids'], ['Topic sentence of a paragraph is usually the', 'First sentence']]);
  });

  it('counts questions missing a detail', () => {
    const { rows } = format(`Class: 10\n${q(1)}\nTopic: T\n${q(2)}`);
    expect(missing(rows)).toEqual({ board: 2, class: 0, subject: 2, chapter: 2, topic: 1, id: 2 });
  });
});

describe('output for the database', () => {
  const { rows } = format(EXAMPLE);

  it('has one flat record per question, with null for missing values', () => {
    expect(toRecord(rows[2])).toEqual({
      chapter_id: 'CBSE10SCI01', topic_id: 'CBSE10SCI01T02', board: 'CBSE', class: 10, subject: 'Science', chapter_no: 1,
      chapter: 'Chemical Reactions and Equations', topic_no: 2, topic: 'Types of Chemical Reactions', question_no: 1,
      question: 'Reaction in which a single reactant breaks down into simpler products', answer: 'Decomposition reaction', also: ['Decomposition'],
      fill: 'A reaction in which a single reactant breaks down into simpler products is called a ___.',
      wrong_options: ['Combination reaction', 'Displacement reaction', 'Neutralisation reaction'], difficulty: 'easy',
    });
    expect(JSON.parse(toJSON(rows))).toHaveLength(rows.length);
  });

  it('writes CSV with proper quoting and no byte-order mark', () => {
    const csv = toCSV(format('Q: He said "hi", then left\nA: Hi, there').rows);
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
    expect(csv.split('\n')[0]).toBe('chapter_id,topic_id,board,class,subject,chapter_no,chapter,topic_no,topic,question_no,question,answer,also,fill,wrong_options,difficulty');
    expect(csv.split('\n')[1]).toBe(',,,,,,,,,1,"He said ""hi"", then left","Hi, there",,,,');
  });

  it('writes rows back in the one format, which reads back into the same rows ("Fix it")', () => {
    const strip = (rs: typeof rows) => rs.map(({ line: _l, end: _e, under: _u, ...r }) => r);
    const text = asText(rows);
    expect(strip(format(text).rows)).toEqual(strip(rows));
    expect(text.split('\n').slice(0, 7)).toEqual(['Board: CBSE', 'Class: 10', 'Subject: Science', 'Chapter 1: Chemical Reactions and Equations', 'Topic 1: Chemical Equations', '', 'Q: Law which says that mass can neither be created nor destroyed in a chemical reaction']);
    // one question on its own, and a question with no topic after one with a topic
    expect(strip(format(asText([rows[3]])).rows)).toEqual(strip([{ ...rows[3], question_no: 1 }]));
    const mixed = format(`${HEAD}Topic 1: Atoms\n${GOOD}\nChapter 2: Molecules\nQ: Smallest particle of a compound\nA: Molecule`).rows;
    expect(strip(format(asText(mixed)).rows)).toEqual(strip(mixed));
    expect(blockOf(rows[2]).split('\n').map((l) => l.split(':')[0])).toEqual(['Q', 'A', 'Also', 'Fill', 'Wrong', 'Level']);
  });

  it('writes a spreadsheet copy with the same columns', () => {
    const lines = toTSV(rows).split('\n');
    expect(lines).toHaveLength(rows.length + 1);
    expect(lines[1].split('\t')).toHaveLength(16);
  });

  it('names files after the chapter ID', () => {
    expect(baseName(rows)).toBe('CBSE10SCI01-chemical-reactions-and-equations');
    expect(baseName(format('Subject: Physics\nQ: q1\nA: a1').rows)).toBe('physics-questions');
    expect(baseName([])).toBe('questions');
  });
});

describe('letting people finish writing before flagging', () => {
  // 1 bad class; the question at 3 has no answer yet; 7 isn't part of anything
  const text = 'Class: 13\n\nQ: What is H2O\n\nTopic 1: Water\n\nmore words';
  const { rows, issues } = format(text);
  const lines = (xs: typeof issues) => xs.map((x) => x.line);

  it('shows everything when nobody is typing', () => {
    expect(lines(visibleIssues(issues, {}, rows))).toEqual([1, 3, 7]);
    expect(issues.find((x) => x.line === 3)!.text).toBe(NO_ANSWER);
  });

  it('holds back the line being typed, and what a question is missing while the cursor is in it or just below', () => {
    expect(lines(visibleIssues(issues, { caret: 7 }, rows))).toEqual([1, 3]);
    expect(lines(visibleIssues(issues, { caret: 4 }, rows))).toEqual([1, 7]);
    expect(lines(visibleIssues(issues, { caret: 6 }, rows))).toEqual([1, 3, 7]);
  });

  it('holds back the line a detail box is writing while it is typed in', () => {
    expect(lines(visibleIssues(issues, { line: 1 }, rows))).toEqual([3, 7]);
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
      questions: format(EXAMPLE).rows.map((r, i) => ({ ...r, id: `q${i}`, batch: 'B20261009-01', status: 'pending', note: '', reviewedAt: null })),
    };
    const [a, b, c] = bank.questions.map((q) => q.id);
    let next = setStatus(bank, [a, b], 'approved', 'ignored', at);
    next = setStatus(next, [c], 'rejected', '  Answer should be Rusting  ', at);
    expect(counts(next)).toEqual({ pending: 3, approved: 2, rejected: 1 });
    expect(next.questions.find((q) => q.id === a)).toMatchObject({ status: 'approved', note: '', reviewedAt: at });
    expect(next.questions.find((q) => q.id === c)).toMatchObject({ status: 'rejected', note: 'Answer should be Rusting' });
    const back = setStatus(next, [c], 'pending', '', at);
    expect(back.questions.find((q) => q.id === c)).toMatchObject({ status: 'pending', note: '', reviewedAt: null });
    expect(bank.questions.every((q) => q.status === 'pending')).toBe(true); // the original is untouched (so undo works)
  });
});
