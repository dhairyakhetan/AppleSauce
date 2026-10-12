/**
 * Fill in the blank: each question's fill-in sentence, with its blank (___) as a box to type in. Only questions whose
 * writer wrote that sentence are used (a Fill line, or a question that has the ___ itself): nothing is cut out of a
 * question or added to its end. A sentence that would still show the answer is not used. What a student types is
 * marked by answers.ts: right, almost (a spelling slip, half a point) or wrong.
 */
import { BLANK, blanks, fillText, shows, shuffle, type Item } from './shared';

export const FILL = { min: 1, max: 10 } as const;

export interface FillRow { id: string; before: string; after: string; answer: string; also: string[] }
export interface FillIn { type: 'fill'; rows: FillRow[] }

function row(it: Item): FillRow | null {
  const text = fillText(it);
  if (!text || shows(text.replace(BLANK, ' '), it)) return null;
  const [before, after] = text.split(BLANK);
  return { id: it.id, before, after, answer: it.answer, also: [...(it.also ?? [])] };
}

export function makeFill(items: Item[], r: () => number): FillIn | null {
  const rows: FillRow[] = [];
  for (const it of shuffle(items, r)) {
    if (rows.length === FILL.max) break;
    const x = row(it);
    if (x) rows.push(x);
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
    if (x.answer !== it.answer || x.also.join('\u0000') !== (it.also ?? []).join('\u0000')) out.push(`question ${x.id} has the wrong answers`);
    const text = it.fill && blanks(it.fill) === 1 ? it.fill : it.question;
    const at = text.search(BLANK);
    const gap = text.match(BLANK)?.[0] ?? '';
    // the sentence exactly as written, with only its one blank as the box
    if (blanks(text) !== 1 || text.slice(0, at) !== x.before || text.slice(at + gap.length) !== x.after) out.push(`question ${x.id} is not its fill-in sentence`);
    if (blanks(x.before + x.after)) out.push(`question ${x.id} has more than one blank`);
    if (shows(`${x.before} ${x.after}`, it)) out.push(`question ${x.id} shows its own answer`);
  }
  return out;
}
