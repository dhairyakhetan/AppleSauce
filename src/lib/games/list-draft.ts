/**
 * The Chapters page's unsaved changes to one board, class and subject (a group): a draft of its chapters and topics,
 * edited on the page and saved all at once (api.saveChapters, games.admin_save_chapters). Each edit is checked here the
 * way the database checks it, so a refusal shows where the edit was made. What changed is worked out against the list as
 * it was loaded, so an edit undone by hand is no longer a change.
 *
 * Pure: every edit gives back a new draft, or throws an Error whose message is what the page shows.
 */
import { sameName } from './catalog';
import { checkBoard, checkClass, checkSubject } from './details';
import type { AdminChapter, ChapterToSave, ListGroup, ListSave, SavedChapter } from './rows';

export interface DraftTopic {
  /** Stays the same while editing: `t3` for the loaded topic 3, `n1` for a new one. */
  key: string;
  /** Its number as loaded; null for a new topic. */
  was: number | null;
  topic_no: number;
  name: string;
  /** Questions sent for it, as loaded (of any status). While it has any, its number stays and it can't be deleted. */
  questions: number;
  deleted: boolean;
  /** As loaded; null for a new topic. */
  orig: { topic_no: number; name: string } | null;
}

export interface DraftChapter {
  /** Stays the same while editing: its chapter ID as loaded, or `new1` for a new one. */
  key: string;
  /** Its chapter ID as loaded; null for a new chapter. */
  was: string | null;
  chapter_no: number;
  name: string;
  /** Writers may add their own topics. A chapter with no topics is open whatever this says (isOpen). */
  open: boolean;
  /** Questions sent for it, as loaded (of any status). While it has any, its number stays and it can't be deleted. */
  questions: number;
  /** Of those, the ones under no topic (an open chapter's questions may have none). */
  untopiced: number;
  deleted: boolean;
  topics: DraftTopic[];
  /** As loaded; null for a new chapter. */
  orig: { chapter_no: number; name: string; open: boolean } | null;
}

const DASH = /[–—]/;
const many = (n: number) => (n === 1 ? '1 question' : `${n} questions`);
const byNumber = <T extends { chapter_no?: number; topic_no?: number }>(a: T, b: T) =>
  (a.chapter_no ?? a.topic_no ?? 0) - (b.chapter_no ?? b.topic_no ?? 0);

/** A group's chapters on the list, in order. */
export const chaptersOf = (list: AdminChapter[], g: ListGroup) =>
  list.filter((c) => c.board === g.board && c.class === g.class && c.subject === g.subject).sort(byNumber);

/** The draft of a group as loaded: nothing changed yet. */
export function draftOf(chapters: AdminChapter[]): DraftChapter[] {
  return [...chapters].sort(byNumber).map((c) => ({
    key: c.chapter_id, was: c.chapter_id, chapter_no: c.chapter_no, name: c.name, open: c.open, questions: c.questions,
    untopiced: c.questions - c.topics.reduce((n, t) => n + t.questions, 0), deleted: false,
    orig: { chapter_no: c.chapter_no, name: c.name, open: c.open },
    topics: [...c.topics].sort(byNumber).map((t) => ({
      key: `t${t.topic_no}`, was: t.topic_no, topic_no: t.topic_no, name: t.name, questions: t.questions, deleted: false,
      orig: { topic_no: t.topic_no, name: t.name },
    })),
  }));
}

/** Topics still in the chapter (not marked to be deleted), in order. */
export const liveTopics = (c: DraftChapter) => c.topics.filter((t) => !t.deleted).sort(byNumber);
/** Writers may add their own topics: the admin opened them, or the chapter has none. */
export const isOpen = (c: DraftChapter) => c.open || !liveTopics(c).length;
/** The number to suggest for a new chapter or topic: one after the highest in use. */
export const nextNumber = (items: { topic_no?: number; chapter_no?: number; deleted: boolean }[]) =>
  Math.min(99, Math.max(0, ...items.filter((x) => !x.deleted).map((x) => x.chapter_no ?? x.topic_no ?? 0)) + 1);

// ---------------------------------------------------------------- checks

function checkName(name: string): string {
  const nm = name.trim();
  if (!nm || nm.length > 120) throw new Error('A name needs 1 to 120 characters.');
  if (DASH.test(nm)) throw new Error('No dashes in a name: use a colon or a comma.');
  return nm;
}
function checkNumber(no: number): number {
  if (!Number.isInteger(no) || no < 1 || no > 99) throw new Error('A number must be from 1 to 99.');
  return no;
}
const chapterAt = (d: DraftChapter[], key: string) => {
  const c = d.find((x) => x.key === key);
  if (!c) throw new Error("That chapter isn't in the list any more.");
  return c;
};
const topicAt = (c: DraftChapter, key: string) => {
  const t = c.topics.find((x) => x.key === key);
  if (!t) throw new Error("That topic isn't in the chapter any more.");
  return t;
};
const freeName = (others: { name: string; deleted: boolean; key: string }[], key: string, nm: string, what: (o: { name: string }) => string) => {
  const twin = others.find((o) => o.key !== key && !o.deleted && sameName(o.name, nm));
  if (twin) throw new Error(what(twin));
};
const putChapter = (d: DraftChapter[], c: DraftChapter) => d.map((x) => (x.key === c.key ? c : x)).sort(byNumber);
const putTopic = (d: DraftChapter[], c: DraftChapter, t: DraftTopic) =>
  putChapter(d, { ...c, topics: c.topics.map((x) => (x.key === t.key ? t : x)).sort(byNumber) });

// ---------------------------------------------------------------- chapters

export function addChapter(d: DraftChapter[], no: number, name: string): DraftChapter[] {
  const n = checkNumber(no);
  const nm = checkName(name);
  const taken = d.find((c) => !c.deleted && c.chapter_no === n);
  if (taken) throw new Error(`Chapter ${n} is "${taken.name}". Give the new one another number.`);
  freeName(d, '', nm, (o) => `There is already a chapter called "${o.name}".`);
  const key = `new${Math.max(0, ...d.filter((c) => !c.was).map((c) => Number(c.key.slice(3)))) + 1}`;
  return [...d, { key, was: null, chapter_no: n, name: nm, open: true, questions: 0, untopiced: 0, deleted: false, topics: [], orig: null }].sort(byNumber);
}

export function renameChapter(d: DraftChapter[], key: string, name: string): DraftChapter[] {
  const c = chapterAt(d, key);
  const nm = checkName(name);
  freeName(d, key, nm, (o) => `There is already a chapter called "${o.name}".`);
  return putChapter(d, { ...c, name: nm });
}

export function renumberChapter(d: DraftChapter[], key: string, no: number): DraftChapter[] {
  const c = chapterAt(d, key);
  const n = checkNumber(no);
  if (n === c.chapter_no) return d;
  if (c.questions) throw new Error(`It has ${many(c.questions)}, so its number stays: the number is part of each question's ID.`);
  const taken = d.find((x) => x.key !== key && !x.deleted && x.chapter_no === n);
  if (taken) throw new Error(`Chapter ${n} is "${taken.name}". Give that one another number first.`);
  return putChapter(d, { ...c, chapter_no: n });
}

/** A new chapter goes at once; one that was loaded is marked, and stays in the list until saved (or kept). */
export function deleteChapter(d: DraftChapter[], key: string): DraftChapter[] {
  const c = chapterAt(d, key);
  if (c.questions) throw new Error(`It has ${many(c.questions)}, so it can't be deleted. Rename it instead.`);
  return c.was ? putChapter(d, { ...c, deleted: true }) : d.filter((x) => x.key !== key);
}

/** Takes back a delete, if its number and name are still free. */
export function keepChapter(d: DraftChapter[], key: string): DraftChapter[] {
  const c = chapterAt(d, key);
  const taken = d.find((x) => x.key !== key && !x.deleted && x.chapter_no === c.chapter_no);
  if (taken) throw new Error(`Chapter ${c.chapter_no} is now "${taken.name}". Give that one another number first.`);
  freeName(d, key, c.name, (o) => `There is now another chapter called "${o.name}". Rename that one first.`);
  return putChapter(d, { ...c, deleted: false });
}

/** Opens a chapter's topics (writers may add their own) or fixes them (questions go only under these). */
export function setOpen(d: DraftChapter[], key: string, open: boolean): DraftChapter[] {
  const c = chapterAt(d, key);
  if (!open && !liveTopics(c).length) throw new Error('Add its topics first, then fix them.');
  return putChapter(d, { ...c, open });
}

// ---------------------------------------------------------------- topics

export function addTopic(d: DraftChapter[], chapterKey: string, no: number, name: string): DraftChapter[] {
  const c = chapterAt(d, chapterKey);
  const n = checkNumber(no);
  const nm = checkName(name);
  const taken = c.topics.find((t) => !t.deleted && t.topic_no === n);
  if (taken) throw new Error(`Topic ${n} is "${taken.name}". Give the new one another number.`);
  freeName(c.topics, '', nm, (o) => `This chapter already has a topic called "${o.name}".`);
  const key = `n${Math.max(0, ...c.topics.filter((t) => t.was === null).map((t) => Number(t.key.slice(1)))) + 1}`;
  return putChapter(d, { ...c, topics: [...c.topics, { key, was: null, topic_no: n, name: nm, questions: 0, deleted: false, orig: null }].sort(byNumber) });
}

export function renameTopic(d: DraftChapter[], chapterKey: string, key: string, name: string): DraftChapter[] {
  const c = chapterAt(d, chapterKey);
  const t = topicAt(c, key);
  const nm = checkName(name);
  freeName(c.topics, key, nm, (o) => `This chapter already has a topic called "${o.name}".`);
  return putTopic(d, c, { ...t, name: nm });
}

export function renumberTopic(d: DraftChapter[], chapterKey: string, key: string, no: number): DraftChapter[] {
  const c = chapterAt(d, chapterKey);
  const t = topicAt(c, key);
  const n = checkNumber(no);
  if (n === t.topic_no) return d;
  if (t.questions) throw new Error(`It has ${many(t.questions)}, so its number stays: the number is part of each question's ID.`);
  const taken = c.topics.find((x) => x.key !== key && !x.deleted && x.topic_no === n);
  if (taken) throw new Error(`Topic ${n} is "${taken.name}". Give that one another number first.`);
  return putTopic(d, c, { ...t, topic_no: n });
}

export function deleteTopic(d: DraftChapter[], chapterKey: string, key: string): DraftChapter[] {
  const c = chapterAt(d, chapterKey);
  const t = topicAt(c, key);
  if (t.questions) throw new Error(`It has ${many(t.questions)}, so it can't be deleted. Rename it instead.`);
  return t.was === null ? putChapter(d, { ...c, topics: c.topics.filter((x) => x.key !== key) }) : putTopic(d, c, { ...t, deleted: true });
}

export function keepTopic(d: DraftChapter[], chapterKey: string, key: string): DraftChapter[] {
  const c = chapterAt(d, chapterKey);
  const t = topicAt(c, key);
  const taken = c.topics.find((x) => x.key !== key && !x.deleted && x.topic_no === t.topic_no);
  if (taken) throw new Error(`Topic ${t.topic_no} is now "${taken.name}". Give that one another number first.`);
  freeName(c.topics, key, t.name, (o) => `There is now another topic called "${o.name}". Rename that one first.`);
  return putTopic(d, c, { ...t, deleted: false });
}

// ---------------------------------------------------------------- Bulk add

/** One board, class and subject in a Bulk add: its draft with the new chapters and topics, from the list as loaded. */
export interface BulkGroup {
  group: ListGroup;
  loaded: AdminChapter[];
  draft: DraftChapter[];
  chapters: number;
  topics: number;
  /** Chapters (and topics) already on the list under that name, left as they are. */
  already: number;
}
export interface BulkProblem { line: number; text: string }

const BULK_HEAD = /^(board|class|subject)\s*:\s*(.*)$/i;

/**
 * Bulk add (the bottom of the Chapters page): chapters for any boards, classes and subjects, from lines of text. Board,
 * Class and Subject lines say where the chapters under them go, as in the Questions box (names read the same way: "icse",
 * "X", "Maths"). Then one chapter per line, "Heat" or with its number "4. Heat" (or "4:", "4)"), and lines starting with
 * "-" (or "*", "•") under a chapter for its topics, numbered from 1 unless they give their own. A chapter or topic
 * already there under that name is left as it is, and topics under such a chapter are added to it. Blank lines and a
 * code block's fences are skipped. Each is checked as if added on its own, and every problem is named on its line; the
 * page saves nothing while there is one.
 */
export function readBulk(text: string, list: AdminChapter[]): { groups: BulkGroup[]; problems: BulkProblem[] } {
  const groups = new Map<string, BulkGroup>();
  const problems: BulkProblem[] = [];
  const where = { board: '', class: 0, subject: '', bad: false };
  let at: BulkGroup | null = null;
  /** The chapter topic lines go under: its key, null before any, false after one that couldn't be added. */
  let current: string | null | false = null;

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    const say = (t: string) => problems.push({ line: i + 1, text: t });
    if (!line || line.startsWith('```')) return;
    const head = BULK_HEAD.exec(line);
    if (head) {
      const v = head[2].trim();
      const k = head[1].toLowerCase();
      const checked = k === 'board' ? checkBoard(v) : k === 'subject' ? checkSubject(v) : null;
      const cls = k === 'class' ? checkClass(v) : null;
      const ok = checked ? !!checked.code : cls!.value !== null && cls!.value >= 1 && cls!.value <= 12;
      if (!ok) say((checked ?? cls)!.problem?.text ?? `"${v}" isn't a ${k} on the site's list.`);
      if (k === 'board') where.board = ok ? checked!.name : '';
      if (k === 'subject') where.subject = ok ? checked!.name : '';
      if (k === 'class') where.class = ok ? cls!.value! : 0;
      where.bad = !ok;
      at = null;
      current = null;
      return;
    }
    if (where.bad) return; // the Board, Class or Subject line above already says what is wrong
    if (!where.board || !where.class || !where.subject) { say('Put Board, Class and Subject lines above the chapters.'); return; }
    if (!at) {
      const g = { board: where.board, class: where.class, subject: where.subject };
      const id = `${g.board}|${g.class}|${g.subject}`;
      if (!groups.has(id)) {
        const loaded = chaptersOf(list, g);
        groups.set(id, { group: g, loaded, draft: draftOf(loaded), chapters: 0, topics: 0, already: 0 });
      }
      at = groups.get(id)!;
    }
    const g = at;
    const topic = /^[-*•]\s*(.*)$/.exec(line);
    const body = (topic ? topic[1] : line).trim();
    const numbered = /^(\d{1,2})\s*[.:)]\s*(.+)$/.exec(body);
    const no = numbered ? Number(numbered[1]) : null;
    const name = (numbered ? numbered[2] : body).trim();
    try {
      if (topic) {
        if (current === false) return; // its chapter has a problem of its own
        if (!current) throw new Error('A topic needs its chapter on a line above it.');
        const ch = chapterAt(g.draft, current);
        const same = ch.topics.find((t) => !t.deleted && sameName(t.name, name));
        if (same && (no === null || same.topic_no === no)) { if (same.was !== null) g.already++; return; }
        g.draft = addTopic(g.draft, current, no ?? nextNumber(ch.topics), name);
        g.topics++;
      } else {
        const same = g.draft.find((c) => !c.deleted && sameName(c.name, name));
        if (same && (no === null || same.chapter_no === no)) { current = same.key; if (same.was) g.already++; return; }
        const n = no ?? nextNumber(g.draft);
        current = false;
        g.draft = addChapter(g.draft, n, name);
        current = g.draft.find((c) => !c.was && !c.deleted && c.chapter_no === n)!.key;
        g.chapters++;
      }
    } catch (e) {
      say((e as Error).message);
    }
  });
  return { groups: [...groups.values()], problems };
}

// ---------------------------------------------------------------- what changed

export interface Changed {
  added: boolean;
  deleted: boolean;
  /** The name it had, when it has another now. */
  renamed: string | null;
  /** The number it had, when it has another now. */
  renumbered: number | null;
}
export interface ChapterChanged extends Changed {
  /** Its topics were opened or fixed. */
  topics: 'opened' | 'fixed' | null;
}

export function topicChanged(t: DraftTopic): Changed {
  return {
    added: !t.orig, deleted: t.deleted,
    renamed: t.orig && t.orig.name !== t.name ? t.orig.name : null,
    renumbered: t.orig && t.orig.topic_no !== t.topic_no ? t.orig.topic_no : null,
  };
}

export function chapterChanged(c: DraftChapter): ChapterChanged {
  const open = isOpen(c);
  return {
    added: !c.orig, deleted: c.deleted,
    renamed: c.orig && c.orig.name !== c.name ? c.orig.name : null,
    renumbered: c.orig && c.orig.chapter_no !== c.chapter_no ? c.orig.chapter_no : null,
    topics: c.orig && !c.deleted && open !== c.orig.open && liveTopics(c).length ? (open ? 'opened' : 'fixed') : null,
  };
}

const counted = (x: Changed | ChapterChanged) =>
  x.added || x.deleted ? 1 : Number(x.renamed !== null) + Number(x.renumbered !== null) + Number('topics' in x && x.topics !== null);

/** How many changes the draft holds: each chapter or topic added or deleted, renamed, renumbered, and topics opened or fixed. */
export function changeCount(d: DraftChapter[]): number {
  let n = 0;
  for (const c of d) {
    n += counted(chapterChanged(c));
    if (c.deleted) continue;
    for (const t of c.topics) n += counted(topicChanged(t));
  }
  return n;
}

/** Whether anything under a loaded chapter changed (to mark a closed chapter that has changes inside; a new one is new whole). */
export const changedInside = (c: DraftChapter) => !c.deleted && c.orig !== null && c.topics.some((t) => counted(topicChanged(t)) > 0);

// ---------------------------------------------------------------- saving

/** What "Save changes" sends: the group as loaded (`before`, exactly as the database gives it), and as it is to be. */
export function toSave(g: ListGroup, loaded: AdminChapter[], d: DraftChapter[]): ListSave {
  const before: SavedChapter[] = [...loaded].sort(byNumber).map((c) => ({
    chapter_id: c.chapter_id, chapter_no: c.chapter_no, name: c.name, open: c.open,
    topics: [...c.topics].sort(byNumber).map((t) => ({ topic_no: t.topic_no, name: t.name })),
  }));
  const after: ChapterToSave[] = d.filter((c) => !c.deleted).sort(byNumber).map((c) => ({
    chapter_id: c.was, chapter_no: c.chapter_no, name: c.name, open: isOpen(c),
    topics: liveTopics(c).map((t) => ({ was: t.was, topic_no: t.topic_no, name: t.name })),
  }));
  return { board: g.board, class: g.class, subject: g.subject, before, after };
}
