/**
 * Word search: answers hidden in a square grid of capital letters, reading forwards only
 * (left to right, top to bottom, diagonally down, diagonally up), so they are fair for young students.
 *
 * The rule that makes it correct: every hidden word appears in the grid exactly once, looking in all eight directions
 * (forwards and backwards). So a student can never find a word in a second place, and the filler letters never spell
 * an answer by accident. Words that contain each other (ION and IONIC) can't both be hidden, so only one is used.
 */
import { gridWord, shuffle, type Item } from './shared';

export const WORDSEARCH = { min: 3, max: 10, minLetters: 3, maxLetters: 12, minSize: 8, maxSize: 15 } as const;

/** The directions words are hidden in: right, down, down-right, up-right. */
export const DIRS: readonly (readonly [number, number])[] = [[0, 1], [1, 0], [1, 1], [-1, 1]];
const ALL_DIRS = [[0, 1], [1, 0], [1, 1], [-1, 1], [0, -1], [-1, 0], [-1, -1], [1, -1]] as const;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export interface HiddenWord { id: string; word: string; clue: string; row: number; col: number; dr: number; dc: number }
export interface WordSearch { type: 'wordsearch'; size: number; grid: string[]; words: HiddenWord[] }

const rev = (s: string) => [...s].reverse().join('');

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

function tryBuild(entries: { it: Item; word: string }[], size: number, r: () => number): WordSearch | null {
  const cells: string[][] = Array.from({ length: size }, () => Array<string>(size).fill(''));
  const owned = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const words: HiddenWord[] = [];
  for (const { it, word } of entries) {
    let placed = false;
    for (let a = 0; a < 300 && !placed; a++) {
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
      placed = true;
    }
    if (!placed) return null;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!cells[y][x]) cells[y][x] = LETTERS[Math.floor(r() * 26)];

  // Repaint filler letters that spell a hidden word a second time, until every word appears exactly once.
  for (let round = 0; round < 60; round++) {
    const grid = cells.map((row) => row.join(''));
    const extra: string[] = [];
    for (const w of words) {
      const places = occurrences(grid, w.word);
      if (places.size > 1) {
        const own = Array.from({ length: w.word.length }, (_, k) => `${w.row + w.dr * k},${w.col + w.dc * k}`).sort().join(' ');
        for (const p of places) if (p !== own) extra.push(...p.split(' '));
      }
    }
    if (!extra.length) return { type: 'wordsearch', size, grid, words };
    const filler = extra.map((k) => k.split(',').map(Number)).filter(([y, x]) => !owned[y][x]);
    if (!filler.length) return null; // the hidden words themselves form the second copy: start again
    for (const [y, x] of filler) cells[y][x] = LETTERS[Math.floor(r() * 26)];
  }
  return null;
}

export function makeWordSearch(items: Item[], r: () => number): WordSearch | null {
  const chosen: { it: Item; word: string }[] = [];
  for (const it of shuffle(items, r)) {
    if (chosen.length === WORDSEARCH.max) break;
    const word = gridWord(it.answer);
    if (!word || word.length < WORDSEARCH.minLetters || word.length > WORDSEARCH.maxLetters) continue;
    // a word inside another (either way round) would always be found twice
    if (chosen.some((c) => c.word.includes(word) || word.includes(c.word) || rev(c.word).includes(word) || word.includes(rev(c.word)))) continue;
    chosen.push({ it, word });
  }
  if (chosen.length < WORDSEARCH.min) return null;
  chosen.sort((a, b) => b.word.length - a.word.length);
  const letters = chosen.reduce((n, c) => n + c.word.length, 0);
  const base = Math.max(WORDSEARCH.minSize, chosen[0].word.length, Math.ceil(Math.sqrt(letters * 2.2)));
  for (let size = Math.min(base, WORDSEARCH.maxSize); size <= WORDSEARCH.maxSize; size++) {
    for (let t = 0; t < 4; t++) {
      const g = tryBuild(chosen, size, r);
      if (g) {
        g.words.sort((a, b) => (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));
        return g;
      }
    }
  }
  return null;
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
  for (const w of words) {
    const it = byId.get(w.id);
    if (!it) { out.push(`word ${w.id} is not in the bank`); continue; }
    if (gridWord(it.answer) !== w.word) out.push(`word ${w.id} is not the answer's letters`);
    if (it.question !== w.clue) out.push(`word ${w.id} has the wrong clue`);
    if (w.word.length < WORDSEARCH.minLetters || w.word.length > WORDSEARCH.maxLetters) out.push(`${w.word} has ${w.word.length} letters`);
    if (!DIRS.some(([dr, dc]) => dr === w.dr && dc === w.dc)) out.push(`${w.word} runs in a direction students don't read`);
    const er = w.row + w.dr * (w.word.length - 1);
    const ec = w.col + w.dc * (w.word.length - 1);
    if ([w.row, w.col, er, ec].some((v) => v < 0 || v >= size)) { out.push(`${w.word} runs off the grid`); continue; }
    const read = Array.from({ length: w.word.length }, (_, i) => grid[w.row + w.dr * i][w.col + w.dc * i]).join('');
    if (read !== w.word) { out.push(`${w.word} is not where it is said to be`); continue; }
    const n = occurrences(grid, w.word).size;
    if (n !== 1) out.push(`${w.word} can be found in ${n} places`);
  }
  return out;
}
