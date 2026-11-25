/**
 * The autocorrect in the Questions box: small, sure fixes the page makes by itself a moment after typing stops, so
 * nobody has to retype what the checker would only complain about. It never changes the words of a question, an
 * answer, a Fill sentence or an option: only labels, detail lines, Topic lines, the separators in a Wrong line and
 * blank lines.
 *
 * - Board, Class and Subject the site's way: "cBsE" → CBSE, "cbsu" → CBSE, "maths" → Mathematics, "X" → 10.
 * - Chapter and Topic lines in the list's wording, when the number or the name makes it clear which one is meant
 *   ("Chapter 4: heat" → "Chapter 4: Heat", "Topic: Transfer of heat" → "Topic 2: Transfer of Heat").
 * - Labels with a capital and no number: "q:" → "Q:", "Q1:" → "Q:", "wrong:" → "Wrong:".
 * - A level in lower case: "Level: Easy." → "Level: easy".
 * - A Wrong line with commas and no ";": "Wrong: a, b, c" → "Wrong: a; b; c" (not "1,000, 2,000, 3,000").
 * - A blank line before each Q: line.
 * - The four chapter lines back at the top if they were deleted, once the writer has moved below them (or left the
 *   box), so they never vanish from under the caret.
 *
 * The line the caret is on is left alone apart from changes that keep its length ("cbsu" → "CBSE"), so typing is never
 * interrupted; the rest of its fixes happen once the writer moves on.
 *
 * Pure: the page passes the text, the caret and the list, and puts back what comes out.
 */
import { isOpen, sameName } from './catalog';
import { DETAIL_KEYS, LABEL, checkBoard, checkClass, checkSubject, distance, fixDetail, parseNumbered, readMeta, writeDetail, type DetailKey } from './details';
import type { ListChapter } from './rows';

const LEVELS = new Set(['easy', 'medium', 'hard']);
const QUESTION_LABEL = /^(\s*)(q|a|also|fill|wrong|level)(\s*\d+)?\s*:\s*/i;
const CANON: Record<string, string> = { q: 'Q', a: 'A', also: 'Also', fill: 'Fill', wrong: 'Wrong', level: 'Level' };
const FENCE = /^\s*(```|~~~)/;

/** Close enough to be the same name with a slip: a letter or two in a short name, a little more in a long one. */
const close = (a: string, b: string) => {
  if (sameName(a, b)) return true;
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  return x.length >= 4 && distance(x, y) <= Math.max(1, Math.floor(y.length / 8));
};

/** One name from a list, if exactly one is the same or close. */
function onlyMatch<T>(items: T[], name: (t: T) => string, written: string): T | undefined {
  const same = items.filter((t) => sameName(name(t), written));
  if (same.length === 1) return same[0];
  if (same.length > 1) return undefined;
  const near = items.filter((t) => close(written, name(t)));
  return near.length === 1 ? near[0] : undefined;
}

interface Context { board: string; cls: number | null; subject: string; chapter?: ListChapter }

/** The fixes for one line, or the line as it was. `ctx` is what the lines above set, and is updated. */
function fixLine(line: string, ctx: Context, list: ListChapter[]): string {
  const meta = readMeta(line);
  if (meta && (meta.key === 'board' || meta.key === 'class' || meta.key === 'subject')) {
    const k = meta.key;
    const fixed = fixDetail(k, meta.value);
    const v = fixed ?? meta.value.trim();
    if (k === 'board') ctx.board = checkBoard(v).name;
    if (k === 'class') ctx.cls = checkClass(v).value;
    if (k === 'subject') ctx.subject = checkSubject(v).name;
    ctx.chapter = undefined;
    return fixed ? `${LABEL[k]}: ${fixed}` : line;
  }
  if (meta?.key === 'chapter') {
    const { no, name } = parseNumbered(meta.value, 'chapter');
    const here = list.filter((c) => c.board === ctx.board && c.class === ctx.cls && c.subject === ctx.subject);
    const byNo = no !== null ? here.find((c) => c.chapter_no === no) : undefined;
    const ch = byNo && (!name || close(name, byNo.name)) ? byNo : no === null && name ? onlyMatch(here, (c) => c.name, name) : undefined;
    ctx.chapter = ch ?? byNo;
    return ch ? `Chapter ${ch.chapter_no}: ${ch.name}` : line;
  }
  if (meta?.key === 'topic') {
    const ch = ctx.chapter;
    if (!ch || isOpen(ch)) return line;
    const { no, name } = parseNumbered(meta.value, 'topic');
    const byNo = no !== null ? ch.topics.find((t) => t.topic_no === no) : undefined;
    const t = byNo && (!name || close(name, byNo.name)) ? byNo : name ? onlyMatch(ch.topics, (x) => x.name, name) : undefined;
    return t ? `Topic ${t.topic_no}: ${t.name}` : line;
  }
  const m = line.match(QUESTION_LABEL);
  if (!m) return line;
  const label = CANON[m[2].toLowerCase()];
  // a number after a label is only a question's number ("Q1:"); "A1:" is left for the checker to explain
  if (m[3] && label !== 'Q') return line;
  let rest = line.slice(m[0].length);
  if (label === 'Level') {
    const l = rest.trim().replace(/[.!]+$/, '').toLowerCase();
    if (LEVELS.has(l)) rest = l;
  }
  if (label === 'Wrong' && !rest.includes(';') && (rest.match(/,/g) ?? []).length >= 2 && !/\d,\d/.test(rest)) {
    rest = rest.split(',').map((o) => o.trim()).filter(Boolean).join('; ');
  }
  return `${m[1]}${label}: ${rest}`;
}

/** Fixes on the caret's line that keep its length, so the caret stays put: a capital, "cbsu" → "CBSE". */
const sameLength = (before: string, after: string) => (after.length === before.length ? after : before);

export interface TidyResult { text: string; caret: number | null }

/**
 * The text with its sure fixes made. `caret` is where the caret is (null when the box isn't being typed in); the
 * result says where it goes. `keep` is the last chapter lines the text had, put back at the top if they are gone.
 */
export function tidyText(text: string, opts: { list: ListChapter[]; caret: number | null; keep?: Partial<Record<DetailKey, string>> }): TidyResult {
  const lines = text.split('\n');
  let caretLine = -1;
  let caretCol = 0;
  if (opts.caret !== null) {
    const before = text.slice(0, opts.caret).split('\n');
    caretLine = before.length - 1;
    caretCol = before[before.length - 1].length;
  }

  const out: string[] = [];
  const ctx: Context = { board: '', cls: null, subject: '' };
  let fence = false;
  let newCaretLine = -1;
  lines.forEach((line, i) => {
    if (FENCE.test(line)) { fence = !fence; out.push(line); if (i === caretLine) newCaretLine = out.length - 1; return; }
    let fixed = fixLine(line, ctx, opts.list);
    const isCaret = i === caretLine;
    if (isCaret) fixed = sameLength(line, fixed);
    // a blank line before each question (not on the caret's line: it waits until the writer moves on)
    if (!isCaret && /^\s*Q:/.test(fixed) && out.length && out[out.length - 1].trim() && !FENCE.test(out[out.length - 1])) out.push('');
    out.push(fixed);
    if (isCaret) newCaretLine = out.length - 1;
  });
  let result = out.join('\n');

  // the four chapter lines back at the top, once the caret is below them or the box was left
  const keep = opts.keep ?? {};
  const has = new Set(out.map((l) => readMeta(l)?.key));
  const gone = DETAIL_KEYS.filter((k) => !has.has(k) && keep[k]?.trim());
  if (gone.length) {
    const firstOther = out.findIndex((l) => l.trim() && !(readMeta(l)?.key && (DETAIL_KEYS as string[]).includes(readMeta(l)!.key)));
    const movedOn = firstOther >= 0 && (newCaretLine < 0 || newCaretLine >= firstOther);
    if (movedOn) {
      for (const k of gone) result = writeDetail(result, k, keep[k]!);
      // the lines go in above the caret's line, so it moves down by as many
      if (newCaretLine >= 0) newCaretLine += result.split('\n').length - out.length;
    }
  }
  return { text: result, caret: newCaretLine < 0 ? null : offsetOf(result, newCaretLine, caretCol) };
}

function offsetOf(text: string, line: number, col: number): number {
  const lines = text.split('\n');
  let at = 0;
  for (let i = 0; i < line; i++) at += lines[i].length + 1;
  return at + Math.min(col, lines[line]?.length ?? 0);
}
