/**
 * The fixed list of chapters and topics (games.chapters and games.topics in the database): questions can only be
 * written for a chapter and topic on it, under its names. The database refuses anything else when it is sent; this
 * checks the Questions box against the list as the person writes, so they see why on the line itself.
 *
 * Pure: the list is loaded by the page (api.loadCatalog) and passed in.
 */
import { checkBoard, checkClass, checkSubject, readMeta } from './details';
import type { Issue } from './format';
import type { ListChapter, Row } from './rows';

/** How the database compares names: case, extra spaces and punctuation at the end don't matter. */
export const sameName = (a: string, b: string) => {
  const n = (t: string) => t.trim().replace(/[\s?.!:;,।]+$/u, '').replace(/\s+/g, ' ').toLowerCase();
  return n(a) === n(b);
};

const topicsOf = (ch: ListChapter) => ch.topics.map((t) => `${t.topic_no} ${t.name}`).join(', ');
const quoteTopic = (t: ListChapter['topics'][number]) => `"Topic ${t.topic_no}: ${t.name}"`;
const quoteTopics = (ch: ListChapter) => ch.topics.map(quoteTopic).join(', ');

/** The chapters on the list for a board, class and subject (as written in the detail boxes), in order. */
export function chaptersFor(list: ListChapter[], board: string, cls: string, subject: string): ListChapter[] {
  const b = checkBoard(board).name;
  const c = checkClass(cls).value;
  const s = checkSubject(subject).name;
  if (!b || !c || !s) return [];
  return list.filter((ch) => ch.board === b && ch.class === c && ch.subject === s).sort((x, y) => x.chapter_no - y.chapter_no);
}

/**
 * Problems with the questions against the list, on the line to fix (the Chapter or Topic line above the question, or
 * the question itself), and the lines of the questions that can't be sent because of them.
 */
export function checkList(text: string, rows: Row[], list: ListChapter[]): { issues: Issue[]; blocked: Set<number> } {
  // the Chapter and Topic line above each line (a Chapter line ends the topic above it)
  const lines = text.split('\n');
  const chapterLine: number[] = [];
  const topicLine: number[] = [];
  let ch = 0;
  let tp = 0;
  lines.forEach((l, i) => {
    const m = readMeta(l);
    if (m?.key === 'chapter') { ch = i + 1; tp = 0; }
    if (m?.key === 'topic') tp = i + 1;
    chapterLine[i + 1] = ch;
    topicLine[i + 1] = tp;
  });

  const issues = new Map<string, Issue>();
  // text: what the page says; fix: what the fix prompt tells a chatbot to do (prompt.ts)
  const say = (line: number, text: string, fix: string) => issues.set(`${line}\u0000${text}`, { line, level: 'error', text, fix });
  const blocked = new Set<number>();

  for (const r of rows) {
    if (!r.chapter_id) continue; // no chapter ID yet: the formatter already says what is missing
    const atChapter = chapterLine[r.line] || r.line;
    const atTopic = topicLine[r.line] || r.line;
    const chapter = list.find((c) => c.chapter_id === r.chapter_id);
    if (!chapter) {
      const here = list.filter((c) => c.board === r.board && c.class === r.class && c.subject === r.subject).sort((x, y) => x.chapter_no - y.chapter_no);
      const named = here.find((c) => sameName(c.name, r.chapter));
      say(atChapter, here.length
        ? `Chapter ${r.chapter_no} isn't on the list for ${r.board} class ${r.class} ${r.subject}. The list has ${here.map((c) => `${c.chapter_no}: ${c.name}`).join('; ')}.`
        : `The list has no chapters for ${r.board} class ${r.class} ${r.subject} yet, so these questions can't be sent.`,
      named
        ? `Change it to "Chapter ${named.chapter_no}: ${named.name}", its number on the list.`
        : here.length
          ? `Use one of these Chapter lines, the one the questions are from: ${here.map((c) => `"Chapter ${c.chapter_no}: ${c.name}"`).join(', ')}.`
          : `Check the Board, Class and Subject lines: there is no ${r.board} class ${r.class} ${r.subject} on the list.`);
      blocked.add(r.line);
      continue;
    }
    if (!sameName(chapter.name, r.chapter)) {
      const named = list.find((c) => c.board === r.board && c.class === r.class && c.subject === r.subject && sameName(c.name, r.chapter));
      say(atChapter, `On the list, chapter ${chapter.chapter_no} is called "${chapter.name}".`,
        named ? `Change it to "Chapter ${named.chapter_no}: ${named.name}", its number on the list.` : `Change it to "Chapter ${chapter.chapter_no}: ${chapter.name}", its name on the list.`);
      blocked.add(r.line);
    }
    if (!chapter.topics.length) {
      if (r.topic_no !== null) {
        say(atTopic, `Chapter ${chapter.chapter_no} has no topics on the list, so its questions go without a Topic line.`, 'Remove this Topic line: the chapter has no topics, so its questions go straight under the Chapter line.');
        blocked.add(r.line);
      }
      continue;
    }
    if (r.topic_no === null) {
      say(r.line, `This question needs a Topic line above it. Chapter ${chapter.chapter_no}'s topics: ${topicsOf(chapter)}.`, `Put it under the one of these Topic lines it belongs to: ${quoteTopics(chapter)}.`);
      blocked.add(r.line);
      continue;
    }
    const topic = chapter.topics.find((t) => t.topic_no === r.topic_no);
    // the topic the line names, if it is on the list under another number: renumber it rather than rename it
    const named = chapter.topics.find((t) => sameName(t.name, r.topic));
    const renumber = named ? `Change it to ${quoteTopic(named)}, its number on the list.` : `Use one of these Topic lines, the one its questions belong to: ${quoteTopics(chapter)}.`;
    if (!topic) {
      say(atTopic, `Chapter ${chapter.chapter_no} has no topic ${r.topic_no} on the list. Its topics: ${topicsOf(chapter)}.`, renumber);
      blocked.add(r.line);
    } else if (!sameName(topic.name, r.topic)) {
      say(atTopic, `On the list, topic ${topic.topic_no} of chapter ${chapter.chapter_no} is called "${topic.name}".`, renumber);
      blocked.add(r.line);
    }
  }
  return { issues: [...issues.values()].sort((a, b) => a.line - b.line), blocked };
}
