/**
 * The fixed list of chapters (games.chapters in the database): questions can only be sent for a chapter on it, and
 * Write questions picks the chapter and topic from it with dropdowns, so nothing is typed. Where the list gives a
 * chapter topics (games.topics), only those; where it gives none, the chapter is open: its questions may go under a
 * topic already in use, a new topic (the first question sent under it adds it, numbered after the others), or none.
 *
 * Pure: the list is loaded by the page (api.loadCatalog) and passed in.
 */
import { titleCase, tidy } from './details';
import type { ListChapter } from './rows';

/** How the database compares names: case, extra spaces and punctuation at the end don't matter. */
export const sameName = (a: string, b: string) => {
  const n = (t: string) => t.trim().replace(/[\s?.!:;,।]+$/u, '').replace(/\s+/g, ' ').toLowerCase();
  return n(a) === n(b);
};

/** A chapter whose topics the list doesn't fix: its questions may go under topics of their own (or none). */
export const isOpen = (ch: ListChapter) => ch.open ?? ch.topics.length === 0;

/** The most characters in a topic's name (the database's limit). */
export const MAX_TOPIC_NAME = 120;

/**
 * A new topic for an open chapter, as typed: its name written the standard way, the number it will get (after every
 * topic the chapter has), and what is wrong with it, if anything.
 */
export function newTopic(ch: ListChapter, typed: string): { no: number; name: string; problem?: string; same?: ListChapter['topics'][number] } {
  const name = titleCase(tidy(typed));
  const no = Math.max(0, ...ch.topics.map((t) => t.topic_no)) + 1;
  const same = ch.topics.find((t) => sameName(t.name, name));
  if (!name) return { no, name, problem: 'Write the new topic\'s name.' };
  if (name.length > MAX_TOPIC_NAME) return { no, name, problem: `A topic's name can have at most ${MAX_TOPIC_NAME} characters.` };
  if (/[–—]/.test(name)) return { no, name, problem: 'No long dashes in a name: use a colon or a comma.' };
  if (same) return { no, name, same, problem: `This chapter already has "${same.name}". Choose it in the Topic list instead.` };
  if (no > 99) return { no, name, problem: 'This chapter has 99 topics, the most it can have.' };
  return { no, name };
}
