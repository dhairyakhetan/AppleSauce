/**
 * The prompts the games pages copy for a chatbot:
 *
 *   chatbotPrompt  "Copy chatbot prompt" (Write questions): short. It sends the chatbot to the rules at
 *                  INSTRUCTIONS_URL (public/games/instructions.md, every rule and the format, written for an AI), and
 *                  gives what that page can't know: this chapter's lines, its topics (fixed, already in use, or none
 *                  yet), and a place for the teacher's material.
 *   fixPrompt      "Copy prompt to fix them" (when sending with problems): the questions the page turned away and why,
 *                  the text as it is, and, last, to write the whole text again.
 *
 * And one the Chapters page copies (admins), from its Bulk add box:
 *
 *   bulkPrompt  chapters for the boards, classes and subjects the admin names under it, in the form Bulk add reads
 *               (readBulk in list-draft.ts): Board, Class and Subject lines, then one chapter per line.
 *
 * The rules are the checker's rules (format.ts, catalog.ts): a chatbot that follows them writes text the page accepts as
 * it is. prompt.test.ts fails if instructions.md or these prompts drift from the checker.
 */
import { isOpen } from './catalog';
import { MAX_ANSWER_WORDS, MIN_OPTIONS, missing, problemsByRow, type Issue } from './format';
import { DIFFICULTIES, type ListChapter, type Row } from './rows';

const FENCE = '```';
const block = (lines: string) => `${FENCE}\n${lines}\n${FENCE}`;
const or = (xs: readonly string[]) => `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`;

/** Where the rules for chatbots live: public/games/instructions.md on the live site. */
export const INSTRUCTIONS_URL = 'https://shikshaq.in/games/instructions.md';

/** The lines that start the chatbot's block: the chapter's details, as the page reads them. */
export const chapterLines = (ch: ListChapter) =>
  [`Board: ${ch.board}`, `Class: ${ch.class}`, `Subject: ${ch.subject}`, `Chapter ${ch.chapter_no}: ${ch.name}`].join('\n');

/** The chapter's Topic lines, exactly as on the list. */
export const topicLines = (ch: ListChapter) => ch.topics.map((t) => `Topic ${t.topic_no}: ${t.name}`).join('\n');

/** The topics part of the prompt, in the words of step 1 of instructions.md: fixed, already in use, or none yet. */
function topicsPart(ch: ListChapter): string {
  if (!isOpen(ch)) return `Topics (fixed: use only these, written exactly like this):\n\n${block(topicLines(ch))}`;
  if (ch.topics.length) return `Topics (already in use: keep these for the questions that belong there; you may add new ones after them):\n\n${block(topicLines(ch))}`;
  return 'Topics: none given. Divide the chapter into topics yourself.';
}

/** "Copy chatbot prompt": the link to the rules, this chapter, its topics, and a place for the teacher's material. */
export const chatbotPrompt = (ch: ListChapter) => `Write revision questions for this chapter. First open ${INSTRUCTIONS_URL} and follow every rule on that page exactly: it gives the format and how to reply. If you can't open it, tell me.

The chapter (copy these lines exactly):

${block(chapterLines(ch))}

${topicsPart(ch)}

My material (notes or questions; if there is nothing here, write from the standard textbook):

`;

/**
 * "Copy prompt to fix them": each question the page turned away, with what to change, as short instructions for the
 * chatbot (each problem's `fix`, not the page's wording); the other lines it couldn't use; the rules; the whole text as
 * it is now; and last, to write the whole text again in one code block. Self-contained, so it works in a new chat as
 * well as in the one that wrote the questions, and for questions a teacher typed.
 */
export function fixPrompt(text: string, rows: Row[], issues: Issue[]): string {
  const lines = text.split(/\r?\n/);
  const { byRow, general } = problemsByRow(rows, issues);
  const quote = (n: number) => (lines[n - 1] ?? '').trim();
  const own = (r: Row, x: Issue) => x.line >= r.line && x.line <= (r.end ?? r.line);
  const say = (x: Issue) => x.fix ?? x.text;
  const unique = (xs: string[]) => [...new Set(xs)];

  // the questions to fix, in the order they are written: blocks with problems on their own lines, and questions
  // written on one line
  const items: { at: number; head: string; fixes: string[] }[] = [];
  for (const [i, xs] of byRow) {
    const r = rows[i];
    const mine = xs.filter((x) => own(r, x));
    if (!mine.length) continue;
    // what to change first, then what to add
    const fixes = unique(mine.map(say)).sort((x, y) => Number(x.startsWith('Add ')) - Number(y.startsWith('Add ')));
    // a question being fixed is made whole, as the first prompt asks of every question
    const trueFalse = /^(true|false|yes|no)$/i.test(r.answer.trim());
    if (!trueFalse && !r.wrong_options.length && !fixes.some((f) => f.includes('Wrong:'))) fixes.push(`Add a Wrong: line with ${MIN_OPTIONS} wrong options, separated by ";".`);
    if (!r.difficulty && !fixes.some((f) => f.includes('Level:'))) fixes.push(`Add a Level: line (${or(DIFFICULTIES)}).`);
    items.push({ at: r.line, head: `Q: ${r.question || '(no question)'}${r.answer ? `\n   A: ${r.answer}` : ''}`, fixes });
  }
  for (const x of general) if (x.oneLine) items.push({ at: x.line, head: `The line "${quote(x.line)}"`, fixes: [say(x)] });
  items.sort((a, b) => a.at - b.at);

  // the other lines: a stray line, or a detail line (whose problem every question under it shares), listed once
  const others = new Map<string, string>();
  for (const xs of byRow.values()) for (const x of xs) if (!rows.some((r) => own(r, x))) others.set(`${x.line}\u0000${say(x)}`, `"${quote(x.line)}": ${say(x)}`);
  for (const x of general) if (!x.oneLine) others.set(`${x.line}\u0000${say(x)}`, `"${quote(x.line)}": ${say(x)}`);
  const gaps = missing(rows);
  if (gaps.id) others.set('ids', 'Start the text with complete Board, Class, Subject and Chapter lines.');

  const listed = items.map(({ head, fixes }, k) => [`${k + 1}. ${head}`, ...fixes.map((f) => `   - ${f}`)].join('\n'));
  const fence = text.includes(FENCE) ? '````' : FENCE;

  return `# Fix these revision questions

A page that checks revision questions turned these away. Fix exactly what is listed, and keep everything else as it is.

${listed.length ? listed.join('\n\n') : '(no question by itself)'}
${others.size ? `\nOther lines to fix:\n\n${[...others.values()].map((t) => `- ${t}`).join('\n')}\n` : ''}
Every question you fix or write follows these rules (all of them are at ${INSTRUCTIONS_URL}):
- Its lines: Q (the question), A (the answer), Also (only for another right answer, one per line), Fill (the same fact as a sentence, with ___ where the answer goes), Wrong (${MIN_OPTIONS} wrong options separated by ";"), Level (${or(DIFFICULTIES)}). A True/False question has only Q (a statement), A: True or A: False, and Level.
- Q makes sense on its own (no "of the following", "the above" or figure), and contains neither the answer nor an Also answer.
- A is exactly what a student types: at most ${MAX_ANSWER_WORDS} words, no brackets or notes, units in the question, and only keyboard characters (else an Also line typed with ordinary keys).
- Fill has exactly one ___, standing for the whole answer, with at least 3 other words around it, and contains neither the answer nor an Also answer.
- The wrong options are the same kind as the answer, and none of them is right.
- The labels, True and False, and the levels stay in English.

The text:

${fence}
${text.trimEnd()}
${fence}

Write the entire text again, from the Board line to the last question, with these fixes and nothing else changed. Put all of it in ONE code block, so I can copy it at once.
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
