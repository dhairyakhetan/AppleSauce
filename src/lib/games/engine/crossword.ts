/**
 * Crossword: answers interlocking across and down, numbered the standard way, with the questions as clues.
 *
 * The rules that make it correct: every run of two or more letters in the grid, across or down, is exactly one of the
 * clued answers (no accidental words where answers touch); every letter belongs to an answer; all answers are joined
 * into one grid; and clue numbers follow reading order. Not every answer always fits: the ones that can't cross the
 * others are left out of that crossword, and a crossword with fewer than three answers is not made at all.
 */
import { enumeration, gridWord, shuffle, type Item } from './shared';

export const CROSSWORD = { min: 3, max: 12, minLetters: 3, maxLetters: 15, maxSize: 15 } as const;

type Dir = 'across' | 'down';
export interface Clue { id: string; n: number; dir: Dir; row: number; col: number; answer: string; clue: string; enumeration: string }
/** `grid` rows use "#" for a black square; the letters are the solution, hidden from the student while playing. */
export interface Crossword { type: 'crossword'; rows: number; cols: number; grid: string[]; clues: Clue[] }

interface Entry { it: Item; word: string }
interface Layout {
  letters: Map<string, string>;
  dirs: Map<string, Set<Dir>>;
  placed: { e: Entry; row: number; col: number; dir: Dir }[];
  box: { r0: number; r1: number; c0: number; c1: number };
}

const key = (r: number, c: number) => `${r},${c}`;
const step = (dir: Dir) => (dir === 'down' ? [1, 0] : [0, 1]);

/** How many letters a word would share with the grid there, or -1 if it can't go there. */
function fits(l: Layout, word: string, row: number, col: number, dir: Dir): number {
  const [dr, dc] = step(dir);
  if (l.letters.has(key(row - dr, col - dc)) || l.letters.has(key(row + dr * word.length, col + dc * word.length))) return -1;
  const r0 = Math.min(l.box.r0, row), r1 = Math.max(l.box.r1, row + dr * (word.length - 1));
  const c0 = Math.min(l.box.c0, col), c1 = Math.max(l.box.c1, col + dc * (word.length - 1));
  if (r1 - r0 + 1 > CROSSWORD.maxSize || c1 - c0 + 1 > CROSSWORD.maxSize) return -1;
  let crossings = 0;
  for (let i = 0; i < word.length; i++) {
    const r = row + dr * i;
    const c = col + dc * i;
    const have = l.letters.get(key(r, c));
    if (have !== undefined) {
      if (have !== word[i] || l.dirs.get(key(r, c))!.has(dir)) return -1;
      crossings++;
    } else if (l.letters.has(key(r + dc, c + dr)) || l.letters.has(key(r - dc, c - dr))) {
      return -1; // would lie alongside another answer
    }
  }
  return crossings;
}

function put(l: Layout, e: Entry, row: number, col: number, dir: Dir) {
  const [dr, dc] = step(dir);
  for (let i = 0; i < e.word.length; i++) {
    const k = key(row + dr * i, col + dc * i);
    l.letters.set(k, e.word[i]);
    (l.dirs.get(k) ?? l.dirs.set(k, new Set()).get(k)!).add(dir);
  }
  l.placed.push({ e, row, col, dir });
  l.box = {
    r0: Math.min(l.box.r0, row), r1: Math.max(l.box.r1, row + dr * (e.word.length - 1)),
    c0: Math.min(l.box.c0, col), c1: Math.max(l.box.c1, col + dc * (e.word.length - 1)),
  };
}

const area = (l: Layout) => (l.box.r1 - l.box.r0 + 1) * (l.box.c1 - l.box.c0 + 1);

/** One greedy layout: place the first word, then keep placing whatever crosses best until nothing more fits. */
function attempt(order: Entry[], r: () => number): Layout {
  const l: Layout = { letters: new Map(), dirs: new Map(), placed: [], box: { r0: 0, r1: 0, c0: 0, c1: 0 } };
  let pending = order.slice();
  put(l, pending.shift()!, 0, 0, 'across');
  for (let progress = true; progress && pending.length; ) {
    progress = false;
    const next: Entry[] = [];
    for (const e of pending) {
      let best: { row: number; col: number; dir: Dir; score: number } | null = null;
      for (const [k, ch] of l.letters) {
        const [cr, cc] = k.split(',').map(Number);
        for (let i = 0; i < e.word.length; i++) {
          if (e.word[i] !== ch) continue;
          for (const dir of ['across', 'down'] as Dir[]) {
            const row = dir === 'down' ? cr - i : cr;
            const col = dir === 'across' ? cc - i : cc;
            const crossings = fits(l, e.word, row, col, dir);
            if (crossings < 1) continue;
            const h = Math.max(l.box.r1, row + (dir === 'down' ? e.word.length - 1 : 0)) - Math.min(l.box.r0, row) + 1;
            const w = Math.max(l.box.c1, col + (dir === 'across' ? e.word.length - 1 : 0)) - Math.min(l.box.c0, col) + 1;
            const score = crossings * 100 - Math.max(h, w) * 3 - h * w * 0.1 + r(); // more crossings, then a smaller, squarer grid
            if (!best || score > best.score) best = { row, col, dir, score };
          }
        }
      }
      if (best) { put(l, e, best.row, best.col, best.dir); progress = true; } else next.push(e);
    }
    pending = next;
  }
  return l;
}

export function makeCrossword(items: Item[], r: () => number): Crossword | null {
  const chosen: Entry[] = [];
  const seen = new Set<string>();
  for (const it of shuffle(items, r)) {
    if (chosen.length === CROSSWORD.max) break;
    const word = gridWord(it.answer);
    if (!word || word.length < CROSSWORD.minLetters || word.length > CROSSWORD.maxLetters || seen.has(word)) continue;
    seen.add(word);
    chosen.push({ it, word });
  }
  if (chosen.length < CROSSWORD.min) return null;

  const byLength = chosen.slice().sort((a, b) => b.word.length - a.word.length);
  let best: Layout | null = null;
  for (let t = 0; t < 24; t++) {
    const order = t === 0 ? byLength : [byLength[0], ...shuffle(byLength.slice(1), r)];
    const l = attempt(order, r);
    if (!best || l.placed.length > best.placed.length || (l.placed.length === best.placed.length && area(l) < area(best))) best = l;
    if (best.placed.length === chosen.length && t >= 6) break;
  }
  if (!best || best.placed.length < CROSSWORD.min) return null;

  const { r0, r1, c0, c1 } = best.box;
  const rows = r1 - r0 + 1;
  const cols = c1 - c0 + 1;
  const cells = Array.from({ length: rows }, () => Array<string>(cols).fill('#'));
  for (const [k, ch] of best.letters) {
    const [y, x] = k.split(',').map(Number);
    cells[y - r0][x - c0] = ch;
  }
  const placed = best.placed
    .map((p) => ({ ...p, row: p.row - r0, col: p.col - c0 }))
    .sort((a, b) => a.row - b.row || a.col - b.col || (a.dir === 'across' ? -1 : 1));
  let n = 0;
  let last = '';
  const clues: Clue[] = placed.map((p) => {
    if (key(p.row, p.col) !== last) { n++; last = key(p.row, p.col); }
    return { id: p.e.it.id, n, dir: p.dir, row: p.row, col: p.col, answer: p.e.word, clue: p.e.it.question, enumeration: enumeration(p.e.it.answer) };
  });
  return { type: 'crossword', rows, cols, grid: cells.map((row) => row.join('')), clues };
}

/** Everything wrong with a crossword; empty when it is correct. Written separately from the maker on purpose. */
export function checkCrossword(g: Crossword, items: Item[]): string[] {
  const out: string[] = [];
  const byId = new Map(items.map((it) => [it.id, it]));
  const { rows, cols, grid, clues } = g;
  if (rows < 1 || cols < 1 || rows > CROSSWORD.maxSize || cols > CROSSWORD.maxSize) out.push(`grid is ${rows} by ${cols}`);
  if (grid.length !== rows || grid.some((row) => row.length !== cols || !/^[A-Z#]+$/.test(row))) {
    out.push('grid is not rows of capital letters and #');
    return out;
  }
  if (clues.length < CROSSWORD.min || clues.length > CROSSWORD.max) out.push(`has ${clues.length} answers, needs ${CROSSWORD.min} to ${CROSSWORD.max}`);
  if (new Set(clues.map((c) => c.id)).size !== clues.length) out.push('a question is used twice');
  if (new Set(clues.map((c) => c.answer)).size !== clues.length) out.push('an answer is used twice');
  const at = (r: number, c: number) => (r >= 0 && r < rows && c >= 0 && c < cols ? grid[r][c] : '#');

  // every run of 2+ letters, read straight from the grid
  const runs = new Map<string, string>(); // "row,col,dir" -> letters
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (at(r, c) === '#') continue;
      for (const dir of ['across', 'down'] as Dir[]) {
        const [dr, dc] = step(dir);
        if (at(r - dr, c - dc) !== '#') continue; // not the start of a run
        let word = '';
        for (let i = 0; at(r + dr * i, c + dc * i) !== '#'; i++) word += at(r + dr * i, c + dc * i);
        if (word.length >= 2) runs.set(`${r},${c},${dir}`, word);
      }
    }
  }
  // standard numbering: cells that start a run, in reading order
  const numbers = new Map<string, number>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (runs.has(`${r},${c},across`) || runs.has(`${r},${c},down`)) numbers.set(key(r, c), numbers.size + 1);
    }
  }

  const covered = new Set<string>();
  for (const cl of clues) {
    const it = byId.get(cl.id);
    if (!it) { out.push(`answer ${cl.id} is not in the bank`); continue; }
    if (gridWord(it.answer) !== cl.answer) out.push(`answer ${cl.id} is not the answer's letters`);
    if (it.question !== cl.clue) out.push(`answer ${cl.id} has the wrong clue`);
    if (enumeration(it.answer) !== cl.enumeration) out.push(`answer ${cl.id} shows the wrong letter count`);
    if (cl.answer.length < CROSSWORD.minLetters || cl.answer.length > CROSSWORD.maxLetters) out.push(`${cl.answer} has ${cl.answer.length} letters`);
    const run = runs.get(`${cl.row},${cl.col},${cl.dir}`);
    if (run !== cl.answer) out.push(`${cl.n} ${cl.dir} does not read ${cl.answer} in the grid`);
    if (numbers.get(key(cl.row, cl.col)) !== cl.n) out.push(`${cl.answer} is numbered ${cl.n}, should be ${numbers.get(key(cl.row, cl.col))}`);
    const [dr, dc] = step(cl.dir);
    for (let i = 0; i < cl.answer.length; i++) covered.add(key(cl.row + dr * i, cl.col + dc * i));
  }
  const clued = new Set(clues.map((cl) => `${cl.row},${cl.col},${cl.dir}`));
  for (const [k, word] of runs) if (!clued.has(k)) out.push(`${word} at ${k} is an accidental word with no clue`);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (at(r, c) !== '#' && !covered.has(key(r, c))) out.push(`the letter at ${r},${c} belongs to no answer`);

  // all answers joined into one piece
  const letterCells = [...covered];
  if (letterCells.length) {
    const seen = new Set([letterCells[0]]);
    const queue = [letterCells[0]];
    while (queue.length) {
      const [r, c] = queue.pop()!.split(',').map(Number);
      for (const [y, x] of [[r + 1, c], [r - 1, c], [r, c + 1], [r, c - 1]]) {
        const k = key(y, x);
        if (at(y, x) !== '#' && !seen.has(k)) { seen.add(k); queue.push(k); }
      }
    }
    if (seen.size !== letterCells.length) out.push('the answers are not all joined together');
  }
  return out;
}
