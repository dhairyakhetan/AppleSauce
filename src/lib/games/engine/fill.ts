/**
 * Fill in the blank: each question is shown with one gap, and the student types the answer.
 * Where the gap goes:
 *   "given" - the question already has ___ in it;
 *   "found" - the answer appears in the question as whole words, exactly once: it is cut out;
 *   "end"   - otherwise the gap goes after the question ("SI unit of force? ____").
 * A question that would still show its own answer is not used.
 */
import { loose, shuffle, type Item } from './shared';

export const FILL = { min: 1, max: 10 } as const;

export interface FillRow { id: string; before: string; after: string; answer: string; mode: 'given' | 'found' | 'end' }
export interface FillIn { type: 'fill'; rows: FillRow[] }

const GAP = /_{2,}/g;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whether the answer can be read in the text (as whole words, ignoring case, accents and punctuation). */
const shows = (text: string, answer: string) => ` ${loose(text)} `.includes(` ${loose(answer)} `);

function row(it: Item): FillRow | null {
  const q = it.question;
  const gaps = q.match(GAP) ?? [];
  let r: FillRow;
  if (gaps.length === 1) {
    const at = q.search(GAP);
    r = { id: it.id, before: q.slice(0, at), after: q.slice(at + gaps[0].length), answer: it.answer, mode: 'given' };
  } else if (gaps.length > 1) {
    return null; // two gaps for one answer
  } else {
    const word = new RegExp(`(?<![\\p{L}\\p{N}])${escape(it.answer.trim())}(?![\\p{L}\\p{N}])`, 'giu');
    const hits = [...q.matchAll(word)];
    if (hits.length === 1) {
      const at = hits[0].index!;
      r = { id: it.id, before: q.slice(0, at), after: q.slice(at + hits[0][0].length), answer: it.answer, mode: 'found' };
    } else {
      r = { id: it.id, before: `${q.trimEnd()} `, after: '', answer: it.answer, mode: 'end' };
    }
  }
  return shows(r.before + ' ' + r.after, r.answer) ? null : r;
}

export function makeFill(items: Item[], r: () => number): FillIn | null {
  const rows: FillRow[] = [];
  for (const it of shuffle(items, r)) {
    if (rows.length === FILL.max) break;
    const x = row(it);
    if (x && loose(x.answer)) rows.push(x);
  }
  return rows.length >= FILL.min ? { type: 'fill', rows } : null;
}

/** Everything wrong with a fill-in-the-blank game; empty when it is correct. Written separately from the maker on purpose. */
export function checkFill(g: FillIn, items: Item[]): string[] {
  const out: string[] = [];
  const byId = new Map(items.map((it) => [it.id, it]));
  if (g.rows.length < FILL.min || g.rows.length > FILL.max) out.push(`has ${g.rows.length} questions, needs ${FILL.min} to ${FILL.max}`);
  if (new Set(g.rows.map((x) => x.id)).size !== g.rows.length) out.push('a question appears twice');
  for (const x of g.rows) {
    const it = byId.get(x.id);
    if (!it) { out.push(`question ${x.id} is not in the bank`); continue; }
    if (x.answer !== it.answer || !loose(x.answer)) out.push(`question ${x.id} has the wrong answer`);
    const q = it.question;
    if (x.mode === 'end') {
      if (x.before !== `${q.trimEnd()} ` || x.after !== '') out.push(`question ${x.id} is not the bank's text`);
    } else {
      // the text around the gap must be the question exactly, with only the gap (or the answer) cut out
      if (!q.startsWith(x.before) || !q.endsWith(x.after) || x.before.length + x.after.length > q.length) {
        out.push(`question ${x.id} is not the bank's text`);
        continue;
      }
      const cut = q.slice(x.before.length, q.length - x.after.length);
      if (x.mode === 'given' && !/^_{2,}$/.test(cut)) out.push(`question ${x.id}: the gap is not where ___ was`);
      if (x.mode === 'found' && loose(cut) !== loose(x.answer)) out.push(`question ${x.id}: the gap is not where the answer was`);
    }
    if (/_{2,}/.test(x.before + x.after)) out.push(`question ${x.id} has more than one gap`);
    if (shows(x.before + ' ' + x.after, x.answer)) out.push(`question ${x.id} shows its own answer`);
  }
  return out;
}
