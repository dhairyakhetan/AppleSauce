import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { format, MAX_ALSO, MAX_ANSWER_WORDS, MAX_OPTIONS, MAX_PER_CHAPTER, MAX_PER_TOPIC, MAX_QUESTION, MIN_OPTIONS, missing, NO_FILL } from './format';
import { checkList } from './catalog';
import { chapterLines, chatbotInstructions, chatbotPrompt, EXAMPLE_BLOCKS, fixPrompt, formatExample, topicLines } from './prompt';
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
const text = chatbotInstructions(HEAT);
const read = (path: string) => readFileSync(path, 'utf8');

describe('the chatbot prompt agrees with the checker', () => {
  it("gives the chapter's lines and its Topic lines exactly, and the page reads them as that chapter and its topics", () => {
    expect(text).toContain(chapterLines(HEAT));
    expect(text).toContain(topicLines(HEAT));
    const blocks = topicLines(HEAT).split('\n').map((t, i) => `${t}\n\nQ: Question ${i + 1}\nA: Its answer\nFill: Sentence ${i + 1} with ___ in it.\nWrong: One; Two; Three`).join('\n\n');
    const { rows, issues } = format(`${chapterLines(HEAT)}\n\n${blocks}`);
    expect(issues).toEqual([]);
    expect(rows.map((r) => [r.chapter_id, r.topic_id, r.chapter, r.topic])).toEqual([
      ['CBSE07SCI04', 'CBSE07SCI04T01', 'Heat', 'Hot and Cold'],
      ['CBSE07SCI04', 'CBSE07SCI04T02', 'Heat', 'Transfer of Heat'],
    ]);
  });

  it('shows an example that the checker reads with no problems, using every part', () => {
    expect(text).toContain(EXAMPLE_BLOCKS);
    const { rows, issues } = format(formatExample(HEAT));
    expect(issues).toEqual([]);
    expect(missing(rows)).toEqual({ board: 0, class: 0, subject: 0, chapter: 0, topic: 0, id: 0 });
    expect(rows.map((r) => [r.answer, r.also, !!r.fill, r.wrong_options.length, r.difficulty])).toEqual([
      ['Carbon dioxide', ['CO2'], true, 3, 'easy'],
      ['6', ['Six'], true, 3, 'easy'],
      ['True', [], false, 0, 'easy'],
    ]);
  });

  it('names every label the checker reads, and the shape of a block', () => {
    for (const label of ['Q:', 'A:', 'Also:', 'Fill:', 'Wrong:', 'Level:']) expect(text).toContain(label);
    expect(text).toMatch(/Every question has Q, A, Fill, Wrong and Level/);
    expect(text).toMatch(/True\/False: a statement after Q, and A: True or A: False\. No Also, Fill or Wrong/);
  });

  it("states the checker's limits", () => {
    expect(text).toContain(`never more than ${MAX_PER_TOPIC}, and never more than ${MAX_PER_CHAPTER} in the whole chapter`);
    expect(text).toContain('20 to 30 questions per topic');
    expect(text).toContain(`At most ${MAX_ANSWER_WORDS} words`);
    expect(text).toContain(`At most ${MAX_QUESTION} characters`);
    expect(text).toContain(`${MIN_OPTIONS} wrong options (at most ${MAX_OPTIONS}), separated by ";"`);
    expect(text).toContain(`at most ${MAX_ALSO}, one per line`);
    expect(text).toContain(DIFFICULTIES.join(', ').replace(/, (\w+)$/, ' or $1'));
    expect(text).toContain('Exactly one ___');
  });

  it("states the checker's rules about what a question and an answer may be", () => {
    for (const rule of ['"of the following"', '"which of these"', '"the above"', 'figure, diagram, map, table or passage', 'Never contains its answer',
      'Not a yes/no question', 'not "True or false: ..."', 'no brackets', '"/" or "or"', 'All of the above', 'No ";" inside an option', 'x^2', 'sqrt 2']) {
      expect(text, rule).toContain(rule);
    }
  });

  it('for a chapter the list gives no topics, asks the chatbot to divide it into topics, and the page takes them', () => {
    const plain = chatbotInstructions(NO_TOPICS);
    expect(plain).toContain("Its topics aren't fixed, so divide the questions into topics yourself");
    expect(plain).toMatch(/A topic is a part of the chapter that the textbook gives a heading of its own/);
    expect(plain).toMatch(/2 to 6 topics, fewer if the chapter is short, numbered from 1 in the order the chapter teaches them\. Write each as "Topic 1: Name"/);
    expect(plain).not.toMatch(/^Topic \d/m); // no topics of its own to keep yet
    expect(plain).toContain(`never more than ${MAX_PER_TOPIC}, and never more than ${MAX_PER_CHAPTER} in the whole chapter`);
    // a reply shaped the way it asks: topics of its own, each over its questions
    const reply = `${chapterLines(NO_TOPICS)}\n\nTopic 1: Mountains\n\n${EXAMPLE_BLOCKS}\n\nTopic 2: Plateaus\n\nQ: Flat land raised above its surroundings\nA: Plateau\nFill: A raised flat land is a ___.\nWrong: Valley; Delta; Plain\nLevel: easy`;
    const { rows, issues } = format(reply);
    expect([...issues, ...checkList(reply, rows, [NO_TOPICS]).issues]).toEqual([]);
    expect(new Set(rows.map((r) => r.topic_id))).toEqual(new Set(['ICSE06GEO02T01', 'ICSE06GEO02T02']));
  });

  it('for such a chapter with topics already in use, asks it to keep them and number new ones after them', () => {
    const inUse: ListChapter = { ...NO_TOPICS, open: true, topics: [{ topic_id: 'ICSE06GEO02T01', topic_no: 1, name: 'Mountains' }, { topic_id: 'ICSE06GEO02T02', topic_no: 2, name: 'Plateaus' }] };
    const t = chatbotInstructions(inUse);
    expect(t).toContain(`These topics are already in use for this chapter. Keep them, written exactly like this, for the questions that belong there, and number any new topic from 3:\n\n\`\`\`\n${topicLines(inUse)}\n\`\`\``);
    expect(chatbotInstructions(HEAT)).toContain("Its topics are fixed."); // a chapter the list gives topics keeps only those
  });

  it('carries nothing about other boards, subjects or chapters, and nothing about the site', () => {
    for (const other of ['ICSE', 'Maharashtra', 'Physics', 'NCERT', 'Boards:', 'Subjects:']) expect(text).not.toContain(other);
    expect(text).not.toMatch(/https?:|localhost|shikshaq\.in|sign in|Google|Send|HoD|approv|Questions box/i);
  });

  it('asks for one code block the teacher can copy, and ends with a place for the material', () => {
    expect(text).toMatch(/Paste everything in ONE code block, so the teacher can copy it with one click/);
    expect(chatbotPrompt(HEAT).startsWith(text)).toBe(true);
    expect(chatbotPrompt(HEAT).trimEnd()).toMatch(/Material \(my notes or questions; if there is nothing here, write from the textbook\):$/);
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
    expect(prompt).toContain('Every question you fix or write follows these rules:');
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
