/**
 * Word search: answers hidden in a square grid of capital letters, reading forwards only
 * (left to right, top to bottom, diagonally down, diagonally up), so they are fair for young students.
 * A question goes in with its answer, or the first of its other accepted answers that fits (letters only, 3 to 15).
 * A word that can't be placed is left out of that grid, not the whole grid.
 *
 * The rules that make it correct: every hidden word appears in the grid exactly once, looking in all eight directions
 * (forwards and backwards), so a student can never find a word in a second place; and the filler letters never spell a
 * rude word (in English, Hindi or Bengali written in English letters), in any direction. The filler letters are drawn
 * from the hidden words' own letters, so the words don't stand out by their letters. Words that contain each other
 * (ION and IONIC) can't both be hidden, so only one is used.
 */
import { gridForm, shuffle, type Item } from './shared';

export const WORDSEARCH = { min: 3, max: 10, minLetters: 3, maxLetters: 15, minSize: 8, maxSize: 15 } as const;

/** The directions words are hidden in: right, down, down-right, up-right. */
export const DIRS: readonly (readonly [number, number])[] = [[0, 1], [1, 0], [1, 1], [-1, 1]];
const ALL_DIRS = [[0, 1], [1, 0], [1, 1], [-1, 1], [0, -1], [-1, 0], [-1, -1], [1, -1]] as const;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Words the filler letters must never spell, in any direction (a hidden answer may contain one, as ASSAM does). In
 * English, and Hindi and Bengali written in English letters.
 */
export const RUDE = [
  'ANAL', 'ANUS', 'ARSE', 'ASS', 'BITCH', 'BOOB', 'BUTT', 'CLIT', 'COCK', 'CRAP', 'CUM', 'CUNT', 'DICK', 'DILDO', 'FAG',
  'FAP', 'FUCK', 'FUK', 'HOE', 'HORNY', 'JIZZ', 'KKK', 'KYS', 'NAZI', 'NIGGA', 'NIGGER', 'NUDE', 'ORGY', 'PENIS', 'PISS',
  'PORN', 'PUBE', 'PUSSY', 'RAPE', 'SEX', 'SEXY', 'SHIT', 'SLUT', 'SPERM', 'TIT', 'TWAT', 'VAGINA', 'WANK', 'WHORE',
  'WTF', 'XXX',
  'BAAL', 'BHENCHOD', 'BEHENCHOD', 'BHOSDA', 'BHOSDI', 'BOKACHODA', 'CHOD', 'CHODA', 'CHUD', 'CHUT', 'CHUTIA', 'CHUTIYA',
  'GAAND', 'GAND', 'HARAMI', 'JHANT', 'KAMINA', 'KHANKI', 'LAUDA', 'LODA', 'LUND', 'MADARCHOD', 'RANDI', 'TATTI',
] as const;

export interface HiddenWord { id: string; word: string; clue: string; row: number; col: number; dr: number; dc: number }
export interface WordSearch { type: 'wordsearch'; size: number; grid: string[]; words: HiddenWord[] }

const rev = (s: string) => [...s].reverse().join('');
const cellsOf = (w: Pick<HiddenWord, 'word' | 'row' | 'col' | 'dr' | 'dc'>) => Array.from({ length: w.word.length }, (_, k) => `${w.row + w.dr * k},${w.col + w.dc * k}`);

/** Every place a word can be read in the grid, in any of the eight directions, as a set of cells ("r,c r,c ..."). */
export function occurrences(grid: string[], word: string): Set<string> {
  const n = grid.length;
  const found = new Set<string>();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (grid[r][c] !== word[0]) continue;
      for (const [dr, dc] of ALL_DIRS) {
        const er = r + dr * (word.length - 1);
        const ec = c + dc * (word.length - 1);
        if (er < 0 || er >= n || ec < 0 || ec >= n) continue;
        let i = 1;
        while (i < word.length && grid[r + dr * i][c + dc * i] === word[i]) i++;
        if (i === word.length) {
          const cells = Array.from({ length: word.length }, (_, k) => `${r + dr * k},${c + dc * k}`).sort();
          found.add(cells.join(' ')); // a palindrome read both ways is still one place
        }
      }
    }
  }
  return found;
}

/** Rude words in the grid that aren't part of one hidden answer: where each is, as cells. */
export function rudeWords(grid: string[], words: Pick<HiddenWord, 'word' | 'row' | 'col' | 'dr' | 'dc'>[]): { word: string; cells: string[] }[] {
  const hidden = words.map((w) => new Set(cellsOf(w)));
  const out: { word: string; cells: string[] }[] = [];
  for (const word of RUDE) {
    for (const place of occurrences(grid, word)) {
      const cells = place.split(' ');
      if (!hidden.some((h) => cells.every((k) => h.has(k)))) out.push({ word, cells });
    }
  }
  return out;
}

type Entry = { it: Item; word: string };

function tryBuild(entries: Entry[], size: number, r: () => number): WordSearch | null {
  const cells: string[][] = Array.from({ length: size }, () => Array<string>(size).fill(''));
  const owned = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const words: HiddenWord[] = [];
  for (const { it, word } of entries) {
    if (words.length === WORDSEARCH.max) break;
    for (let a = 0; a < 300; a++) {
      const [dr, dc] = DIRS[Math.floor(r() * DIRS.length)];
      const row = Math.floor(r() * size);
      const col = Math.floor(r() * size);
      const er = row + dr * (word.length - 1);
      const ec = col + dc * (word.length - 1);
      if (er < 0 || er >= size || ec < 0 || ec >= size) continue;
      let ok = true;
      for (let i = 0; i < word.length && ok; i++) {
        const cur = cells[row + dr * i][col + dc * i];
        ok = cur === '' || cur === word[i];
      }
      if (!ok) continue;
      for (let i = 0; i < word.length; i++) {
        cells[row + dr * i][col + dc * i] = word[i];
        owned[row + dr * i][col + dc * i] = true;
      }
      words.push({ id: it.id, word, clue: it.question, row, col, dr, dc });
      break; // placed; a word that never fits is left out of this grid
    }
  }
  if (words.length < WORDSEARCH.min) return null;

  // filler from the hidden words' own letters, so a rare letter doesn't give a word away
  const pool = words.map((w) => w.word).join('');
  const letter = (round: number) => (round < 30 ? pool : LETTERS)[Math.floor(r() * (round < 30 ? pool.length : 26))];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!cells[y][x]) cells[y][x] = letter(0);

  // Repaint filler letters that spell a hidden word a second time, or a rude word, until there are none.
  for (let round = 0; round < 60; round++) {
    const grid = cells.map((row) => row.join(''));
    const bad: string[] = [];
    for (const w of words) {
      const places = occurrences(grid, w.word);
      if (places.size > 1) {
        const own = cellsOf(w).sort().join(' ');
        for (const p of places) if (p !== own) bad.push(...p.split(' '));
      }
    }
    for (const x of rudeWords(grid, words)) bad.push(...x.cells);
    if (!bad.length) return { type: 'wordsearch', size, grid, words };
    const filler = bad.map((k) => k.split(',').map(Number)).filter(([y, x]) => !owned[y][x]);
    if (!filler.length) return null; // the hidden words themselves spell it: start again
    for (const [y, x] of filler) cells[y][x] = letter(round + 1);
  }
  return null;
}

export function makeWordSearch(items: Item[], r: () => number): WordSearch | null {
  const chosen: Entry[] = [];
  for (const it of shuffle(items, r)) {
    if (chosen.length === WORDSEARCH.max * 2) break; // spares, for words that don't fit
    const form = gridForm(it, WORDSEARCH.minLetters, WORDSEARCH.maxLetters);
    if (!form) continue;
    const word = form.word;
    // a word inside another (either way round) would always be found twice
    if (chosen.some((c) => c.word.includes(word) || word.includes(c.word) || rev(c.word).includes(word) || word.includes(rev(c.word)))) continue;
    chosen.push({ it, word });
  }
  if (chosen.length < WORDSEARCH.min) return null;
  // the first ones chosen go in, longest first (they are the hardest to fit); the spares follow
  const first = chosen.slice(0, WORDSEARCH.max).sort((a, b) => b.word.length - a.word.length);
  const order = [...first, ...chosen.slice(WORDSEARCH.max)];
  const letters = first.reduce((n, c) => n + c.word.length, 0);
  const base = Math.max(WORDSEARCH.minSize, first[0].word.length, Math.ceil(Math.sqrt(letters * 2.2)));
  let best: WordSearch | null = null;
  for (let size = Math.min(base, WORDSEARCH.maxSize); size <= WORDSEARCH.maxSize; size++) {
    for (let t = 0; t < 4; t++) {
      const g = tryBuild(order, size, r);
      if (g && (!best || g.words.length > best.words.length)) best = g;
    }
    if (best && best.words.length >= Math.min(WORDSEARCH.max, chosen.length)) break;
  }
  if (!best) return null;
  best.words.sort((a, b) => (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));
  return best;
}

/** Everything wrong with a word search; empty when it is correct. Written separately from the maker on purpose. */
export function checkWordSearch(g: WordSearch, items: Item[]): string[] {
  const out: string[] = [];
  const byId = new Map(items.map((it) => [it.id, it]));
  const { size, grid, words } = g;
  if (size < WORDSEARCH.minSize || size > WORDSEARCH.maxSize) out.push(`grid is ${size} wide`);
  if (grid.length !== size || grid.some((row) => row.length !== size || !/^[A-Z]+$/.test(row))) {
    out.push('grid is not a square of capital letters');
    return out;
  }
  if (words.length < WORDSEARCH.min || words.length > WORDSEARCH.max) out.push(`hides ${words.length} words, needs ${WORDSEARCH.min} to ${WORDSEARCH.max}`);
  if (new Set(words.map((w) => w.id)).size !== words.length) out.push('a question is used twice');
  if (new Set(words.map((w) => w.word)).size !== words.length) out.push('a word is hidden twice');
  let placed = true;
  for (const w of words) {
    const it = byId.get(w.id);
    if (!it) { out.push(`word ${w.id} is not in the bank`); continue; }
    if (gridForm(it, WORDSEARCH.minLetters, WORDSEARCH.maxLetters)?.word !== w.word) out.push(`word ${w.id} is not the answer's letters`);
    if (it.question !== w.clue) out.push(`word ${w.id} has the wrong clue`);
    if (!DIRS.some(([dr, dc]) => dr === w.dr && dc === w.dc)) out.push(`${w.word} runs in a direction students don't read`);
    const er = w.row + w.dr * (w.word.length - 1);
    const ec = w.col + w.dc * (w.word.length - 1);
    if ([w.row, w.col, er, ec].some((v) => v < 0 || v >= size)) { out.push(`${w.word} runs off the grid`); placed = false; continue; }
    const read = Array.from({ length: w.word.length }, (_, i) => grid[w.row + w.dr * i][w.col + w.dc * i]).join('');
    if (read !== w.word) { out.push(`${w.word} is not where it is said to be`); placed = false; continue; }
    const n = occurrences(grid, w.word).size;
    if (n !== 1) out.push(`${w.word} can be found in ${n} places`);
  }
  if (placed) for (const x of rudeWords(grid, words)) out.push(`the letters spell ${x.word} at ${x.cells[0]}`);
  return out;
}
