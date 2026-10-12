import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mark } from './engine/answers';
import { format, MAX_ANSWER, MAX_OPTIONS, MAX_QUESTION, missing } from './format';
import { chapterLines, chatbotInstructions, chatbotPrompt, formatExample, topicLines } from './prompt';
import type { ListChapter } from './rows';

/* The chatbot prompt ("Copy chatbot prompt") and the code must agree: a chatbot follows the prompt, and the formatter
   reads what it writes. The prompt is made for one chapter on the list, so it carries that chapter's lines and topics
   and nothing about any other. */

const HEAT: ListChapter = {
  chapter_id: 'CBSE07SCI04', board: 'CBSE', class: 7, subject: 'Science', chapter_no: 4, name: 'Heat',
  topics: [
    { topic_id: 'CBSE07SCI04T01', topic_no: 1, name: 'Hot and Cold' },
    { topic_id: 'CBSE07SCI04T02', topic_no: 2, name: 'Transfer of Heat' },
  ],
};
const NO_TOPICS: ListChapter = { chapter_id: 'ICSE06GEO02', board: 'ICSE', class: 6, subject: 'Geography', chapter_no: 2, name: 'Landforms of the Earth', topics: [] };
const text = chatbotInstructions(HEAT);
const read = (path: string) => readFileSync(path, 'utf8');

describe('the chatbot prompt agrees with the code', () => {
  it("starts the chatbot's block with the chapter's lines, which the site reads as that chapter and its topics", () => {
    expect(text).toContain(chapterLines(HEAT));
    expect(text).toContain(topicLines(HEAT));
    const { rows, issues } = format(`${chapterLines(HEAT)}\n${topicLines(HEAT).split('\n').map((t, i) => `${t}\nQuestion ${i + 1} | Its answer`).join('\n')}`);
    expect(issues).toEqual([]);
    expect(rows.map((r) => [r.chapter_id, r.topic_id, r.chapter, r.topic])).toEqual([
      ['CBSE07SCI04', 'CBSE07SCI04T01', 'Heat', 'Hot and Cold'],
      ['CBSE07SCI04', 'CBSE07SCI04T02', 'Heat', 'Transfer of Heat'],
    ]);
  });

  it('shows the format with the chapter\'s own lines, and the site reads it with every detail', () => {
    expect(text).toContain(formatExample(HEAT));
    const { rows, issues } = format(formatExample(HEAT));
    expect(issues).toEqual([]);
    expect(missing(rows)).toEqual({ board: 0, class: 0, subject: 0, chapter: 0, topic: 0, id: 0 });
    expect(rows.map((r) => [r.topic_id, r.difficulty, r.wrong_options])).toEqual([
      ['CBSE07SCI04T01', 'easy', []],
      ['CBSE07SCI04T01', null, []],
      ['CBSE07SCI04T01', 'medium', ['A wrong option', 'Another wrong option', 'A third wrong option']],
    ]);
  });

  it('for a chapter with no topics, asks for no Topic lines', () => {
    const plain = chatbotInstructions(NO_TOPICS);
    expect(plain).toContain('This chapter has no topics: write no Topic lines.');
    expect(plain).not.toMatch(/^Topic \d/m);
    const { rows, issues } = format(formatExample(NO_TOPICS));
    expect(issues).toEqual([]);
    expect(rows.every((r) => r.chapter_id === 'ICSE06GEO02' && r.topic_no === null)).toBe(true);
  });

  it('carries nothing about other boards, subjects or chapters, and stays short', () => {
    for (const other of ['ICSE', 'Maharashtra', 'Physics', 'NCERT', 'Boards:', 'Subjects:']) expect(text).not.toContain(other);
    expect(chatbotPrompt(HEAT).length).toBeLessThan(4000);
  });

  it('is the same for everyone, and says nothing about the site, signing in or sending', () => {
    expect(text).not.toMatch(/https?:|localhost|shikshaq\.in|sign in|Google|Send|HoD|approv|Questions box/i);
  });

  it('explains multiple choice, optional words and short forms the way the site reads them', () => {
    expect(text).toContain(`at most ${MAX_OPTIONS})`);
    expect(text).toMatch(/separated by ";"/);
    const { rows, issues } = format(`${chapterLines(HEAT)}\nTopic 1: Hot and Cold\nThe Sun is hot | True | False\nUnit of temperature | [degree] Celsius (C) | Kelvin; Newton; Joule | easy`);
    expect(issues).toEqual([]);
    expect(rows.map((r) => [r.answer, r.wrong_options])).toEqual([['True', ['False']], ['[degree] Celsius (C)', ['Kelvin', 'Newton', 'Joule']]]);
    expect(mark('Celsius', rows[1].answer)).toBe('right');
    expect(mark('C', rows[1].answer)).toBe('right');
  });

  it('states the limits and the difficulties the site enforces', () => {
    expect(text).toContain(`at most ${MAX_ANSWER} characters and ideally 1 to 3 words`);
    expect(text).toContain(`is at most ${MAX_QUESTION} characters`);
    expect(text).toContain('" | " and easy, medium or hard');
  });

  it('follows its own rules: no answer inside its question, and no yes/no answers', () => {
    for (const r of format(formatExample(HEAT)).rows) {
      expect(r.question.toLowerCase(), r.question).not.toContain(r.answer.toLowerCase());
      expect(r.answer).not.toMatch(/^(yes|no)$/i);
    }
  });

  it("ends with a place for the teacher's material", () => {
    expect(chatbotPrompt(HEAT).startsWith(text)).toBe(true);
    expect(chatbotPrompt(HEAT).trimEnd()).toMatch(/Material \(my notes or questions; if there is nothing here, write from the textbook\):$/);
  });
});

describe('the guide for people', () => {
  it('has an example that the site reads with no warnings and nothing missing', () => {
    const guide = read('src/components/games/Guide.tsx');
    const sample = guide.match(/data-testid="guide-sample"[^>]*>\{`([\s\S]*?)`\}<\/pre>/)![1];
    const { rows, issues } = format(sample);
    expect(issues).toEqual([]);
    expect(rows.length).toBeGreaterThan(2);
    expect(missing(rows)).toEqual({ board: 0, class: 0, subject: 0, chapter: 0, topic: 0, id: 0 });
  });
});
