import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ALL_BOARDS, SUBJECTS } from './details';
import { format, MAX_ANSWER, MAX_QUESTION, missing } from './format';
import { chatbotInstructions, chatbotPrompt, PROMPT_EXAMPLE, PROMPT_FORMAT } from './prompt';
import { COLUMNS, DIFFICULTIES } from './rows';

/* The chatbot prompt ("Copy chatbot prompt") and the code must agree: a chatbot follows the prompt, and the formatter
   reads what it writes. Ported from the games site's instructions test; the instructions now travel in the prompt
   rather than hidden in the page. */

const SITE = 'https://shikshaq.in/games';
const text = chatbotInstructions(SITE);
const read = (path: string) => readFileSync(path, 'utf8');

describe('the chatbot prompt agrees with the code', () => {
  it('lists the columns the site writes, in order', () => {
    expect(text).toContain(COLUMNS.join(', '));
  });

  it('explains the IDs the site makes, with real examples', () => {
    const rows = format(PROMPT_EXAMPLE).rows;
    expect(text).toContain(`for example ${rows[0].chapter_id} for CBSE, class 10, Science, chapter 1, and ${rows[0].chapter_id}T02 for its topic 2`);
  });

  it('names exactly the boards and subjects the site accepts', () => {
    expect(text).toContain(`Boards: ${ALL_BOARDS.map((b) => b.name).join(', ')}.`);
    expect(text).toContain(`Subjects: ${SUBJECTS.map((s) => s.name).join(', ')}.`);
    expect(text).toContain('Maharashtra State Board');
  });

  it('states the length limits the site enforces', () => {
    expect(text).toContain(`at most ${MAX_ANSWER} characters and ideally 1 to 3 words`);
    expect(text).toContain(`is at most ${MAX_QUESTION} characters`);
    expect(text).toContain(`Every answer is short (at most ${MAX_ANSWER} characters) and every question at most ${MAX_QUESTION} characters`);
  });

  it('names exactly the difficulty values the site accepts', () => {
    expect(text).toContain(DIFFICULTIES.join(', ').replace(/, (\w+)$/, ' or $1'));
  });

  it('gives a format template that the site reads with every detail', () => {
    expect(text).toContain(PROMPT_FORMAT);
    const { rows, issues } = format(PROMPT_FORMAT);
    expect(issues).toEqual([]);
    expect(rows.map((r) => [r.topic_id, r.board, r.class, r.subject, r.chapter_no, r.topic_no, r.question_no, r.difficulty])).toEqual([
      ['CBSE10SCI01T01', 'CBSE', 10, 'Science', 1, 1, 1, 'easy'],
      ['CBSE10SCI01T01', 'CBSE', 10, 'Science', 1, 1, 2, null],
      ['CBSE10SCI01T02', 'CBSE', 10, 'Science', 1, 2, 1, 'medium'],
    ]);
  });

  it('gives a worked example that the site reads cleanly, with nothing missing', () => {
    expect(text).toContain(PROMPT_EXAMPLE);
    const { rows, issues } = format(PROMPT_EXAMPLE);
    expect(issues).toEqual([]);
    expect(rows).toHaveLength(12);
    expect(missing(rows)).toEqual({ board: 0, class: 0, subject: 0, chapter: 0, topic: 0, id: 0 });
    expect(new Set(rows.map((r) => `${r.topic_id} ${r.topic}`))).toEqual(new Set(['CBSE10SCI01T01 Chemical Equations', 'CBSE10SCI01T02 Types of Chemical Reactions', 'CBSE10SCI01T03 Effects of Oxidation in Everyday Life']));
    // the example is written exactly as the site would store it
    expect(rows.every((r) => PROMPT_EXAMPLE.includes(`Topic ${r.topic_no}: ${r.topic}`) && PROMPT_EXAMPLE.includes(`Chapter 1: ${r.chapter}`))).toBe(true);
    expect(rows.every((r) => r.difficulty && r.answer.length <= 30)).toBe(true);
    expect(text).toContain(`Chapter 1, ${rows[0].chapter}`);
  });

  it('names the address, the box and the buttons the teacher really sees', () => {
    const page = read('src/components/games/WriteQuestions.tsx');
    for (const label of ['Questions', 'Download CSV', 'Download JSON']) {
      expect(page).toMatch(new RegExp(`>\\s*(<ActionIcon[^\\n]*</ActionIcon>)?${label}\\s*<`));
      expect(text).toContain(label);
    }
    expect(page).toContain("'Send'");
    expect(text).toContain('press Send to send the questions to your HoD');
    expect(text).toContain(`open ${SITE}, sign in with Google`);
    expect(read('src/pages/Auth.tsx')).toMatch(/Google/);
    expect(page).toContain("chatbotPrompt(`${location.origin}/games`)");
  });

  it('follows its own rules: no answer inside its question, and no yes/no answers', () => {
    for (const block of [PROMPT_FORMAT, PROMPT_EXAMPLE]) {
      for (const r of format(block).rows) {
        expect(r.question.toLowerCase(), r.question).not.toContain(r.answer.toLowerCase());
        expect(r.answer).not.toMatch(/^(yes|no)$/i);
      }
    }
  });

  it('ends with a place for the teacher\'s material', () => {
    expect(chatbotPrompt(SITE).startsWith(text)).toBe(true);
    expect(chatbotPrompt(SITE).trimEnd()).toMatch(/Material \(my notes, my questions, or just the board, class, subject and chapter\):$/);
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
