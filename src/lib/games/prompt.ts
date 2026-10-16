/**
 * The two prompts the Write questions page copies for a chatbot:
 *
 *   chatbotPrompt  "Copy chatbot prompt": how to write questions for ONE chapter on the team's list, in the block format
 *                  the page reads (src/lib/games/format.ts), with the teacher's material underneath. A chapter whose
 *                  topics the list fixes gets those; any other is divided into topics by the chatbot, keeping the
 *                  topics already in use.
 *   fixPrompt      "Copy prompt to fix them" (when sending with problems): the questions the page turned away and why,
 *                  the text as it is, and, last, to write the whole text again.
 *
 * And one the Chapters page copies (admins), from its Bulk add box:
 *
 *   chapterListPrompt  the chapters of one board, class and subject, one per line, in the form Bulk add reads
 *                      (addMany in list-draft.ts), leaving out the chapters already on the list.
 *
 * The rules here are the checker's rules, said once and plainly: a chatbot that follows them writes text the page
 * accepts as it is. prompt.test.ts fails if the two drift apart (labels, limits, levels, examples), and stand-in
 * chatbots were run on it (CHANGES.md). Everyone on the team copies the same prompt, and the teacher is already on the
 * page, so it says nothing about the site, signing in or sending.
 */
import { isOpen } from './catalog';
import { MAX_ALSO, MAX_ANSWER_WORDS, MAX_OPTIONS, MAX_PER_CHAPTER, MAX_PER_TOPIC, MAX_QUESTION, MIN_OPTIONS, missing, problemsByRow, type Issue } from './format';
import { DIFFICULTIES, type ListChapter, type ListGroup, type Row } from './rows';

const FENCE = '```';
const block = (lines: string) => `${FENCE}\n${lines}\n${FENCE}`;
const or = (xs: readonly string[]) => `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`;

/** The lines that start the chatbot's block: the chapter's details, as the page reads them. */
export const chapterLines = (ch: ListChapter) =>
  [`Board: ${ch.board}`, `Class: ${ch.class}`, `Subject: ${ch.subject}`, `Chapter ${ch.chapter_no}: ${ch.name}`].join('\n');

/** The chapter's Topic lines, exactly as on the list. */
export const topicLines = (ch: ListChapter) => ch.topics.map((t) => `Topic ${t.topic_no}: ${t.name}`).join('\n');

/** Three questions that show every part of the format (from no chapter in particular). */
export const EXAMPLE_BLOCKS = `Q: Gas that green plants take in from the air to make their food
A: Carbon dioxide
Also: CO2
Fill: Green plants take in ___ from the air to make their food.
Wrong: Oxygen; Nitrogen; Hydrogen
Level: easy

Q: Number of sides of a hexagon
A: 6
Also: Six
Fill: A hexagon has ___ sides.
Wrong: 5; 7; 8
Level: easy

Q: The Sun is a star
A: True
Level: easy`;

/** The format with this chapter's own lines above the example questions, as the page reads it. */
export const formatExample = (ch: ListChapter) =>
  [chapterLines(ch), ...ch.topics.slice(0, 1).map((t) => `Topic ${t.topic_no}: ${t.name}`), '', EXAMPLE_BLOCKS].join('\n');

/** How a chatbot divides an open chapter (one whose topics the list doesn't fix) into topics of its own. */
function ownTopics(ch: ListChapter): string {
  const next = Math.max(0, ...ch.topics.map((t) => t.topic_no)) + 1;
  return `Its topics aren't fixed, so divide the questions into topics yourself:

- A topic is a part of the chapter that the textbook gives a heading of its own (in a chapter on heat: Conduction, Convection, Radiation). Not a kind of question ("MCQs", "Short answers"), not a single fact, and not the chapter's own name.
- 2 to 6 topics, fewer if the chapter is short, numbered from 1 in the order the chapter teaches them. Write each as "Topic 1: Name" on its own line, with its questions under it, and put every question under the topic it belongs to.${ch.topics.length ? `
- These topics are already in use for this chapter. Keep them, written exactly like this, for the questions that belong there, and number any new topic from ${next}:

${block(topicLines(ch))}` : ''}`;
}

/** The instructions for one chapter. */
export function chatbotInstructions(ch: ListChapter): string {
  const open = isOpen(ch);
  return `# Revision questions for one chapter

Write questions for school revision games: crossword, word search, matching, fill in the blank and multiple choice. The teacher pastes your reply into a page that checks every line and turns away any question that breaks a rule below, so follow them exactly.

## The chapter

Write only for this chapter. Start with these lines, exactly as written:

${block(chapterLines(ch))}

${open
  ? ownTopics(ch)
  : `Its topics are fixed. Put each question under the one of these Topic lines it belongs to, written exactly like this. Use no other topic, and leave out a topic the material doesn't cover:

${block(topicLines(ch))}`}

## How many

20 to 30 questions per topic, never more than ${MAX_PER_TOPIC}, and never more than ${MAX_PER_CHAPTER} in the whole chapter. Fewer is fine when the material is short: never pad, and never ask the same thing twice.

## The material

- Use the teacher's material below these instructions: notes, a textbook passage or questions. Every question and answer must come from it.
- If there is none, write from well-established facts in the standard textbook for this chapter, and leave out anything you are not sure of.
- Write in the material's language: Hindi material gets Hindi questions.

## Each question is a block

${block(`Q: the question
A: the answer
Also: another answer that is just as right
Fill: the same fact as a sentence, with ___ where the answer goes
Wrong: a wrong option; another; another
Level: easy`)}

- Every question has Q, A, Fill, Wrong and Level. Add Also lines only when there is another right answer.
- Each part on one line, starting with its label and a colon. A blank line between questions. Nothing else: no numbering, bullets, bold or headings.
- True/False: a statement after Q, and A: True or A: False. No Also, Fill or Wrong. At most one question in five.

**Q, the question**
- Tests one fact, and has exactly one correct answer.
- Makes sense on its own. Never "this", "the above", "of the following", "which of these" or "given below", and never a figure, diagram, map, table or passage.
- Never contains its answer. Not a yes/no question, and not "True or false: ...".
- At most ${MAX_QUESTION} characters, on one line. Any symbol is fine.

**A, the answer**
- The shortest correct answer: a word, a name, a short phrase or a number. At most ${MAX_ANSWER_WORDS} words, never a sentence.
- Exactly what a student should type: no brackets, no notes such as "(approx.)", and never two answers joined by "/" or "or".
- Put units in the question, not the answer: "Boiling point of water, in degrees Celsius" with A: 100.
- Prefer words to numbers where the material allows: crosswords and word searches need answers of letters only (3 to 15 letters fit both).
- If the answer needs a symbol a keyboard doesn't have (x², √2, π), also add an Also line written with ordinary keys (x^2, sqrt 2, pi).
- Never change a fact, a number or a unit to make an answer shorter.

**Also, other right answers** (at most ${MAX_ALSO}, one per line)
- Only answers that are just as right: a short form (CPU) or the full form, another name (Calcutta for Kolkata), a number in words (Six for 6), or the answer without a word the question already says.
- Not the answer with other capitals, spaces, hyphens or "the" (End point for Endpoint): those count already. Not spelling mistakes: the game gives half marks for a small slip by itself.

**Fill, the fill-in-the-blank sentence**
- The same fact as one sentence, with ___ (three underscores) where the answer goes. The ___ stands for the whole answer.
- Exactly one ___. The rest of the sentence never contains the answer, and reads correctly with the answer in the blank.

**Wrong, the wrong options for multiple choice**
- ${MIN_OPTIONS} wrong options (at most ${MAX_OPTIONS}), separated by ";". Clearly wrong but believable, the same kind of thing as the answer (a year for a year, a gas for a gas), about as long as it.
- Never the answer or an Also answer. Never "All of the above", "None of these" or "Both a and b": the options are shuffled. No ";" inside an option.

**Level**: ${or(DIFFICULTIES)}. Easy is recalling a fact; medium needs understanding; hard needs applying it or linking ideas.

## Example

This shows the format only; your questions come from the chapter above.

${block(EXAMPLE_BLOCKS)}

## Your reply

- Paste everything in ONE code block, so the teacher can copy it with one click: the chapter lines, then each Topic line with its questions under it. Nothing else inside the block.
- After the block, at most two short sentences, only if needed: which answers you filled in yourself, or that you wrote from general knowledge and the teacher should check them.
`;
}

/** The whole prompt for one chapter: the instructions, then a place for the teacher's material. */
export const chatbotPrompt = (ch: ListChapter) =>
  `${chatbotInstructions(ch)}\n---\n\nMaterial (my notes or questions; if there is nothing here, write from the textbook):\n`;

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
Every question you fix or write follows these rules:
- Its lines: Q (the question), A (the answer), Also (only for another right answer, one per line), Fill (the same fact as a sentence, with ___ where the answer goes), Wrong (${MIN_OPTIONS} wrong options separated by ";"), Level (${or(DIFFICULTIES)}). A True/False question has only Q (a statement) and A: True or A: False.
- Q makes sense on its own (no "of the following", "the above" or figure), and never contains its answer.
- A is exactly what a student types: at most ${MAX_ANSWER_WORDS} words, no brackets or notes, units in the question, and only keyboard characters (else an Also line typed with ordinary keys).
- Fill has exactly one ___, standing for the whole answer, and doesn't repeat it.
- The wrong options are the same kind as the answer, and none of them is right.

The text:

${fence}
${text.trimEnd()}
${fence}

Write the entire text again, from the Board line to the last question, with these fixes and nothing else changed. Put all of it in ONE code block, so I can copy it at once.
`;
}

/**
 * The Chapters page's "Copy chatbot prompt" (Bulk add): the chapters of one board, class and subject, as the syllabus
 * and its usual textbook have them, one per line in the form Bulk add reads. Chapters already on the list are named, to
 * be left out, with their numbers kept free.
 */
export function chapterListPrompt(g: ListGroup, onList: { chapter_no: number; name: string }[]): string {
  const have = [...onList].sort((a, b) => a.chapter_no - b.chapter_no);
  return [
    `List the chapters of ${g.board} class ${g.class} ${g.subject}, as in the current syllabus and its usual textbook, in the order they are taught.`,
    '',
    'Write one chapter per line: its number in the textbook, a full stop, a space, then its name. For example:',
    '1. Name of the First Chapter',
    '2. Name of the Second Chapter',
    '',
    'Rules:',
    '- Name each chapter as the textbook names it, in Title Case, with British spelling.',
    '- No long dashes in a name: use a colon or a comma instead.',
    '- At most 120 characters in a name, and no two chapters with the same name.',
    '- Numbers from 1 to 99, each used once.',
    '- Only the chapters: no topics, notes, headings or blank lines.',
    ...(have.length ? [
      '- These chapters are on the list already. Leave them out, and don\'t use their numbers. If a chapter you list would have one of these numbers, write it without a number.',
      ...have.map((c) => `  ${c.chapter_no}. ${c.name}`),
    ] : []),
    '',
    `Reply with only the list, in ONE code block, so it can be copied with one click.`,
  ].join('\n');
}

