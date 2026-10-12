/**
 * The rules every game shares: what a question is, which of its versions each game uses, and which answers can go in a
 * grid. Makers and checkers both use these, so they can never disagree about them.
 *
 * A question is written once, with every version the games need (supabase/games/install.sql, src/lib/games/format.ts):
 * the question, its answer, other accepted answers (`also`), the fill-in sentence with ___ where the answer goes
 * (`fill`), and wrong options for multiple choice (`wrong`). Nothing is guessed: a game uses a question only when the
 * version it needs was written.
 */

/** One question from the bank. `id` must be unique (the question's ID in the database). */
export interface Item {
  id: string;
  question: string;
  answer: string;
  /** Other answers that count as right, as the writer wrote them. */
  also?: readonly string[];
  /** The fill-in-the-blank version: a sentence with ___ where the answer goes. */
  fill?: string | null;
  /** Multiple choice: the wrong options, as the writer wrote them. */
  wrong?: readonly string[];
}

/**
 * Accents taken off Latin letters (Café → Cafe). Marks in other scripts are kept: in Devanagari or Bengali they are the
 * vowel signs, and taking them off would make different words the same.
 */
export const unaccent = (s: string) => s.normalize('NFKD').replace(/(?<=\p{Script=Latin})\p{M}+/gu, '').normalize('NFC');

/** Text for comparing on screen: case, Latin accents, spaces and punctuation don't matter. */
export const loose = (s: string) => unaccent(s).toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();

/** The answer and every other accepted answer, in the order written. */
export const answersOf = (it: Pick<Item, 'answer' | 'also'>) => [it.answer, ...(it.also ?? [])];

/** The blank in a fill-in sentence: three or more underscores (two stay text, as in Python's __init__). */
export const BLANK = /_{3,}/g;
export const blanks = (s: string) => (s.match(BLANK) ?? []).length;

/** True or False: these questions only make sense as multiple choice. */
export const isTrueFalse = (answer: string) => /^(true|false)$/i.test(answer.trim());

/** A number on its own ("1857", "-3.5", "3/4"): such an answer may appear in its question by chance (x + 4 = 8). */
export const isNumber = (s: string) => /^[-+]?\d+(?:[,.:/]\d+)*$/.test(s.replace(/\s+/g, ''));

/**
 * Whether a text shows one of the question's answers, as whole words. An answer with no letters (a number, √2) or of
 * one letter (Vitamin "A", next to the word "a") doesn't count: it can be in a question by chance (x + 4 = 8).
 */
export function shows(text: string, it: Pick<Item, 'answer' | 'also'>): boolean {
  const t = ` ${loose(text)} `;
  return answersOf(it).some((a) => {
    const l = loose(a);
    return /\p{L}/u.test(l) && l.length > 1 && !isTrueFalse(a) && t.includes(` ${l} `);
  });
}

/** The fill-in sentence: the Fill line, or the question itself when it has exactly one blank. Null when there is none. */
export function fillText(it: Pick<Item, 'question' | 'fill'>): string | null {
  if (it.fill && blanks(it.fill) === 1) return it.fill;
  return blanks(it.question) === 1 ? it.question : null;
}

/** Letters only, for a grid: accents removed. Null when the text has digits, symbols or another script. */
export function gridWord(text: string): string | null {
  const t = unaccent(text).normalize('NFKD').replace(/\p{M}/gu, '').trim();
  return /^[A-Za-z][A-Za-z\s\-'’.]*$/.test(t) ? t.replace(/[^A-Za-z]/g, '').toUpperCase() : null;
}

/**
 * What a crossword or word search hides for a question: the answer if it fits, else the first other accepted answer
 * that does ("Decomposition reaction" is too long for a word search, "Decomposition" isn't). Null if none fits.
 */
export function gridForm(it: Pick<Item, 'answer' | 'also'>, min: number, max: number): { text: string; word: string } | null {
  for (const text of answersOf(it)) {
    const word = gridWord(text);
    if (word && word.length >= min && word.length <= max) return { text, word };
  }
  return null;
}

/** Crossword enumeration: the length of each word of the answer, "(8, 8)" for "Balanced equation". */
export const enumeration = (text: string) =>
  `(${unaccent(text).normalize('NFKD').replace(/\p{M}/gu, '').split(/[\s-]+/).map((w) => w.replace(/[^A-Za-z]/g, '').length).filter(Boolean).join(', ')})`;

/** Usable questions: both parts filled in, each ID once. */
export const usable = (items: readonly Item[]) => {
  const ids = new Set<string>();
  return items.filter((it) => it.id && it.question.trim() && it.answer.trim() && !ids.has(it.id) && ids.add(it.id));
};

// ---------------------------------------------------------------- seeded randomness

/** Seeded randomness: the same seed always gives the same puzzle, so any puzzle can be made again exactly. */

/** Mulberry32: small, fast, and the same in every browser. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seed from any text, such as a student ID, a date and the topics studied (FNV-1a). */
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (const ch of text) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function shuffle<T>(xs: readonly T[], r: () => number): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
