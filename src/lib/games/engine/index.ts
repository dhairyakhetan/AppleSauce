/**
 * Revision games made from questions in the bank, on the student's device. No AI: the same questions and seed always
 * give the same puzzle.
 *
 * The guarantee: a puzzle is only ever returned after its checker has passed it. Each game has a maker and a separate
 * checker; if a made puzzle fails its check, it is made again with another seed, and if a game still can't be made,
 * the next game is tried. A student can't be shown a broken puzzle: at worst, a different game.
 *
 * Which questions a game uses is decided by what the writer wrote, never guessed: see `usableIn`.
 */
import { fillText, gridForm, shows, rng, usable, type Item } from './shared';
import { checkChoice, choiceOnly, makeChoice, wrongOptions, type Choice } from './choice';
import { checkCrossword, CROSSWORD, makeCrossword, type Crossword } from './crossword';
import { checkFill, makeFill, type FillIn } from './fill';
import { checkMatching, makeMatching, type Matching } from './matching';
import { checkWordSearch, makeWordSearch, WORDSEARCH, type WordSearch } from './wordsearch';

export type { Item } from './shared';
export { seedOf } from './shared';
export { mark, sameAnswer, type Mark } from './answers';

export type Game = Matching | FillIn | WordSearch | Crossword | Choice;
export type GameType = Game['type'];
export const GAME_TYPES: GameType[] = ['crossword', 'wordsearch', 'matching', 'fill', 'choice'];

const MAKE: { [T in GameType]: (items: Item[], r: () => number) => Extract<Game, { type: T }> | null } = {
  matching: makeMatching, fill: makeFill, wordsearch: makeWordSearch, crossword: makeCrossword, choice: makeChoice,
};

/** Everything wrong with a puzzle; empty when it is correct. */
export function checkGame(g: Game, items: Item[]): string[] {
  switch (g.type) {
    case 'matching': return checkMatching(g, items);
    case 'fill': return checkFill(g, items);
    case 'wordsearch': return checkWordSearch(g, items);
    case 'crossword': return checkCrossword(g, items);
    case 'choice': return checkChoice(g, items);
  }
}

/**
 * The games one question can go in, from what was written for it:
 *   crossword    the answer (or another accepted answer) is 3 to 25 letters, with no digits or symbols;
 *   word search  the same, 3 to 15 letters;
 *   matching     any question that isn't True/False;
 *   fill         it has a fill-in sentence (a Fill line, or ___ in the question);
 *   choice       it has wrong options, or it is True/False.
 * A question whose own text shows its answer goes in none: it would give the answer away.
 */
export function usableIn(it: Item): GameType[] {
  if (shows(it.question, it)) return [];
  if (choiceOnly(it)) return ['choice'];
  const out: GameType[] = [];
  if (gridForm(it, CROSSWORD.minLetters, CROSSWORD.maxLetters)) out.push('crossword');
  if (gridForm(it, WORDSEARCH.minLetters, WORDSEARCH.maxLetters)) out.push('wordsearch');
  out.push('matching');
  if (fillText(it)) out.push('fill');
  if (wrongOptions(it).length) out.push('choice');
  return out;
}

/** How many times a game is made again, with a new seed, before giving up on it. */
export const TRIES = 12;

/** The questions a game can use. */
export const poolFor = (type: GameType, items: Item[]) => usable(items).filter((it) => usableIn(it).includes(type));

/** One game from these questions, checked; null if this game can't be made from them. */
export function makeGame<T extends GameType>(type: T, items: Item[], seed: number): Extract<Game, { type: T }> | null {
  const pool = poolFor(type, items);
  for (let t = 0; t < TRIES; t++) {
    const g = MAKE[type](pool, rng(seed + t * 0x9e3779b9));
    if (!g) continue;
    if (checkGame(g, pool).length === 0) return g;
  }
  return null;
}

/**
 * A puzzle for a revision session: the first game in `prefer` that can be made from these questions.
 * Null only when no game at all can be made.
 */
export function makePuzzle(items: Item[], seed: number, prefer: GameType[] = GAME_TYPES): Game | null {
  for (const type of prefer) {
    const g = makeGame(type, items, seed);
    if (g) return g;
  }
  return null;
}
