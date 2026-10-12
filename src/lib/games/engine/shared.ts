/**
 * The rules every game shares: what a question is, how answers are compared, and which answers can go in a grid.
 * Makers and checkers both use these, so they can never disagree about them.
 */

/** One question from the bank. `id` must be unique (the question's ID in the database). `wrong`: a multiple-choice
 * question's wrong options, as the teacher wrote them. */
export interface Item { id: string; question: string; answer: string; wrong?: readonly string[] }

/**
 * Accents taken off Latin letters (Café → Cafe). Marks in other scripts are kept: in Devanagari or Bengali they are the
 * vowel signs, and taking them off would make different words the same.
 */
export const unaccent = (s: string) => s.normalize('NFKD').replace(/(?<=\p{Script=Latin})\p{M}+/gu, '').normalize('NFC');

/** Text for comparing: case, Latin accents, spaces and punctuation don't matter. */
export const loose = (s: string) => unaccent(s).toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();

/**
 * The answer as students see it. Words in square brackets are ones a student may leave out ("Decomposition [reaction]",
 * "[Jawaharlal] Nehru"): the brackets go, the words stay.
 */
export const shownAnswer = (answer: string) => answer.replace(/\[([^\]]*)\]/g, '$1').replace(/\s+/g, ' ').trim();

/** "Central Processing Unit (CPU)": the main answer and the one in brackets after it. "(g)" and "f(x)" aren't split. */
export function splitAlt(text: string): { main: string; alt: string | null } {
  const m = text.match(/^(.*\S)\s+\(([^()]*[^\s()][^()]*)\)\s*$/);
  return m ? { main: m[1], alt: m[2].trim() } : { main: text, alt: null };
}

/** What goes in a grid: the answer as shown, without a trailing "(CPU)". */
const gridText = (answer: string) => unaccent(splitAlt(shownAnswer(answer)).main).normalize('NFKD').replace(/\p{M}/gu, '');

/**
 * The form an answer takes in a crossword or word search: letters A to Z only, upper case.
 * Spaces, hyphens, apostrophes and full stops are dropped ("Carbon dioxide" → CARBONDIOXIDE, "Newton's" → NEWTONS);
 * accents are removed; "Central Processing Unit (CPU)" goes in as CENTRALPROCESSINGUNIT. Null when the answer has
 * digits, symbols or another script, which can't go in a letter grid.
 */
export function gridWord(answer: string): string | null {
  const t = gridText(answer).trim();
  return /^[A-Za-z][A-Za-z\s\-'’.]*$/.test(t) ? t.replace(/[^A-Za-z]/g, '').toUpperCase() : null;
}

/** Crossword enumeration: the length of each word of the answer, "(8, 8)" for "Balanced equation". */
export const enumeration = (answer: string) => `(${gridText(answer).split(/[\s-]+/).map((w) => w.replace(/[^A-Za-z]/g, '').length).filter(Boolean).join(', ')})`;

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
