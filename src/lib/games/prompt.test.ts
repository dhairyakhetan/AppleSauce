import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { format, MAX_ALSO, MAX_ANSWER_WORDS, MAX_OPTIONS, MAX_PER_CHAPTER, MAX_PER_TOPIC, MAX_QUESTION, MIN_OPTIONS, missing, NO_FILL } from './format';
import { checkList } from './catalog';
import { readBulk } from './list-draft';
import { bulkPrompt, chapterLines, chatbotPrompt, fixPrompt, INSTRUCTIONS_URL, topicLines } from './prompt';
import { DIFFICULTIES, type ListChapter } from './rows';

/* The chatbot prompts and the checker must agree: a chatbot follows the prompt, and the checker reads what it writes.
   The prompt is made for one chapter on the list, so it carries that chapter's lines and topics and nothing about any
   other. The fix prompt carries each problem and the whole text, and asks for all of it again. */

const HEAT: ListChapter = {
  chapter_id: 'CBSE07SCI04', board: 'CBSE', class: 7, subject: 'Science', chapter_no: 4, name: 'Heat',
  topics: [
    { topic_id: 'CBSE07SCI04T01', topic_no: 1, name: 'Hot and Cold' },
    { topic_id: 'CBSE07SCI04T02', topic_no: 2, name: 'Transfer of Heat' },
  ],
};
const NO_TOPICS: ListChapter = { chapter_id: 'ICSE06GEO02', board: 'ICSE', class: 6, subject: 'Geography', chapter_no: 2, name: 'Landforms of the Earth', topics: [] };
const read = (path: string) => readFileSync(path, 'utf8');

describe('the chatbot prompt: short, with the link to the rules and this chapter', () => {
  const prompt = chatbotPrompt(HEAT);

  it('sends the chatbot to the rules page and gives only what that page cannot know', () => {
    expect(INSTRUCTIONS_URL).toBe('https://www.shikshaq.in/games/instructions.md');
    expect(prompt).toContain(INSTRUCTIONS_URL);
    expect(prompt).toContain(`\`\`\`\n${chapterLines(HEAT)}\n\`\`\``);
    expect(prompt).toContain(`Topics (fixed: use only these, written exactly like this):\n\n\`\`\`\n${topicLines(HEAT)}\n\`\`\``);
    expect(prompt.length).toBeLessThan(900); // the rules are on the page, not repeated here
    expect(prompt.trimEnd()).toMatch(/My material \(notes or questions; if there is nothing here, write from the standard textbook\):$/);
  });

  it('names each kind of topic list in the words the rules page uses', () => {
    const inUse: ListChapter = { ...NO_TOPICS, open: true, topics: [{ topic_id: 'ICSE06GEO02T01', topic_no: 1, name: 'Mountains' }] };
    expect(chatbotPrompt(inUse)).toContain('Topics (already in use: keep these for the questions that belong there; you may add new ones after them):\n\n```\nTopic 1: Mountains\n```');
    expect(chatbotPrompt(NO_TOPICS)).toContain('Topics: none given. Divide the chapter into topics yourself.');
    expect(chatbotPrompt(NO_TOPICS)).not.toMatch(/^Topic \d/m);
    const page = read('public/games/instructions.md');
    for (const words of ['"fixed"', '"already in use"', 'none given']) expect(page).toContain(words);
  });

  it('a reply in the shape it asks for, with its chapter and topic lines, is read as this chapter and its topics', () => {
    const blocks = topicLines(HEAT).split('\n').map((t, i) => `${t}\n\nQ: Question ${i + 1}\nA: Its answer\nFill: Sentence ${i + 1} with ___ in it.\nWrong: One; Two; Three\nLevel: easy`).join('\n\n');
    const reply = `${chapterLines(HEAT)}\n\n${blocks}`;
    const { rows, issues } = format(reply);
    expect([...issues, ...checkList(reply, rows, [HEAT]).issues]).toEqual([]);
    expect(rows.map((r) => [r.chapter_id, r.topic_id, r.chapter, r.topic])).toEqual([
      ['CBSE07SCI04', 'CBSE07SCI04T01', 'Heat', 'Hot and Cold'],
      ['CBSE07SCI04', 'CBSE07SCI04T02', 'Heat', 'Transfer of Heat'],
    ]);
  });

  it('carries nothing about other boards, subjects or chapters', () => {
    for (const other of ['ICSE', 'Maharashtra', 'Physics', 'NCERT']) expect(prompt).not.toContain(other);
  });
});

describe('the prompt to fix problems', () => {
  const pasted = `${chapterLines(HEAT)}\nstray line\n\nTopic 1: Hot and Cold\n\nQ: Device used to measure temperature\nA: Thermometer\nFill: A ___ measures temperature.\nWrong: Barometer; Speedometer; Hygrometer\nLevel: easy\n\nQ: Which of the following is a good conductor?\nA: Copper\n\nQ: Normal body temperature\nA: 37 °C (approx.)\nWrong: 35; 40\nLevel: tricky\nit is 98.6 in Fahrenheit\n\nQ: Does a black shirt take in more heat than a white one?\nA: Yes\n\nWind that blows from sea to land in the day | Sea breeze\n`;
  const { rows, issues } = format(pasted);
  const prompt = fixPrompt(pasted, rows, issues);
  const item = (n: number) => prompt.split(/\n\n(?=\d+\. )/).find((x) => x.startsWith(`${n}. `)) ?? '';

  it('lists each question turned away by its Q: and A: lines, with short instructions, and nothing about the good ones', () => {
    expect(item(1)).toContain('1. Q: Which of the following is a good conductor?\n   A: Copper');
    expect(item(1)).toContain('- Ask it directly, without "of the following".');
    expect(prompt).not.toContain('Q: Device used to measure temperature\n   A:'); // nothing wrong with it
  });

  it('says what to do for each problem, once, rewrites before additions, and makes the question whole', () => {
    const temp = item(2);
    expect(temp).toContain('Drop "(approx.)" from the answer.');
    expect(temp).toContain('Put the unit in the question');
    expect(temp).toContain('Give 3 wrong options on the Wrong: line (it has 2).');
    expect(temp).toContain('Change "Level: tricky" to easy, medium or hard.');
    expect(temp).toContain('Remove the line "it is 98.6 in Fahrenheit"');
    expect(temp.indexOf('Add a Fill')).toBeGreaterThan(temp.indexOf('Change "Level'));
    expect(item(1)).toContain('Add a Wrong: line with 3 wrong options');
    expect(item(1)).toContain('Add a Level: line');
    for (const n of [1, 2, 3]) expect(item(n).split('\n').length, `item ${n}`).toBe(new Set(item(n).split('\n')).size);
  });

  it("never asks for something that contradicts another fix: a Yes/No question becomes True/False, with no Fill or Wrong", () => {
    const yes = item(3);
    expect(yes).toContain('Turn it into a statement, with A: True or A: False');
    expect(yes).not.toMatch(/Add a (Fill|Wrong)/);
  });

  it("uses the chatbot's instructions, not the page's explanations", () => {
    expect(prompt).not.toContain(NO_FILL);
    expect(prompt).not.toContain('so this question can');
    expect(prompt).not.toContain('Students would have to');
  });

  it('treats a question written on one line as a question, and other lines as other lines', () => {
    expect(item(4)).toContain('4. The line "Wind that blows from sea to land in the day | Sea breeze"\n   - Write it as a full block');
    expect(prompt).toContain('Other lines to fix:\n\n- "stray line": Remove this line, or write it as a question block.');
  });

  it('gives the rules once, the whole text, and ends by asking for all of it again in one code block', () => {
    expect(prompt).toContain(`Every question you fix or write follows these rules (all of them are at ${INSTRUCTIONS_URL}):`);
    expect(prompt).toContain(`\`\`\`\n${pasted.trimEnd()}\n\`\`\``);
    expect(prompt.trimEnd()).toMatch(/Write the entire text again, from the Board line to the last question, with these fixes and nothing else changed\. Put all of it in ONE code block, so I can copy it at once\.$/);
    expect(prompt).not.toMatch(/20 to 30|per topic|per chapter|your questions/);
  });

  it('fences the text with four backticks when it has code fences of its own', () => {
    const fenced = `\`\`\`\n${pasted}\`\`\``;
    const f = format(fenced);
    expect(fixPrompt(fenced, f.rows, f.issues)).toContain(`\`\`\`\`\n${fenced}\n\`\`\`\``);
  });
});

describe('the guide for people', () => {
  it('has an example that the checker reads with no problems and nothing missing', () => {
    const guide = read('src/components/games/Guide.tsx');
    const sample = guide.match(/data-testid="guide-sample"[^>]*>\{`([\s\S]*?)`\}<\/pre>/)![1];
    const { rows, issues } = format(sample);
    expect(issues).toEqual([]);
    expect(rows.length).toBeGreaterThan(2);
    expect(missing(rows)).toEqual({ board: 0, class: 0, subject: 0, chapter: 0, topic: 0, id: 0 });
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

/* public/games/instructions.md is the same rules as plain text, for a chatbot that is given the link instead of the
   copied prompt. Its limits and its worked example must agree with the checker too. */
describe('the plain instructions page agrees with the checker', () => {
  const page = read('public/games/instructions.md');

  it('is plain text, with no HTML or styling', () => {
    expect(page).not.toMatch(/<[a-z][^>]*>|style=|class=/i);
  });

  it('has a worked example that the checker reads with no problems', () => {
    const block = page.slice(page.indexOf('## Complete example')).match(/```\n([\s\S]*?)```/)![1];
    const { rows, issues } = format(block);
    expect(issues).toEqual([]);
    expect(rows.length).toBeGreaterThan(1);
    expect(missing(rows)).toEqual({ board: 0, class: 0, subject: 0, chapter: 0, topic: 0, id: 0 });
  });

  it('has good example blocks in part C that the checker reads with no problems', () => {
    const good = page.slice(page.indexOf('### Good blocks'), page.indexOf('### Bad blocks'));
    const blocks = [...good.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1]);
    expect(blocks.length).toBeGreaterThan(3);
    for (const b of blocks) expect(format(`Board: CBSE\nClass: 7\nSubject: Science\nChapter 4: Heat\nTopic 1: Hot and Cold\n\n${b}`).issues, b).toEqual([]);
  });

  it('carries a version line, ends with the heading the prompt names, and says it needs nothing but itself', () => {
    expect(page).toMatch(/^Version \d+\.\d+, /m);
    expect(page.trimEnd().endsWith('## End of instructions')).toBe(true);
    expect(chatbotPrompt(HEAT)).toContain('down to the heading "End of instructions"');
    expect(page).toContain("Don't rely on earlier chats, saved memories, custom instructions, browsing or other tools.");
  });

  it("states the checker's limits and levels", () => {
    expect(page).toContain(`At most ${MAX_QUESTION} characters`);
    expect(page).toContain(`at most ${MAX_ANSWER_WORDS} words`);
    expect(page).toContain(`at most ${MAX_ALSO} lines`);
    expect(page).toContain(`${MIN_OPTIONS} to ${MAX_OPTIONS} wrong options`);
    expect(page).toContain(`Never more than ${MAX_PER_TOPIC} in one topic, and never more than ${MAX_PER_CHAPTER} in the chapter`);
    expect(page).toContain(DIFFICULTIES.join(', ').replace(/, ([^,]*)$/, ' or $1'));
    expect(page).toContain('At least 3 other words around the ___');
    expect(page).toContain('A True/False question is different: it has only Q, A and Level');
    for (const label of ['Q:', 'A:', 'Also:', 'Fill:', 'Wrong:', 'Level:']) expect(page).toContain(label);
  });
});
