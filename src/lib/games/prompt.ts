/**
 * What "Copy chatbot prompt" copies: the instructions a chatbot needs to write questions for ONE chapter on the
 * team's list, in the one format the question formatter reads, then the teacher's material goes underneath.
 *
 * It is made for the chapter the teacher picked: that chapter's Board, Class, Subject and Chapter lines and its Topic
 * lines, exactly as the list has them, and nothing about any other board, subject or chapter. A short prompt the
 * chatbot follows beats a long one it half follows.
 *
 * On the games site these lived hidden in the page for chatbots that fetch it. On shikshaq.in that would put hidden
 * text on every page of the main site, and chatbots can't sign in anyway, so all of it travels in the prompt.
 *
 * Everyone on the team (member, HoD, admin) copies the same prompt, and the teacher is already on the page, so it says
 * nothing about the site, signing in or sending: only the chapter, the rules and the format.
 *
 * prompt.test.ts fails if this and the code disagree (the lines, IDs, limits and difficulties), so change the two
 * together.
 */
import { MAX_ANSWER, MAX_QUESTION } from './format';
import { DIFFICULTIES, type ListChapter } from './rows';

const FENCE = '```';
const block = (lines: string) => `${FENCE}\n${lines}\n${FENCE}`;
const or = (xs: readonly string[]) => `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`;

/** The lines that start the chatbot's block: the chapter's details, as the formatter reads them. */
export const chapterLines = (ch: ListChapter) =>
  [`Board: ${ch.board}`, `Class: ${ch.class}`, `Subject: ${ch.subject}`, `Chapter ${ch.chapter_no}: ${ch.name}`].join('\n');

/** The chapter's Topic lines, exactly as on the list. */
export const topicLines = (ch: ListChapter) => ch.topics.map((t) => `Topic ${t.topic_no}: ${t.name}`).join('\n');

/** The format, shown with this chapter's own lines. */
export const formatExample = (ch: ListChapter) =>
  [chapterLines(ch), ...ch.topics.slice(0, 1).map((t) => `Topic ${t.topic_no}: ${t.name}`), 'A question | Its answer | easy', 'Another question | Its answer'].join('\n');

/** The instructions for one chapter. Everyone on the team copies the same prompt, so nothing in it depends on who. */
export function chatbotInstructions(ch: ListChapter): string {
  const topics = ch.topics.length > 0;
  return `# Revision questions for one chapter

Write short questions and answers for revision games (crossword, word search, matching, fill in the blank), in the exact format below: the teacher pastes your reply into a page that reads it line by line. If the teacher asks for something different, follow the teacher.

## The chapter

Write only for this chapter. Start your block with these lines, exactly as written:

${block(chapterLines(ch))}

${topics
  ? `Its topics are fixed. Put every question under one of these Topic lines, written exactly like this, and use no other topic:

${block(topicLines(ch))}`
  : 'This chapter has no topics: write no Topic lines. Its questions go straight under the Chapter line.'}

## The material

- Use what the teacher gives below these instructions: notes, a textbook passage or questions. Every question and answer must come from it; add no facts. If a question has no answer, fill it in only when you are certain, and say which ones you filled in.
- If there is nothing below, write from well-established facts in the standard textbook for this chapter, and leave out anything you are not sure of.${topics ? `
- Put each question under the topic it belongs to. Leave out a topic the material doesn't cover.` : ''}

## The questions

- One fact per question, with exactly one correct answer.
- The answer is the shortest correct answer: a word, a short phrase or a number, at most ${MAX_ANSWER} characters and ideally 1 to 3 words, never a sentence. Never change a fact, a number or a unit to make it shorter.
- The question makes sense on its own (no "this", "the above" or "as mentioned") and is at most ${MAX_QUESTION} characters.
- The answer must not appear in its question. No yes/no questions, and no either-or questions that give the answer away.
- For fill in the blank, write ___ where the answer goes: The ___ is the powerhouse of the cell | Mitochondria
- Prefer answers that are words rather than numbers: crosswords and word searches need letters.
- About 5 to 10 questions ${topics ? 'per topic' : 'in all'}, no two the same. Keep the teacher's language.

## The format

${block(formatExample(ch))}

- One question per line: the question, " | ", the answer. To add a difficulty, add " | " and ${or(DIFFICULTIES)}.
- No | inside a question or an answer (use /). No numbering, bullets, bold, headings, quotation marks or tables.

## Your reply

All the lines in one code block, with nothing else inside it. At most 150 question lines: if there are more, give the first 150, say to reply "continue", and start the next block with the same chapter lines. After the block, a short note only if it applies: which answers you filled in yourself, or that you wrote from general knowledge and they should be checked.
`;
}

/** The whole prompt for one chapter: the instructions, then a place for the teacher's material. */
export const chatbotPrompt = (ch: ListChapter) =>
  `${chatbotInstructions(ch)}\n---\n\nMaterial (my notes or questions; if there is nothing here, write from the textbook):\n`;
