import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_ALSO, MAX_ANSWER_WORDS, MAX_OPTIONS, MAX_PER_SEND, MAX_QUESTION, MIN_OPTIONS, read, type Where } from './format';
import { readBulk } from './list-draft';
import { bulkPrompt, chatbotPrompt, EXAMPLE_BLOCKS, fixPrompt, RULES } from './prompt';
import { DIFFICULTIES } from './rows';

/* The chatbot prompts and the checker must agree: a chatbot follows the prompt, and the checker reads what it writes.
   The prompt is made for the one topic chosen on the page, and asks for question blocks only: no line of it has to be
   copied exactly. The fix prompt carries each problem and the whole text, and asks for all of it again. */

const HEAT: Where = { chapter_id: 'CBSE07SCI04', board: 'CBSE', class: 7, subject: 'Science', chapter_no: 4, chapter: 'Heat', topic_no: 2, topic: 'Transfer of Heat' };
const WHOLE: Where = { ...HEAT, topic_no: null, topic: '' };
const prompt = chatbotPrompt(HEAT);

describe('the chatbot prompt agrees with the checker', () => {
  it('shows an example that the checker reads with no problems, using every part', () => {
    const { drafts, issues } = read(EXAMPLE_BLOCKS);
    expect(issues).toEqual([]);
    expect(drafts.length).toBe(3);
    expect(drafts.some((d) => d.also.length && d.fill && d.wrong.length && d.level)).toBe(true);
    expect(drafts.some((d) => /^(true|false)$/i.test(d.answer))).toBe(true);
    expect(prompt).toContain(EXAMPLE_BLOCKS);
  });

  it('names every label the checker reads', () => {
    for (const label of ['Q:', 'A:', 'Also:', 'Fill:', 'Wrong:', 'Level:']) expect(prompt, label).toContain(`\n${label}`);
  });

  it("states the checker's limits and levels", () => {
    expect(RULES).toContain(`At most ${MAX_QUESTION} characters`);
    expect(RULES).toContain(`at most ${MAX_ANSWER_WORDS} words`);
    expect(RULES).toContain(`At most ${MAX_ALSO}, one per line`);
    expect(RULES).toContain(`${MIN_OPTIONS} wrong options (at most ${MAX_OPTIONS}) separated by ";"`);
    expect(prompt).toContain(`never more than ${MAX_PER_SEND}`);
    expect(RULES).toContain(DIFFICULTIES.join(', ').replace(/, (\w+)$/, ' or $1'));
  });

  it("states the checker's rules about what a question and an answer may be", () => {
    for (const rule of ['of the following', 'the above', 'figure', 'never contains its answer', 'has no ___', 'yes/no', 'True or false', 'No brackets', '"/"', 'units in the question', 'ordinary keys', 'exactly one ___', 'not commas', 'All of the above', 'No Also, Fill or Wrong lines']) {
      expect(RULES, rule).toContain(rule);
    }
  });

  it('is for the chosen topic only, and asks for no Board, Chapter or Topic lines', () => {
    expect(prompt).toContain('CBSE, class 7, Science\nChapter 4: Heat\nTopic: Transfer of Heat');
    expect(prompt).toContain('Write only about this topic.');
    expect(prompt).toContain('no Board, Chapter or Topic lines');
    expect(chatbotPrompt(WHOLE)).toContain('The whole chapter (no single topic)');
    expect(chatbotPrompt(WHOLE)).toContain('Write only about this chapter.');
  });

  it('a reply written as asked, in its code block, reads with no problems', () => {
    const reply = `\`\`\`\n${EXAMPLE_BLOCKS}\n\`\`\`\n\nI wrote these from general knowledge.`;
    expect(read(reply.split('\n\n').slice(0, -1).join('\n\n')).issues).toEqual([]);
  });

  it('asks for one code block, has no long dashes, and ends with a place for the material', () => {
    expect(prompt).toContain('ONE code block');
    expect(prompt).not.toMatch(/[–—]/);
    expect(prompt.trimEnd().endsWith('write from the textbook):')).toBe(true);
  });
});

describe('the prompt to fix problems', () => {
  const text = `Here you go:

Q: Gas that green plants take in from the air to make their food
A: Carbon dioxide
Fill: Green plants take in ___ from the air to make their food.
Wrong: Oxygen; Nitrogen; Hydrogen

Q: Which of the following is a noble gas?
A: Neon (Ne)
Wrong: Oxygen, Nitrogen, Hydrogen

Q: Is the Sun a star?
A: Yes`;
  const r = read(text);
  const p = fixPrompt(text, r.drafts, r.issues);
  const item = (n: number) => p.split(/\n\n(?=\d+\. )/).find((x) => x.startsWith(`${n}. `))?.split('\n\n')[0] ?? '';

  it('lists each question turned away by its Q: and A: lines, with short instructions, and nothing about the good ones', () => {
    expect(p).not.toContain('1. Q: Gas that green plants');
    expect(item(1).split('\n').slice(0, 2)).toEqual(['1. Q: Which of the following is a noble gas?', '   A: Neon (Ne)']);
    expect(item(2).split('\n').slice(0, 2)).toEqual(['2. Q: Is the Sun a star?', '   A: Yes']);
    expect(item(3)).toBe('');
  });

  it('says what to change for each problem, once, with changes before additions', () => {
    const fixes = item(1).split('\n').slice(2);
    expect(fixes).toEqual([
      '   - Ask the question directly, without "of the following".',
      '   - Take "(Ne)" out of the answer: put it on an Also: line if it is another right answer, or drop it if it is a note.',
      '   - Separate the wrong options with ";", not commas.',
      '   - Add a Fill: line: the same fact as a sentence, with ___ where the answer goes.',
    ]);
    expect(new Set(fixes).size).toBe(fixes.length);
  });

  it('never asks for something that contradicts another fix: a Yes/No question becomes True/False, with no Fill or Wrong', () => {
    expect(item(2).split('\n').slice(2)).toEqual(['   - Turn it into a statement, with A: True or A: False, and no Also, Fill or Wrong lines.']);
  });

  it('lists the other lines, gives the rules once and the whole text, and asks for all of it again in one code block', () => {
    expect(p).toContain('Other lines:\n\n- Line "Here you go:": Remove this line: write only the questions.');
    expect(p.split(RULES)).toHaveLength(2);
    expect(p).toContain(`\`\`\`\n${text}\n\`\`\``);
    expect(p.trimEnd().endsWith('so I can copy it at once.')).toBe(true);
  });

  it('fences the text with four backticks when it has code fences of its own', () => {
    const fenced = '```\nQ: Is the Sun a star?\nA: Yes\n```';
    const f = read(fenced);
    expect(fixPrompt(fenced, f.drafts, f.issues)).toContain(`\`\`\`\`\n${fenced}\n\`\`\`\``);
  });
});

describe('the guide for people', () => {
  it('has an example that the checker reads with no problems', () => {
    const guide = readFileSync('src/components/games/Guide.tsx', 'utf8');
    const sample = guide.match(/data-testid="guide-sample"[^>]*>\{`([\s\S]*?)`\}<\/pre>/)![1];
    const { drafts, issues } = read(sample);
    expect(issues).toEqual([]);
    expect(drafts.length).toBeGreaterThan(1);
  });

  it('says the same limits as the checker', () => {
    const guide = readFileSync('src/components/games/Guide.tsx', 'utf8');
    for (const name of ['MAX_ANSWER_WORDS', 'MIN_OPTIONS', 'MAX_OPTIONS', 'MAX_ALSO', 'MAX_PER_SEND']) expect(guide, name).toContain(`{${name}}`);
  });
});

describe("the Chapters page's chatbot prompt (Bulk add)", () => {
  it('asks for Board, Class and Subject lines and chapters under them, and its example goes into Bulk add as it is', () => {
    const p = bulkPrompt();
    expect(p).toContain('ONE code block');
    expect(p).not.toMatch(/[–—]/);
    expect(p.trimEnd().endsWith('Boards, classes and subjects to list:')).toBe(true);
    const example = p.slice(p.indexOf('Board: '), p.indexOf('\n\nRules:'));
    const { groups, problems } = readBulk(example, []);
    expect(problems).toEqual([]);
    expect(groups.map((g) => [g.group, g.chapters])).toEqual([[{ board: 'CBSE', class: 9, subject: 'Science' }, 2]]);
  });

  it("takes a reply in that form, with its code block's fences, for several subjects", () => {
    const reply = '```\nBoard: ICSE\nClass: 10\nSubject: Physics\n1. Force\n2. Work, Energy and Power\n\nBoard: ISC\nClass: 11\nSubject: Chemistry\n1. Some Basic Concepts of Chemistry\n```';
    const { groups, problems } = readBulk(reply, []);
    expect(problems).toEqual([]);
    expect(groups.map((g) => `${g.group.board} ${g.group.class} ${g.group.subject}: ${g.chapters}`)).toEqual(['ICSE 10 Physics: 2', 'ISC 11 Chemistry: 1']);
  });
});
