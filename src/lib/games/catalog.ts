/**
 * The fixed list of chapters (games.chapters in the database): questions can only be sent for a chapter on it, and
 * Write questions picks the chapter from it with dropdowns, so nothing about it is typed. Where the list gives a chapter
 * topics (games.topics), only those; where it gives none, the chapter is open: its questions go under topics their
 * writer names, and the first question sent under a new topic adds it (format.ts `checkTopics` numbers it).
 *
 * Pure: the list is loaded by the page (api.loadCatalog) and passed in.
 */
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
