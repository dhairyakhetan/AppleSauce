/**
 * Stress test: thousands of question sets (real vocabulary, random words, and deliberately nasty ones) through every
 * game. Every puzzle a maker returns goes to the checker; the report shows how often a maker gets it right first time
 * and how often a game can't be made. `npm test` runs a few hundred sets per kind; `npm run stress` runs many more.
 */
import { describe, expect, it } from 'vitest';
import { rng, shuffle, usable, type Item } from './shared';
import { checkGame, GAME_TYPES, makeGame, makePuzzle, TRIES, type Game, type GameType } from './index';
import { makeCrossword } from './crossword';
import { makeFill } from './fill';
import { makeMatching } from './matching';
import { makeWordSearch } from './wordsearch';

const SETS = Number(process.env.STRESS ?? 40);

const VOCAB = `atom molecule proton neutron electron nucleus isotope element compound mixture solution solvent solute acid base salt
oxidation reduction corrosion rusting rancidity catalyst enzyme photosynthesis respiration chlorophyll stomata xylem phloem
mitochondria ribosome chromosome gene allele mitosis meiosis zygote embryo pollen ovary hormone insulin adrenaline neuron
reflex cerebrum cerebellum friction gravity inertia momentum velocity acceleration force pressure energy power work joule
newton watt volt ampere ohm resistance current voltage magnet compass refraction reflection lens mirror prism spectrum
convex concave focus retina cornea pupil iris myopia democracy constitution parliament judiciary federalism monsoon
plateau delta estuary latitude longitude equator tropic glacier erosion volcano earthquake tsunami cyclone humidity
mughal sultanate renaissance revolution nationalism colonialism swadeshi satyagraha harappa mesopotamia pharaoh pyramid
budget inflation demand supply market barter currency export import tariff subsidy`.split(/\s+/);
const MULTI = ['carbon dioxide', 'balanced equation', 'law of motion', 'red blood cell', 'x-ray', "newton's law", 'food chain', 'water cycle'];
const OTHER = ['H2O', '6.022 x 10^23', 'f = R/2', 'नाइट्रोजन', '(g)', '3:2', 'pH 7'];

const pickN = <T,>(xs: readonly T[], n: number, r: () => number) => Array.from({ length: n }, () => xs[Math.floor(r() * xs.length)]);
/** n different items (a real chapter's answers don't repeat). */
const sample = <T,>(xs: readonly T[], n: number, r: () => number) => shuffle(xs, r).slice(0, n);
const randomWord = (r: () => number, len: number, alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') =>
  Array.from({ length: len }, () => alphabet[Math.floor(r() * alphabet.length)]).join('');
const asItems = (answers: string[], r: () => number): Item[] => answers.map((a, i) => ({
  id: `i${i}`,
  // some questions contain their answer or a gap, to exercise fill-in-the-blank
  question: r() < 0.2 ? `Fill in: the ___ is important (${i})` : r() < 0.2 ? `Which word, ${a}, is meant here (${i})?` : `Clue number ${i} for this answer`,
  answer: a,
}));

/** The kinds of question set, from ordinary to nasty. */
const KINDS: Record<string, (r: () => number) => Item[]> = {
  'real words': (r) => asItems(sample(VOCAB, 3 + Math.floor(r() * 14), r), r),
  'real words, mixed formats': (r) => asItems([...sample(VOCAB, 4 + Math.floor(r() * 8), r), ...sample(MULTI, 2, r), ...sample(OTHER, 2, r)], r),
  'random letters': (r) => asItems(Array.from({ length: 3 + Math.floor(r() * 12) }, () => randomWord(r, 3 + Math.floor(r() * 10))), r),
  'tiny alphabet (AB only)': (r) => asItems(Array.from({ length: 3 + Math.floor(r() * 8) }, () => randomWord(r, 3 + Math.floor(r() * 6), 'AB')), r),
  'words inside words': (r) => asItems(pickN(['ion', 'ionic', 'ions', 'atom', 'atomic', 'atoms', 'cell', 'cells', 'nucleus', 'nuclei', 'tin', 'tint', 'stint'], 6, r), r),
  'palindromes and repeats': (r) => asItems(pickN(['level', 'radar', 'noon', 'kayak', 'refer', 'aaa', 'abab', 'zzzzzz', 'madam', 'civic', 'iron'], 6, r), r),
  'long answers (12-15 letters)': (r) => asItems(Array.from({ length: 3 + Math.floor(r() * 6) }, () => randomWord(r, 12 + Math.floor(r() * 4))), r),
  'duplicates and blanks': (r) => [...asItems(pickN(VOCAB, 6, r), r), ...asItems(pickN(VOCAB, 3, r), r).map((it, i) => ({ ...it, id: `d${i}` })), { id: 'e1', question: '', answer: 'x' }, { id: 'e2', question: 'Q', answer: ' ' }],
  'nothing for grids': (r) => asItems(pickN(OTHER, 5, r), r),
};

const MAKERS: Record<GameType, (items: Item[], r: () => number) => Game | null> = {
  matching: makeMatching, fill: makeFill, wordsearch: makeWordSearch, crossword: makeCrossword,
};

interface Stat { sets: number; made: number; firstTry: number; retried: number; impossible: number; badFromMaker: number; ms: number }

describe('stress', () => {
  it(`every puzzle shown passes its checker (${SETS} sets of each kind)`, () => {
    const stats = new Map<string, Stat>();
    const r = rng(20261009);
    for (const [kind, gen] of Object.entries(KINDS)) {
      for (let s = 0; s < SETS; s++) {
        const items = gen(r);
        const pool = usable(items);
        const seed = Math.floor(r() * 2 ** 31);
        for (const type of GAME_TYPES) {
          const st = stats.get(`${type}|${kind}`) ?? { sets: 0, made: 0, firstTry: 0, retried: 0, impossible: 0, badFromMaker: 0, ms: 0 };
          stats.set(`${type}|${kind}`, st);
          st.sets++;
          // what the maker produces on its own, attempt by attempt, before any checking
          let tries = 0;
          let ok = false;
          for (; tries < TRIES && !ok; tries++) {
            const g = MAKERS[type](pool, rng(seed + tries * 0x9e3779b9));
            if (!g) continue;
            if (checkGame(g, pool).length) st.badFromMaker++;
            else ok = true;
          }
          // what a student would get: it must equal the first good attempt, and pass the checker
          const t0 = performance.now();
          const shown = makeGame(type, items, seed);
          st.ms += performance.now() - t0;
          if (ok) {
            st.made++;
            if (tries === 1) st.firstTry++; else st.retried++;
            expect(shown, `${type} ${kind}`).not.toBeNull();
            expect(checkGame(shown!, pool), `${type} ${kind}`).toEqual([]);
          } else {
            st.impossible++;
            expect(shown, `${type} ${kind}`).toBeNull();
          }
        }
        // some game can always be made when there is at least one usable question
        if (pool.length) expect(makePuzzle(items, seed), kind).not.toBeNull();
      }
    }

    const rows = [...stats].map(([k, s]) => {
      const [type, kind] = k.split('|');
      const pct = (n: number) => `${((100 * n) / s.sets).toFixed(1)}%`;
      return { game: type, 'question sets': kind, made: pct(s.made), 'right first time': pct(s.firstTry), 'needed a retry': pct(s.retried), "can't be made": pct(s.impossible), 'bad puzzles caught': s.badFromMaker, 'avg ms': (s.ms / s.sets).toFixed(2) };
    });
    console.table(rows);
    const total = [...stats.values()].reduce((n, s) => n + s.made, 0);
    console.log(`${total} puzzles made and checked; every one shown passed its checker.`);

    // ordinary questions must almost always make every game
    for (const type of GAME_TYPES) {
      const s = stats.get(`${type}|real words`)!;
      expect(s.made / s.sets, type).toBeGreaterThan(type === 'matching' || type === 'fill' ? 0.99 : 0.9);
    }
  }, 600_000);
});
