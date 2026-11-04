/**
 * Where questions go, as Write questions chooses it: board, class, subject, chapter and topic, each a dropdown of what
 * the list of chapters has, so nothing is typed and nothing can be misspelt. A chapter whose topics the list fixes
 * offers those; an open one also offers a new topic (named by the writer, numbered after the others) and no topic.
 *
 * Pure: the page keeps a `Place` (what each dropdown says) and works out the rest from the list each time.
 */
import { isOpen, newTopic } from './catalog';
import type { Where } from './format';
import type { ListChapter } from './rows';

/** What each dropdown says. `topic`: "t3" for topic 3, "new" for a new topic (named in `newName`), "none" for no topic. */
export interface Place { board: string; cls: string; subject: string; chapter: string; topic: string; newName: string }
export const NO_PLACE: Place = { board: '', cls: '', subject: '', chapter: '', topic: '', newName: '' };

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
  /** The topic choices for it: "t1", "t2", ... and, for an open chapter, "new" and "none". */
  topics: { value: string; label: string }[];
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
  const topics = !chapter ? [] : [
    ...chapter.topics.map((t) => ({ value: `t${t.topic_no}`, label: `Topic ${t.topic_no}: ${t.name}` })),
    ...(isOpen(chapter) ? [{ value: 'new', label: 'A new topic' }, { value: 'none', label: 'No topic: the whole chapter' }] : []),
  ];
  // a fixed chapter with one topic has it chosen; an open chapter's choice is always the writer's
  const topic = !chapter ? '' : topics.some((t) => t.value === p.topic) ? p.topic : !isOpen(chapter) && chapter.topics.length === 1 ? topics[0].value : '';
  return { boards, classes, subjects, chapters, chapter, topics, place: { board, cls, subject, chapter: chapter?.chapter_id ?? '', topic, newName: p.newName } };
}

/**
 * Where the questions go, once everything is chosen; else null, with what is still to choose (or what is wrong with a
 * new topic's name). `newNo`: the number a new topic will get.
 */
export function whereOf(list: ListChapter[], p: Place): { where: Where | null; todo?: string; newNo?: number } {
  const o = options(list, p);
  const ch = o.chapter;
  if (!o.place.board || !o.place.cls || !o.place.subject) return { where: null, todo: 'Choose the board, class and subject.' };
  if (!ch) return { where: null, todo: 'Choose the chapter.' };
  const base = { chapter_id: ch.chapter_id, board: ch.board, class: ch.class, subject: ch.subject, chapter_no: ch.chapter_no, chapter: ch.name };
  const t = o.place.topic;
  if (!t) return { where: null, todo: 'Choose the topic.' };
  if (t === 'none') return { where: { ...base, topic_no: null, topic: '' } };
  if (t === 'new') {
    const n = newTopic(ch, p.newName);
    return n.problem ? { where: null, todo: n.problem, newNo: n.no } : { where: { ...base, topic_no: n.no, topic: n.name }, newNo: n.no };
  }
  const topic = ch.topics.find((x) => `t${x.topic_no}` === t)!;
  return { where: { ...base, topic_no: topic.topic_no, topic: topic.name } };
}

/** The place a question already sent was for ("Fix it" on a sent-back question). */
export function placeOf(list: ListChapter[], r: { chapter_id: string | null; topic_no: number | null; topic: string }): Place {
  const ch = list.find((c) => c.chapter_id === r.chapter_id);
  if (!ch) return NO_PLACE;
  const base = { board: ch.board, cls: String(ch.class), subject: ch.subject, chapter: ch.chapter_id, newName: '' };
  if (r.topic_no === null) return { ...base, topic: 'none' };
  if (ch.topics.some((t) => t.topic_no === r.topic_no)) return { ...base, topic: `t${r.topic_no}` };
  return { ...base, topic: 'new', newName: r.topic };
}
