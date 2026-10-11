/**
 * Revision games made from questions in the bank, on the student's device. No AI: the same questions and seed always
 * give the same puzzle.
 *
 * The guarantee: a puzzle is only ever returned after its checker has passed it. Each game has a maker and a separate
 * checker; if a made puzzle fails its check, it is made again with another seed, and if a game still can't be made,
 * the next game is tried. A student can't be shown a broken puzzle: at worst, a different game.
 */
import { rng, usable, type Item } from './shared';
import { checkCrossword, makeCrossword, type Crossword } from './crossword';
import { checkFill, makeFill, type FillIn } from './fill';
import { checkMatching, makeMatching, type Matching } from './matching';
import { checkWordSearch, makeWordSearch, type WordSearch } from './wordsearch';

export type { Item } from './shared';
export { sameAnswer } from './shared';
export { seedOf } from './shared';

export type Game = Matching | FillIn | WordSearch | Crossword;
export type GameType = Game['type'];
export const GAME_TYPES: GameType[] = ['crossword', 'wordsearch', 'matching', 'fill'];

const MAKE: { [T in GameType]: (items: Item[], r: () => number) => Extract<Game, { type: T }> | null } = {
  matching: makeMatching, fill: makeFill, wordsearch: makeWordSearch, crossword: makeCrossword,
};

/** Everything wrong with a puzzle; empty when it is correct. */
export function checkGame(g: Game, items: Item[]): string[] {
  switch (g.type) {
    case 'matching': return checkMatching(g, items);
    case 'fill': return checkFill(g, items);
    case 'wordsearch': return checkWordSearch(g, items);
    case 'crossword': return checkCrossword(g, items);
  }
}

/** How many times a game is made again, with a new seed, before giving up on it. */
export const TRIES = 12;

/** One game from these questions, checked; null if this game can't be made from them. */
export function makeGame<T extends GameType>(type: T, items: Item[], seed: number): Extract<Game, { type: T }> | null {
  const pool = usable(items);
  for (let t = 0; t < TRIES; t++) {
    const g = MAKE[type](pool, rng(seed + t * 0x9e3779b9));
    if (!g) continue;
    if (checkGame(g, pool).length === 0) return g;
  }
  return null;
}

/**
 * A puzzle for a revision session: the first game in `prefer` that can be made from these questions.
 * Null only when no game at all can be made (fewer than one usable question).
 */
export function makePuzzle(items: Item[], seed: number, prefer: GameType[] = GAME_TYPES): Game | null {
  for (const type of prefer) {
    const g = makeGame(type, items, seed);
    if (g) return g;
  }
  return null;
}
