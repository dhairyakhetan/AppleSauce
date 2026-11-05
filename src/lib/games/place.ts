/**
 * Which chapter questions go to, as Write questions chooses it: board, class, subject and chapter, each a dropdown of
 * what the list of chapters has, so nothing is typed and nothing can be misspelt. Topics are not chosen here: they are
 * Topic lines in the box, decided by whoever writes the questions (format.ts `checkTopics`).
 *
 * Pure: the page keeps a `Place` (what each dropdown says) and works out the rest from the list each time.
 */
import type { Where } from './format';
import type { ListChapter } from './rows';

/** What each dropdown says (the chapter by its ID). */
export interface Place { board: string; cls: string; subject: string; chapter: string }
export const NO_PLACE: Place = { board: '', cls: '', subject: '', chapter: '' };

const uniq = <T,>(xs: T[]) => [...new Set(xs)];
/** The chosen value if it is one of the options; the only option when there is just one. */
const fit = (v: string, options: string[]) => (options.includes(v) ? v : options.length === 1 ? options[0] : '');

export interface Options {
  boards: string[];
  classes: number[];
  subjects: string[];
  chapters: ListChapter[];
  /** The chosen chapter, once board, class, subject and chapter are chosen. */
  chapter?: ListChapter;
  /** The place with every dropdown that has one choice filled in, and any choice no longer on the list emptied. */
  place: Place;
}

/** The choices each dropdown offers, from the list and what is chosen before it. */
export function options(list: ListChapter[], p: Place): Options {
  const boards = uniq(list.map((c) => c.board)).sort();
  const board = fit(p.board, boards);
  const classes = uniq(list.filter((c) => c.board === board).map((c) => c.class)).sort((a, b) => a - b);
  const cls = fit(p.cls, classes.map(String));
  const subjects = uniq(list.filter((c) => c.board === board && String(c.class) === cls).map((c) => c.subject)).sort();
  const subject = fit(p.subject, subjects);
  const chapters = list.filter((c) => c.board === board && String(c.class) === cls && c.subject === subject).sort((a, b) => a.chapter_no - b.chapter_no);
  const chapter = chapters.find((c) => c.chapter_id === fit(p.chapter, chapters.map((x) => x.chapter_id)));
  return { boards, classes, subjects, chapters, chapter, place: { board, cls, subject, chapter: chapter?.chapter_id ?? '' } };
}

/** The chapter the questions go to, once it is chosen; else null, with what is still to choose. */
export function whereOf(list: ListChapter[], p: Place): { where: Where | null; chapter?: ListChapter; todo?: string } {
  const o = options(list, p);
  const ch = o.chapter;
  if (!o.place.board || !o.place.cls || !o.place.subject) return { where: null, todo: 'Choose the board, class and subject.' };
  if (!ch) return { where: null, todo: 'Choose the chapter.' };
  return { where: { chapter_id: ch.chapter_id, board: ch.board, class: ch.class, subject: ch.subject, chapter_no: ch.chapter_no, chapter: ch.name }, chapter: ch };
}

/** The chapter of a question already sent ("Fix it" on a sent-back question). */
export function placeOf(list: ListChapter[], r: { chapter_id: string | null }): Place {
  const ch = list.find((c) => c.chapter_id === r.chapter_id);
  return ch ? { board: ch.board, cls: String(ch.class), subject: ch.subject, chapter: ch.chapter_id } : NO_PLACE;
}
