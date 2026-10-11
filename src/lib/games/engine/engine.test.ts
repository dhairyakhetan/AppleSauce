import { describe, expect, it } from 'vitest';
import { enumeration, gridWord, rng, sameAnswer, type Item } from './shared';
import { checkCrossword, makeCrossword, type Crossword } from './crossword';
import { checkFill, type FillIn } from './fill';
import { checkGame, makeGame, makePuzzle, seedOf } from './index';
import { checkMatching, makeMatching, type Matching } from './matching';
import { checkWordSearch, makeWordSearch, occurrences, type WordSearch } from './wordsearch';

const items = (pairs: [string, string][]): Item[] => pairs.map(([question, answer], i) => ({ id: `q${i + 1}`, question, answer }));

const CHEM = items([
  ['Process in which metals are slowly eaten away by air and moisture', 'Corrosion'],
  ['Common name for the corrosion of iron', 'Rusting'],
  ['Gas filled in chip packets to keep the chips fresh', 'Nitrogen'],
  ['Gain of oxygen by a substance during a reaction', 'Oxidation'],
  ['Loss of oxygen by a substance during a reaction', 'Reduction'],
  ['Reaction in which heat is given out', 'Exothermic'],
  ['Reaction in which heat is taken in', 'Endothermic'],
  ['Insoluble solid formed in a reaction between solutions', 'Precipitate'],
  ['Fats and oils go ___ when they are oxidised', 'rancid'],
  ['Colour of the coating that forms on copper left in moist air', 'Green'],
  ['Metal that is coated with zinc to stop it rusting', 'Iron'],
  ['Process of coating iron with zinc', 'Galvanisation'],
  ['Law that requires a chemical equation to be balanced', 'Law of conservation of mass'],
  ['Symbol written after a formula to show a gas', '(g)'],
]);
const seeds = Array.from({ length: 40 }, (_, i) => i * 7919 + 1);

describe('shared rules', () => {
  it('compares typed answers the way a student expects', () => {
    expect(sameAnswer('law of conservation of MASS.', 'Law of conservation of mass')).toBe(true);
    expect(sameAnswer('  carbon-dioxide ', 'Carbon dioxide')).toBe(true);
    expect(sameAnswer('Café', 'cafe')).toBe(true);
    expect(sameAnswer('', '')).toBe(false);
    expect(sameAnswer('Oxygen', 'Nitrogen')).toBe(false);
  });

  it('turns answers into grid letters, or refuses', () => {
    expect(gridWord('Carbon dioxide')).toBe('CARBONDIOXIDE');
    expect(gridWord("Newton's")).toBe('NEWTONS');
    expect(gridWord('Café')).toBe('CAFE');
    expect(gridWord('X-ray')).toBe('XRAY');
    for (const bad of ['H2O', '(g)', 'f = R/2', 'नाइट्रोजन', '6.022', '']) expect(gridWord(bad), bad).toBeNull();
    expect(enumeration('Balanced equation')).toBe('(8, 8)');
    expect(enumeration('X-ray')).toBe('(1, 3)');
  });

  it('gives the same puzzle for the same seed, and others for other seeds', () => {
    for (const type of ['matching', 'fill', 'wordsearch', 'crossword'] as const) {
      const a = makeGame(type, CHEM, 42);
      expect(a, type).not.toBeNull();
      expect(makeGame(type, CHEM, 42), type).toEqual(a);
      const others = seeds.map((s) => JSON.stringify(makeGame(type, CHEM, s)));
      expect(new Set(others).size, type).toBeGreaterThan(30);
    }
    expect(seedOf('student-1|2026-10-09|CBSE10SCI01T01')).toBe(seedOf('student-1|2026-10-09|CBSE10SCI01T01'));
    expect(seedOf('a')).not.toBe(seedOf('b'));
  });
});

describe('making games from real questions', () => {
  it('matching: unique answers, shuffled, never in question order', () => {
    for (const s of seeds) {
      const g = makeMatching(CHEM, rng(s))!;
      expect(checkMatching(g, CHEM)).toEqual([]);
      expect(g.left.length).toBe(8);
    }
    const twins = items([['Q1', 'Iron'], ['Q2', 'iron'], ['Q3', 'Zinc'], ['Q4', 'Copper']]);
    expect(makeGame('matching', twins, 1)!.right.map((x) => x.text).filter((t) => t.toLowerCase() === 'iron')).toHaveLength(1);
    expect(makeGame('matching', items([['a', '1'], ['b', '2']]), 1)).toBeNull();
  });

  it('fill in the blank: the gap goes where ___ is, else where the answer is, else at the end', () => {
    const g = makeGame('fill', CHEM, 3)!;
    const rancid = g.rows.find((r) => r.id === 'q9');
    if (rancid) expect([rancid.mode, rancid.before, rancid.after]).toEqual(['given', 'Fats and oils go ', ' when they are oxidised']);
    const found = makeGame('fill', items([['Iron rusts when iron meets water', 'iron'], ['The cell is the unit of life', 'cell']]), 1)!;
    expect(found.rows.map((r) => r.id)).toEqual(['q2']); // q1 would still show "iron"
    expect(found.rows[0]).toMatchObject({ mode: 'found', before: 'The ', after: ' is the unit of life' });
    const end = makeGame('fill', items([['SI unit of force?', 'Newton']]), 1)!;
    expect(end.rows[0]).toMatchObject({ mode: 'end', before: 'SI unit of force? ', after: '' });
    expect(makeGame('fill', items([['The ___ and the ___', 'x']]), 1)).toBeNull();
  });

  it('word search: forwards only, letters only, each word findable once', () => {
    for (const s of seeds) {
      const g = makeWordSearch(CHEM, rng(s));
      if (!g) continue;
      expect(checkWordSearch(g, CHEM)).toEqual([]);
      for (const w of g.words) expect(occurrences(g.grid, w.word).size).toBe(1);
    }
    const nested = items([['a', 'Ion'], ['b', 'Ionic'], ['c', 'Atom'], ['d', 'Molecule'], ['e', 'Proton']]);
    const g = makeGame('wordsearch', nested, 5)!;
    const words = g.words.map((w) => w.word);
    expect(words.includes('ION') && words.includes('IONIC')).toBe(false);
  });

  it('crossword: interlocking, numbered, with letter counts', () => {
    let made = 0;
    for (const s of seeds) {
      const g = makeCrossword(CHEM, rng(s));
      if (!g) continue;
      made++;
      expect(checkCrossword(g, CHEM)).toEqual([]);
      expect(g.rows).toBeLessThanOrEqual(15);
      expect(g.cols).toBeLessThanOrEqual(15);
    }
    expect(made).toBe(seeds.length);
    const noShared = items([['a', 'Ox'], ['b', 'Zinc'], ['c', 'Pyx'], ['d', 'Bud']]);
    expect(makeGame('crossword', noShared, 1)).toBeNull(); // they can't cross: no crossword rather than a wrong one
  });

  it('leaves answers out of grids when they can\'t go in one', () => {
    const g = makeGame('crossword', CHEM, 9)!;
    expect(g.clues.some((c) => c.id === 'q14')).toBe(false); // "(g)"
    expect(g.clues.some((c) => c.id === 'q13')).toBe(false); // 23 letters
  });

  it('falls back to the next game, and only gives up when nothing can be made', () => {
    const hindi = items([['पानी का सूत्र', 'एच टू ओ'], ['नमक', 'सोडियम क्लोराइड'], ['लोहा', 'आयरन']]);
    expect(makePuzzle(hindi, 1)?.type).toBe('matching');
    expect(makePuzzle(items([['Only one?', 'Yes']]), 1)?.type).toBe('fill');
    expect(makePuzzle([], 1)).toBeNull();
    expect(makePuzzle(CHEM, 1, ['wordsearch', 'crossword'])?.type).toBe('wordsearch');
  });
});

// Each checker is shown a correct puzzle with one thing broken, and must catch it. If a checker missed a kind of
// mistake, the stress tests below would prove nothing, so every rule is tested here.
describe('checkers catch every kind of broken puzzle', () => {
  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
  const caught = <T,>(good: T, check: (g: T) => string[], breaks: Record<string, (g: T) => void>) => {
    expect(check(good)).toEqual([]);
    for (const [name, brk] of Object.entries(breaks)) {
      const bad = clone(good);
      brk(bad);
      expect(check(bad), name).not.toEqual([]);
    }
  };

  it('matching', () => {
    const good = makeGame('matching', CHEM, 1)!;
    caught<Matching>(good, (g) => checkMatching(g, CHEM), {
      'answer swapped for another question\'s': (g) => { g.right[0] = { id: g.right[0].id, text: 'Zinc' }; },
      'question text changed': (g) => { g.left[0].text += '?'; },
      'answer from outside the round': (g) => { g.right[0].id = 'q13'; g.right[0].text = CHEM[12].answer; },
      'one side shorter': (g) => { g.right.pop(); },
      'pair repeated': (g) => { g.left[1] = g.left[0]; },
      'two answers the same': (g) => { const extra = { id: 'dup', question: 'Q', answer: g.right[0].text }; CHEM.push(extra); g.left.push({ id: 'dup', text: 'Q' }); g.right.push({ id: 'dup', text: extra.answer }); },
      'left in the same order': (g) => { g.right = g.left.map((x) => ({ id: x.id, text: CHEM.find((it) => it.id === x.id)!.answer })); },
      'too few pairs': (g) => { g.left = g.left.slice(0, 2); g.right = g.right.filter((x) => g.left.some((l) => l.id === x.id)); },
    });
    CHEM.splice(CHEM.findIndex((it) => it.id === 'dup'), 1);
  });

  it('fill in the blank', () => {
    const pool = [...CHEM, { id: 'f1', question: 'The cell is the unit of life', answer: 'cell' }];
    const good = makeGame('fill', pool, 2)!;
    const i = good.rows.findIndex((r) => r.mode !== 'end');
    caught<FillIn>(good, (g) => checkFill(g, pool), {
      'wrong answer': (g) => { g.rows[0].answer = 'Zinc'; },
      'text changed': (g) => { g.rows[0].before = `Not ${g.rows[0].before}`; },
      'gap moved': (g) => { g.rows[i].before = g.rows[i].before.slice(0, -2); },
      'answer still showing': (g) => { g.rows[0].after += ` ${g.rows[0].answer}`; },
      'second gap': (g) => { g.rows[0].before = `___ ${g.rows[0].before}`; },
      'unknown question': (g) => { g.rows[0].id = 'nope'; },
      'repeated question': (g) => { g.rows[1] = g.rows[0]; },
      'wrong mode': (g) => { g.rows[i].mode = 'end'; },
    });
  });

  it('word search', () => {
    const good = makeGame('wordsearch', CHEM, 4)!;
    const w0 = good.words[0];
    const flip = (g: WordSearch, r: number, c: number, ch?: string) => {
      const row = [...g.grid[r]];
      row[c] = ch ?? (row[c] === 'Q' ? 'X' : 'Q');
      g.grid[r] = row.join('');
    };
    caught<WordSearch>(good, (g) => checkWordSearch(g, CHEM), {
      'a letter of a word changed': (g) => flip(g, w0.row, w0.col),
      'word said to be somewhere else': (g) => { g.words[0].col = (g.words[0].col + 1) % g.size; },
      'backwards direction': (g) => { const w = g.words[0]; w.col += (w.word.length - 1) * w.dc; w.row += (w.word.length - 1) * w.dr; w.dr = -w.dr; w.dc = -w.dc; },
      'word written a second time': (g) => {
        // write the shortest word into a free row of filler, where it doesn't touch the hidden words
        const w = [...g.words].sort((a, b) => a.word.length - b.word.length)[0];
        const used = new Set(g.words.flatMap((x) => Array.from({ length: x.word.length }, (_, k) => `${x.row + x.dr * k},${x.col + x.dc * k}`)));
        for (let r = 0; r < g.size; r++) {
          for (let c = 0; c + w.word.length <= g.size; c++) {
            if ([...w.word].every((_, k) => !used.has(`${r},${c + k}`))) { [...w.word].forEach((ch, k) => flip(g, r, c + k, ch)); return; }
          }
        }
      },
      'lower-case letter': (g) => { g.grid[0] = g.grid[0].toLowerCase(); },
      'grid not square': (g) => { g.grid.pop(); },
      'wrong clue': (g) => { g.words[0].clue = 'Something else'; },
      'word that is not the answer': (g) => { g.words[0].word = g.words[0].word.slice(1); },
      'too few words': (g) => { g.words = g.words.slice(0, 2); },
    });
  });

  it('crossword', () => {
    const good = makeGame('crossword', CHEM, 6)!;
    const c0 = good.clues[0];
    const setCell = (g: Crossword, r: number, c: number, ch: string) => { const row = [...g.grid[r]]; row[c] = ch; g.grid[r] = row.join(''); };
    const blank = (() => { for (let r = 0; r < good.rows; r++) for (let c = 0; c < good.cols; c++) if (good.grid[r][c] === '#') return [r, c]; return null; })();
    const breaks: Record<string, (g: Crossword) => void> = {
      'letter changed': (g) => setCell(g, c0.row, c0.col, c0.answer[0] === 'Q' ? 'X' : 'Q'),
      'wrong number': (g) => { g.clues[0].n += 1; },
      'wrong direction': (g) => { g.clues[0].dir = g.clues[0].dir === 'across' ? 'down' : 'across'; },
      'clue moved': (g) => { g.clues[0].col += 1; },
      'wrong clue': (g) => { g.clues[0].clue = 'Something else'; },
      'wrong letter count': (g) => { g.clues[0].enumeration = '(99)'; },
      'an answer dropped': (g) => { g.clues.pop(); },
      'two clues swapped': (g) => { [g.clues[0].clue, g.clues[1].clue] = [g.clues[1].clue, g.clues[0].clue]; },
      'grid not rectangular': (g) => { g.grid[0] = g.grid[0].slice(1); },
      'too big': (g) => { g.rows = 16; },
    };
    if (blank) breaks['stray letter in a black square'] = (g) => setCell(g, blank[0], blank[1], 'A');
    caught<Crossword>(good, (g) => checkCrossword(g, CHEM), breaks);

    // two answers lying side by side make accidental words: the checker must refuse
    const sideBySide: Crossword = {
      type: 'crossword', rows: 3, cols: 4, grid: ['IRON', 'ZINC', 'G###'],
      clues: [
        { id: 'a', n: 1, dir: 'across', row: 0, col: 0, answer: 'IRON', clue: 'A', enumeration: '(4)' },
        { id: 'b', n: 5, dir: 'across', row: 1, col: 0, answer: 'ZINC', clue: 'B', enumeration: '(4)' },
        { id: 'c', n: 1, dir: 'down', row: 0, col: 0, answer: 'IZG', clue: 'C', enumeration: '(3)' },
      ],
    };
    const bank = items([['A', 'Iron'], ['B', 'Zinc'], ['C', 'Izg']]).map((it, i) => ({ ...it, id: 'abc'[i] }));
    expect(checkCrossword(sideBySide, bank).some((p) => p.includes('accidental word'))).toBe(true);
  });

  it('checkGame sends each puzzle to its own checker', () => {
    for (const type of ['matching', 'fill', 'wordsearch', 'crossword'] as const) expect(checkGame(makeGame(type, CHEM, 11)!, CHEM)).toEqual([]);
  });
});
