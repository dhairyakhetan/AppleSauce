/**
 * The prompts the games pages copy for a chatbot:
 *
 *   chatbotPrompt  Write questions, "Copy chatbot prompt": questions for the ONE chapter chosen with the dropdowns, in
 *                  the format the page reads (format.ts), with the teacher's material underneath. The chatbot divides
 *                  the questions into topics itself, as many as the chapter needs ("Topic: Name" lines; the page numbers
 *                  them), keeping the topics already in use; where the list fixes the chapter's topics, it uses those.
 *                  The reply is Topic lines and question blocks only: the page already knows the chapter.
 *   fixPrompt      Write questions, "Copy a prompt to fix them": each question the page turned away with what to change,
 *                  the text as it is, and to write all of it again.
 *   bulkPrompt     Chapters (admins), Bulk add: chapters for the boards, classes and subjects named under it, in the
 *                  form Bulk add reads (readBulk in list-draft.ts).
 *
 * The rules are the checker's, said once (RULES) and used by both question prompts, so a chatbot that follows them
 * writes text the page takes as it is. prompt.test.ts fails if they drift apart (labels, limits, levels, the example).
 * Everyone on the team copies the same prompt, so it says nothing about the site.
 */
import { isOpen } from './catalog';
import { MAX_ALSO, MAX_ANSWER_WORDS, MAX_OPTIONS, MAX_PER_SEND, MAX_PER_TOPIC, MAX_QUESTION, MIN_OPTIONS, type Draft, type Issue } from './format';
import { DIFFICULTIES, type ListChapter } from './rows';

const FENCE = '```';
const fenced = (lines: string, fence = FENCE) => `${fence}\n${lines}\n${fence}`;
const or = (xs: readonly string[]) => `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`;

/** Two topics and three questions that show every part of the format (from no chapter in particular). */
export const EXAMPLE_BLOCKS = `Topic: Photosynthesis

Q: Gas that green plants take in from the air to make their food
A: Carbon dioxide
Also: CO2
Fill: Green plants take in ___ from the air to make their food.
Wrong: Oxygen; Nitrogen; Hydrogen
Level: easy

Q: Number of molecules of carbon dioxide used to make one molecule of glucose
A: 6
Also: Six
Fill: Plants use ___ molecules of carbon dioxide to make one molecule of glucose.
Wrong: 2; 4; 12
Level: medium

Topic: Transpiration

Q: Plants lose water vapour mainly through the stomata of their leaves
A: True
Level: easy`;

/** The block, with what each line is. */
const SHAPE = `Q: the question
A: the answer
Also: another answer that is just as right (only if there is one)
Fill: the same fact as a sentence, with ___ where the answer goes
Wrong: a wrong option; another; another
Level: easy`;

/** Every rule the checker applies, as a chatbot needs them. */
export const RULES = `- A Topic line ("Topic: Name") above each topic's questions. Every question is under one.
- Every question has the lines Q, A, Fill, Wrong and Level, in the order shown, each on ONE line that starts with its label and a colon. Add Also lines, right after A, only when there is another right answer. Put a blank line between questions.
- True/False: a statement after Q, then "A: True" or "A: False", then Level. No Also, Fill or Wrong lines. At most one question in five.
- Q: tests one fact and has exactly one right answer. It makes sense on its own: never "of the following", "which of these", "the above", "given below", "this", and never a figure, diagram, map, table or passage. It never contains its answer, has no ___, is not a yes/no question, and does not start with "True or false". At most ${MAX_QUESTION} characters.
- A: the shortest correct answer, exactly what a student would type: a word, a name, a short phrase or a number, at most ${MAX_ANSWER_WORDS} words. No brackets, no notes such as "(approx.)", never two answers joined by "/". Put units in the question ("Boiling point of water, in degrees Celsius" with A: 100). If the answer needs a symbol a keyboard doesn't have (x², √2, π), add an Also line written with ordinary keys (x^2, sqrt 2, pi). Prefer answers made of letters where the material allows: crosswords and word searches need them (3 to 15 letters).
- Also: only answers that are just as right: a short form (CO2), another name (Calcutta for Kolkata), a number in words (Six for 6). Not the answer again with other capitals or spacing, and not spelling mistakes. At most ${MAX_ALSO}, one per line.
- Fill: the same fact as one full sentence, with exactly one ___ (three underscores) standing for the whole answer. The rest of the sentence never contains the answer.
- Wrong: ${MIN_OPTIONS} wrong options (at most ${MAX_OPTIONS}) separated by ";" (not commas). Believable, clearly wrong, and the same kind as the answer: a number for a number, a gas for a gas, about as long as it. Never the answer or an Also answer, and never "All of the above", "None of these" or "Both a and b": the options are shuffled.
- Level: ${or(DIFFICULTIES)}. Easy is recalling a fact; medium needs understanding; hard needs applying it or linking ideas.`;

const FENCED_TOPICS = (ch: ListChapter) => fenced(ch.topics.map((t) => `Topic: ${t.name}`).join('\n'));

/** How the chatbot divides the chapter into topics: the list's when it fixes them, else its own, keeping those in use. */
function topicsPart(ch: ListChapter): string {
  if (!isOpen(ch)) {
    return `Its topics are fixed. Put each question under the one of these Topic lines it belongs to, written exactly like this. Use no other topic, and leave out a topic the material doesn't cover:

${FENCED_TOPICS(ch)}`;
  }
  return `Divide the questions into topics yourself: as many topics as the chapter needs, no more.

- A topic is a part of the chapter that the textbook gives a heading of its own (in a chapter on heat: Conduction, Convection, Radiation). Not a kind of question ("MCQs", "Short answers"), not a single fact, and not the chapter's own name.
- Put the topics in the order the chapter teaches them. Write each as a line "Topic: Name" (no number) with its questions under it.${ch.topics.length ? `
- These topics are already in use for this chapter. Use them, written exactly like this, for the questions that belong there, and add new topics only for parts they don't cover:

${FENCED_TOPICS(ch)}` : ''}`;
}

/** "Copy chatbot prompt": the instructions for one chapter, then a place for the teacher's material. */
export function chatbotPrompt(ch: ListChapter): string {
  return `# Revision questions for one chapter

Write questions for school revision games: crossword, word search, matching, fill in the blank and multiple choice. The teacher pastes your reply into a page that checks every line and turns away any question that breaks a rule below, so follow them exactly.

## The chapter

${ch.board}, class ${ch.class}, ${ch.subject}
Chapter ${ch.chapter_no}: ${ch.name}

Write only about this chapter. Use the teacher's material below these instructions: every question and answer must come from it. If there is none, use well-established facts from the standard textbook for this chapter, and leave out anything you are not sure of. Write in the material's language.

## Topics

${topicsPart(ch)}

## How many

About 10 to 20 questions per topic, never more than ${MAX_PER_TOPIC} in a topic and never more than ${MAX_PER_SEND} in all. Fewer is fine when the material is short: never pad, and never ask the same thing twice.

## The format: Topic lines, and one block per question

${fenced(`Topic: Name of the topic\n\n${SHAPE}`)}

## The rules

${RULES}

## Example

This shows the format only; your topics and questions come from the chapter above.

${fenced(EXAMPLE_BLOCKS)}

## Your reply

- Put everything in ONE code block, so the teacher can copy it with one click: each Topic line with its questions under it.
- Inside it, only Topic lines and question blocks: no headings, no numbering, no bold, and no Board or Chapter lines (the page already knows the chapter).
- After the block, at most two short sentences, and only if needed: which answers you were unsure of, or that you wrote from general knowledge and the teacher should check them.

---

Material (my notes, a textbook passage or questions; if there is nothing here, write from the textbook):
`;
}

/**
 * "Copy a prompt to fix them": each question the page turned away, with what to change as short instructions for the
 * chatbot (each problem's `fix`, not the page's wording); the other lines it couldn't use; the rules; the whole text as
 * it is now; and last, to write all of it again in one code block. Self-contained, so it works in a new chat as well as
 * in the one that wrote the questions, and for questions a teacher typed.
 */
export function fixPrompt(text: string, drafts: Draft[], issues: Issue[]): string {
  const lines = text.split(/\r?\n/);
  const quote = (n: number) => (lines[n - 1] ?? '').trim();
  const unique = (xs: string[]) => [...new Set(xs)];

  const items = drafts.flatMap((d, i) => {
    const fixes = unique(issues.filter((x) => x.q === i && x.fix).map((x) => x.fix))
      // what to change first, then what to add
      .sort((x, y) => Number(x.startsWith('Add ')) - Number(y.startsWith('Add ')));
    if (!fixes.length) return [];
    return [[`Q: ${d.question || '(no question)'}${d.answer ? `\n   A: ${d.answer}` : ''}`, ...fixes.map((f) => `   - ${f}`)].join('\n')];
  });
  const others = unique(issues.filter((x) => x.q === undefined).map((x) => `- Line "${quote(x.line)}": ${x.fix}`));
  const fence = text.includes(FENCE) ? '````' : FENCE;

  return `# Fix these revision questions

A page that checks revision questions turned these away. Fix exactly what is listed, and keep every other question exactly as it is.

${items.length ? items.map((t, k) => `${k + 1}. ${t}`).join('\n\n') : '(No question by itself.)'}
${others.length ? `\nOther lines:\n\n${others.join('\n')}\n` : ''}
The rules every question follows:

${RULES}

The text:

${fenced(text.trimEnd(), fence)}

Write the whole text again, every Topic line and every question, with these fixes and nothing else changed. Put all of it in ONE code block, with only Topic lines and question blocks inside, so I can copy it at once.
`;
}

/**
 * The Chapters page's "Copy chatbot prompt" (Bulk add): chapters as the syllabus and its usual textbook have them, for
 * the boards, classes and subjects the admin writes under it, in the form Bulk add reads. Chapters already on the list
 * may come back too: Bulk add leaves them as they are.
 */
export function bulkPrompt(): string {
  return [
    'List the chapters of the boards, classes and subjects I name at the end, as in the current syllabus and its usual textbook, in the order they are taught.',
    '',
    'For each subject, write a Board, a Class and a Subject line, then one chapter per line: its number in the textbook, a full stop, a space, then its name. For example:',
    '',
    'Board: CBSE',
    'Class: 9',
    'Subject: Science',
    '1. Name of the First Chapter',
    '2. Name of the Second Chapter',
    '',
    'Rules:',
    '- Write boards and subjects as they are usually written: CBSE, ICSE, ISC, or a state board such as West Bengal State Board; Physics, History & Civics, Mathematics.',
    '- Name each chapter as the textbook names it, in Title Case, with British spelling.',
    '- No long dashes in a name: use a colon or a comma instead.',
    '- At most 120 characters in a name, and no two chapters of a subject with the same name.',
    '- Numbers from 1 to 99, each used once in a subject.',
    '- Only the chapters: no topics, notes or headings.',
    '',
    'Reply with only the list, in ONE code block, so it can be copied with one click.',
    '',
    'Boards, classes and subjects to list:',
    '',
  ].join('\n');
}
