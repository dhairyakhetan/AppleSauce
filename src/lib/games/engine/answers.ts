/**
 * Whether a typed answer counts: right, almost (a spelling slip, worth half a point) or wrong. Used wherever a student
 * types an answer (fill in the blank).
 *
 * Strict on purpose: the writer decides what counts, by writing the answer and every other accepted answer (Also
 * lines). Nothing is guessed from the question, and there are no lists of synonyms, units or titles here.
 *
 * Right: what was typed is the answer or one of the other accepted answers, where these don't matter:
 *   - case, spaces, and the punctuation . , ; : ! ? ' " - _ ( ) [ ] { } between words ("carbon-dioxide" = "Carbon
 *     dioxide"); Latin accents (Café = Cafe); the kind of dash or quote (− – - are the same);
 *   - a, an or the at the start;
 *   - commas between groups of digits (1,00,000 = 100000).
 * Inside numbers everything counts: 3.5 is not 35, -5 is not 5, 3 4 is not 34, and 0.5 is not 1/2. Symbols such as + =
 * % ° ^ / count too.
 * Almost (half a point): one letter missing, one extra, or two next to each other swapped, in one word of five letters
 * or more, with every other word right ("Photosynthsis", "Mitochondira"). Never a letter changed for another ("Alkene"
 * for Alkane, "Endothermic" for Exothermic), never the first letter, never in numbers or Roman numerals, and never when
 * what was typed is another answer in the same round.
 */
import { answersOf, unaccent, type Item } from './shared';

export type Mark = 'right' | 'almost' | 'wrong';

const DASHES = /[‐-―−﹘﹣－]/g;
const ARTICLES = new Set(['a', 'an', 'the']);
/**
 * A number (with a minus sign only where a word starts), a word in any script, or one symbol. Punctuation that only
 * separates words is not a token.
 */
const TOKEN = /(?<![\p{L}\p{M}\p{N}])-?\d+(?:,\d{2,3})*(?:[.:/]\d+)*|\d+(?:,\d{2,3})*(?:[.:/]\d+)*|[\p{L}\p{M}\p{N}]+|[^\s\p{L}\p{M}\p{N}.,;:!?'"`\-_()[\]{}]/gu;
const isNum = (t: string) => /^-?\d/.test(t);

/** The parts of a text, each as it is compared. */
function tokens(s: string): string[] {
  const t = unaccent(s.normalize('NFC')).toLowerCase().replace(DASHES, '-').replace(/[‘’ʼ´]/g, "'").replace(/[“”]/g, '"');
  return [...t.matchAll(TOKEN)].map((m) => (isNum(m[0]) ? m[0].replace(/(\d),(?=\d)/g, '$1') : m[0]));
}

/** Parts run together ("carbon dioxide" = "carbondioxide"), but two numbers stay apart: "3 4" is not 34. */
const join = (ts: string[]) => ts.map((t, i) => (i && isNum(t) && isNum(ts[i - 1]) ? `|${t}` : t)).join('');

/** The ways a text is compared: as written, and without a, an or the at the start. */
function keys(s: string): string[] {
  const ts = tokens(s);
  if (!ts.length) return [];
  return ts.length > 1 && ARTICLES.has(ts[0]) ? [join(ts), join(ts.slice(1))] : [join(ts)];
}

/** Whether two texts count as the same answer. */
export const sameAnswer = (a: string, b: string) => {
  const kb = new Set(keys(b));
  return keys(a).some((k) => kb.has(k));
};

/** Whether a text has anything to compare (a letter, a digit or a symbol). */
export const hasContent = (s: string) => tokens(s).length > 0;

/** One letter missing, one extra, or two next to each other swapped. Not a letter changed for another. */
function oneSlip(t: string[], f: string[]): boolean {
  if (t.length === f.length) {
    const d = t.map((c, i) => (c !== f[i] ? i : -1)).filter((i) => i >= 0);
    return d.length === 2 && d[1] === d[0] + 1 && t[d[0]] === f[d[1]] && t[d[1]] === f[d[0]];
  }
  const [long, short] = t.length > f.length ? [t, f] : [f, t];
  if (long.length !== short.length + 1) return false;
  let i = 0;
  while (i < short.length && long[i] === short[i]) i++;
  return long.slice(i + 1).join('') === short.slice(i).join('');
}

/** A spelling slip in one word of five letters or more, with every other word right. */
function slip(typed: string, form: string): boolean {
  const strip = (ts: string[]) => (ts.length > 1 && ARTICLES.has(ts[0]) ? ts.slice(1) : ts);
  const t = strip(tokens(typed));
  const f = strip(tokens(form));
  if (t.length !== f.length) return false;
  const diff = t.map((w, i) => (w !== f[i] ? i : -1)).filter((i) => i >= 0);
  if (diff.length !== 1) return false;
  const tw = [...t[diff[0]]];
  const fw = [...f[diff[0]]];
  const word = /^[\p{L}\p{M}]+$/u;
  return word.test(t[diff[0]]) && word.test(f[diff[0]]) && fw.length >= 5 && !/^[ivxlcdm]+$/.test(f[diff[0]]) && tw[0] === fw[0] && oneSlip(tw, fw);
}

/**
 * Right, almost or wrong. `others`: the round's other questions (typing one of their answers is wrong, not a slip).
 */
export function mark(typed: string, it: Pick<Item, 'answer' | 'also'>, others: readonly Pick<Item, 'answer' | 'also'>[] = []): Mark {
  const t = keys(typed);
  if (!t.length) return 'wrong';
  const right = new Set(answersOf(it).flatMap(keys));
  if (t.some((k) => right.has(k))) return 'right';
  const elsewhere = new Set(others.flatMap((o) => answersOf(o).flatMap(keys)));
  if (t.some((k) => elsewhere.has(k))) return 'wrong';
  return answersOf(it).some((f) => slip(typed, f)) ? 'almost' : 'wrong';
}
