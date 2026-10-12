/**
 * Whether a typed answer counts: right, almost (a small spelling slip, worth half a point), or wrong. Used wherever a
 * student types an answer (fill in the blank). Written for every subject, not only science: names, places, dates,
 * numbers and fractions, units, short forms, and answers in Hindi, Bengali or any other script.
 *
 * What a student may leave out and still be right:
 *   - words in square brackets: "Decomposition [reaction]", "[Jawaharlal] Nehru", "[x =] 5";
 *   - words the question already says: "Reaction in which a compound breaks down" → "Decomposition" for
 *     "Decomposition reaction"; a connecting word left at the edge goes too ("Battle of Plassey" → "Plassey");
 *   - a, an, the;
 *   - a title before a name: Lord, Sir, Dr, Shri, Pandit, Mahatma, Raja... ("Lord Dalhousie" → "Dalhousie");
 *   - a unit given as a symbol: "90°" → "90" (and "90 degrees" counts), "50%" → "50".
 * What else counts:
 *   - the short form in brackets after an answer, on its own: "Central Processing Unit (CPU)" → "CPU" (unless the
 *     question itself says CPU);
 *   - the initials of an answer of three or more words, or of two capitalised ones: GDP for "Gross Domestic Product",
 *     RBC for "Red blood cell", UN for "United Nations" (unless the question says them); and the words of a short form
 *     in capitals: "Goods and Services Tax" for "GST";
 *   - case, spaces, hyphens, punctuation and Latin accents don't matter ("carbon-dioxide", "CarbonDioxide");
 *   - numbers by their value: 3/4 and 0.75, 1,00,000 and 100000, eight and 8, twenty-five and 25. -5 is not 5.
 * Almost: one letter wrong, missing, extra or swapped in an answer of 5 to 9 letters, two in 10 or more. Never for
 * numbers, never for shorter answers ("Ion" for "Iron"), and never when what was typed is another answer in the round.
 */
import { shownAnswer, splitAlt, unaccent } from './shared';

export type Mark = 'right' | 'almost' | 'wrong';

const ARTICLES = new Set(['a', 'an', 'the']);
/** Words that only join others: left at either end once other words are left out, they go too. */
const JOINERS = new Set(['a', 'an', 'the', 'of', 'and', 'in', 'on', 'at', 'to', 'for', 'by', 'with', 'from']);
/** Titles before a name. Not King, Queen or Emperor: "King cobra" and "Emperor penguin" aren't cobras and penguins. */
const TITLES = new Set(['lord', 'sir', 'dr', 'mr', 'mrs', 'ms', 'shri', 'sri', 'smt', 'pandit', 'mahatma', 'maharaja', 'raja', 'rani', 'guru', 'sultan', 'saint', 'st']);
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const TENS = new Map([['twenty', 20], ['thirty', 30], ['forty', 40], ['fifty', 50], ['sixty', 60], ['seventy', 70], ['eighty', 80], ['ninety', 90]]);
/** Leaving out more optional words than this is not tried (it would be thousands of ways). */
const MAX_OPTIONAL = 10;

/** A number (with a minus sign only at the start of a word), a word in any script, or a degree or percent sign. */
const TOKEN = /(?<![\p{L}\p{M}\p{N}])-?(?:\d+(?:,\d{2,3})*(?:\.\d+)?|\.\d+)(?:\s*\/\s*\d+)?|[\p{L}\p{M}\p{N}]+|[°%]/gu;

/** A number's value as text: "1,00,000" → 100000, "3/4" and ".75" → 0.75, "-0" → 0. */
function value(s: string): string {
  const [a, b] = s.replace(/,/g, '').split('/');
  const v = b === undefined ? Number(a) : Number(a) / Number(b);
  return Number.isFinite(v) ? String(Number(v.toFixed(6))) : s;
}

/** The words of a text, each in the one form they are compared in. */
function tokens(s: string): string[] {
  const raw = [...unaccent(s).toLowerCase().matchAll(TOKEN)].map((m) => m[0]);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    if (/^-?[\d.]/.test(t) && /\d/.test(t)) out.push(value(t));
    else if (t === 'degree' || t === 'degrees') out.push('°');
    else if (t === 'percent') out.push('%');
    else if (t === 'per' && raw[i + 1] === 'cent') { out.push('%'); i++; }
    else if (TENS.has(t)) {
      const u = ONES.indexOf(raw[i + 1]);
      if (u >= 1 && u <= 9) { out.push(String(TENS.get(t)! + u)); i++; } else out.push(String(TENS.get(t)));
    } else if (ONES.includes(t)) out.push(String(ONES.indexOf(t)));
    else out.push(t);
  }
  return out;
}

/** Whether the question already says this word (or its plural or singular). */
function said(t: string, question: Set<string>) {
  return question.has(t) || question.has(`${t}s`) || question.has(`${t}es`) || (t.endsWith('es') && question.has(t.slice(0, -2))) || (t.endsWith('s') && question.has(t.slice(0, -1)));
}

/** An answer as parts a student must or may type: a bracketed group is one part, every other word its own. */
function parts(text: string, question: Set<string>): { toks: string[]; optional: boolean; bracket: boolean }[] {
  const out: { toks: string[]; optional: boolean; bracket: boolean }[] = [];
  for (const piece of text.split(/(\[[^\]]*\])/)) {
    if (piece.startsWith('[') && piece.endsWith(']')) {
      const t = tokens(piece.slice(1, -1));
      if (t.length) out.push({ toks: t, optional: true, bracket: true });
    } else {
      for (const t of tokens(piece)) out.push({ toks: [t], optional: ARTICLES.has(t) || t === '°' || t === '%' || said(t, question), bracket: false });
    }
  }
  if (out.length >= 2 && !out[0].bracket && TITLES.has(out[0].toks[0])) out[0].optional = true;
  // something must be left to type: if everything was optional, the words the question says count after all
  if (!out.some((p) => !p.optional)) for (const p of out) if (!p.bracket && !ARTICLES.has(p.toks[0]) && p.toks[0] !== '°' && p.toks[0] !== '%') p.optional = false;
  if (!out.some((p) => !p.optional)) for (const p of out) p.optional = false;
  return out;
}

const isNumber = (t: string) => /^-?[\d.]+$/.test(t);
/** Words run together ("carbon dioxide" = "carbondioxide"), but two numbers stay apart: "3 4" is not 34. */
const compact = (ts: string[]) => ts.map((t, i) => (i && isNumber(t) && isNumber(ts[i - 1]) ? `|${t}` : t)).join('');

const trimJoiners = (ts: string[]) => {
  let a = 0;
  let b = ts.length;
  while (a < b && JOINERS.has(ts[a])) a++;
  while (b > a && JOINERS.has(ts[b - 1])) b--;
  return ts.slice(a, b);
};

/** Every way of writing this text that counts, as compact strings (words run together). */
function waysOf(text: string, question: Set<string>, into: Set<string>) {
  const ps = parts(text, question);
  const optional = ps.map((p, i) => (p.optional ? i : -1)).filter((i) => i >= 0).slice(0, MAX_OPTIONAL);
  for (let mask = 0; mask < 1 << optional.length; mask++) {
    const drop = new Set(optional.filter((_, bit) => mask & (1 << bit)));
    const kept = ps.filter((_, i) => !drop.has(i)).flatMap((p) => p.toks);
    for (const ts of [kept, trimJoiners(kept)]) if (ts.length) into.add(compact(ts));
  }
}

/** The words that start a short form: Latin words, without the joining ones. Null if the text isn't like that. */
function initialWords(text: string): string[] | null {
  const ts = tokens(text.replace(/[[\]]/g, ' '));
  if (!ts.length || !ts.every((t) => /^[a-z]+$/.test(t))) return null;
  return ts.filter((t) => !JOINERS.has(t));
}

/**
 * The short form of an answer, from its initials: "Gross Domestic Product" → GDP, "Red blood cell" → RBC, "Goods and
 * Services Tax" → GST. Only for three or more words, or two that are both capitalised ("United Nations" → UN, but not
 * "Balanced equation" → BE).
 */
function initials(text: string): string | null {
  const words = initialWords(text);
  if (!words || words.length < 2 || words.length > 8) return null;
  const capitalised = text.replace(/\[[^\]]*\]/g, ' ').split(/\s+/).filter((w) => /^\p{L}/u.test(w) && !JOINERS.has(w.toLowerCase())).every((w) => /^\p{Lu}/u.test(w));
  return words.length >= 3 || capitalised ? words.map((w) => w[0]).join('') : null;
}

/** Every typed form that counts as right for this answer. */
export function rightForms(answer: string, question = ''): Set<string> {
  const q = new Set(tokens(question));
  const { main, alt } = splitAlt(answer);
  const out = new Set<string>();
  waysOf(answer, q, out);
  if (alt) {
    // the short form or the main answer on its own, unless the question already gives it away
    for (const one of [main, alt]) if (!tokens(one).every((t) => q.has(t))) waysOf(one, q, out);
  }
  // the initials, unless the question already says them ("What is the full form of GDP?")
  const short = initials(main);
  if (short && !q.has(short)) out.add(short);
  return out;
}

/** An answer that is a short form in capitals (CPU, GST, UN): the words it stands for count too. */
function expands(typed: string, answer: string): boolean {
  const { main } = splitAlt(shownAnswer(answer));
  if (!/^[A-Z]{2,8}$/.test(main.trim())) return false;
  const words = initialWords(typed);
  return !!words && words.length >= 2 && words.map((w) => w[0]).join('') === main.trim().toLowerCase();
}

/** What was typed, compact; and without a leading a, an or the. */
function typedForms(typed: string): string[] {
  const t = tokens(typed);
  const out = t.length ? [compact(t)] : [];
  if (t.length > 1 && ARTICLES.has(t[0])) out.push(compact(t.slice(1)));
  return out;
}

/** Optimal string alignment distance: letters wrong, missing, extra, or two swapped. */
function distance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  const d = Array.from({ length: x.length + 1 }, (_, i) => Array.from({ length: y.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && x[i - 1] === y[j - 2] && x[i - 2] === y[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[x.length][y.length];
}

/** A small spelling slip: never in a number, never in a short answer. */
function slip(typed: string, form: string): boolean {
  if (/\d/.test(form)) return false;
  const n = [...form].length;
  const allowed = n >= 10 ? 2 : n >= 5 ? 1 : 0;
  return allowed > 0 && Math.abs([...typed].length - n) <= allowed && distance(typed, form) <= allowed;
}

/**
 * Right, almost or wrong. `question` is the text the student sees (its words may be left out of the answer); `others`
 * are the round's other answers (typing one of them is wrong, not a slip).
 */
export function mark(typed: string, answer: string, { question = '', others = [] }: { question?: string; others?: string[] } = {}): Mark {
  const t = typedForms(typed);
  if (!t.length) return 'wrong';
  const forms = rightForms(answer, question);
  if (t.some((x) => forms.has(x)) || expands(typed, answer)) return 'right';
  if (others.some((o) => o !== answer && t.some((x) => rightForms(o).has(x)))) return 'wrong';
  for (const f of forms) if (t.some((x) => slip(x, f))) return 'almost';
  return 'wrong';
}

/** Whether a typed answer counts as right. "law of conservation of MASS." matches "Law of conservation of mass". */
export const sameAnswer = (typed: string, answer: string, question = '') => mark(typed, answer, { question }) === 'right';
