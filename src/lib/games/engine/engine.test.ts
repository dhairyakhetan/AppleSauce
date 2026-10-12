import { describe, expect, it } from 'vitest';
import { sameAnswer } from './answers';
import { enumeration, gridForm, gridWord, rng, type Item } from './shared';
import { checkCrossword, CROSSWORD, makeCrossword, type Crossword } from './crossword';
import { checkFill, type FillIn } from './fill';
import { checkChoice, type Choice } from './choice';
import { checkGame, makeGame, makePuzzle, seedOf, usableIn } from './index';
import { checkMatching, makeMatching, type Matching } from './matching';
import { checkWordSearch, makeWordSearch, occurrences, RUDE, rudeWords, type WordSearch } from './wordsearch';

const items = (pairs: [string, string][]): Item[] => pairs.map(([question, answer], i) => ({ id: `q${i + 1}`, question, answer }));

/** A chapter written the way the prompt asks: fill-in sentences and wrong options on most questions. */
const CHEM: Item[] = [
  { id: 'q1', question: 'Process in which metals are slowly eaten away by air and moisture', answer: 'Corrosion', fill: 'Metals are slowly eaten away by air and moisture in a process called ___.', wrong: ['Rancidity', 'Reduction', 'Distillation'] },
  { id: 'q2', question: 'Common name for the corrosion of iron', answer: 'Rusting', fill: 'Iron left in moist air undergoes ___.', wrong: ['Tarnishing', 'Melting', 'Galvanising'] },
  { id: 'q3', question: 'Gas filled in chip packets to keep the chips fresh', answer: 'Nitrogen', also: ['N2'], fill: 'Chip packets are filled with ___ gas to keep the chips fresh.', wrong: ['Oxygen', 'Hydrogen', 'Chlorine'] },
  { id: 'q4', question: 'Gain of oxygen by a substance during a reaction', answer: 'Oxidation', fill: 'A substance that gains oxygen in a reaction undergoes ___.', wrong: ['Reduction', 'Neutralisation', 'Sublimation'] },
  { id: 'q5', question: 'Loss of oxygen by a substance during a reaction', answer: 'Reduction', fill: 'A substance that loses oxygen in a reaction undergoes ___.', wrong: ['Oxidation', 'Combustion', 'Evaporation'] },
  { id: 'q6', question: 'Reaction in which heat is given out', answer: 'Exothermic reaction', also: ['Exothermic'], fill: 'Burning of natural gas is an ___.', wrong: ['Endothermic reaction', 'Decomposition', 'Displacement'] },
  { id: 'q7', question: 'Reaction in which heat is taken in', answer: 'Endothermic reaction', also: ['Endothermic'], wrong: ['Exothermic reaction', 'Combination', 'Precipitation'] },
  { id: 'q8', question: 'Insoluble solid formed in a reaction between solutions', answer: 'Precipitate', fill: 'An insoluble solid formed when two solutions react is a ___.' },
  { id: 'q9', question: 'Fats and oils go ___ when they are oxidised', answer: 'rancid' },
  { id: 'q10', question: 'Colour of the coating that forms on copper left in moist air', answer: 'Green', wrong: ['Black', 'Red', 'White'] },
  { id: 'q11', question: 'Metal that is coated with zinc to stop it rusting', answer: 'Iron', fill: 'Galvanised sheets are made of ___ coated with zinc.' },
  { id: 'q12', question: 'Process of coating iron with zinc', answer: 'Galvanisation', also: ['Galvanization'], fill: 'Coating iron with zinc to stop it rusting is called ___.' },
  { id: 'q13', question: 'Law that requires a chemical equation to be balanced', answer: 'Law of conservation of mass', fill: 'A chemical equation is balanced because of the ___.' },
  { id: 'q14', question: 'Symbol written after a formula to show a gas', answer: '(g)', wrong: ['(s)', '(l)', '(aq)'] },
  { id: 'q15', question: 'Rusting is a chemical change', answer: 'True' },
];
const seeds = Array.from({ length: 40 }, (_, i) => i * 7919 + 1);

describe('shared rules', () => {
  it('compares typed answers the way a student expects', () => {
    expect(sameAnswer('law of conservation of MASS.', 'Law of conservation of mass')).toBe(true);
    expect(sameAnswer('  carbon-dioxide ', 'Carbon dioxide')).toBe(true);
    expect(sameAnswer('Café', 'cafe')).toBe(true);
    expect(sameAnswer('', '')).toBe(false);
    expect(sameAnswer('Oxygen', 'Nitrogen')).toBe(false);
  });

  it('turns answers into grid letters, or refuses, and uses another accepted answer when the answer does not fit', () => {
    expect(gridWord('Carbon dioxide')).toBe('CARBONDIOXIDE');
    expect(gridWord("Newton's")).toBe('NEWTONS');
    expect(gridWord('Café')).toBe('CAFE');
    expect(gridWord('X-ray')).toBe('XRAY');
    for (const bad of ['H2O', '(g)', 'f = R/2', 'नाइट्रोजन', '6.022', '']) expect(gridWord(bad), bad).toBeNull();
    expect(enumeration('Balanced equation')).toBe('(8, 8)');
    expect(enumeration('X-ray')).toBe('(1, 3)');
    // a word search takes at most 15 letters: "Exothermic reaction" is 18, so its other answer goes in
    expect(gridForm(CHEM[5], 3, 15)).toEqual({ text: 'Exothermic', word: 'EXOTHERMIC' });
    expect(gridForm(CHEM[5], 3, 25)).toEqual({ text: 'Exothermic reaction', word: 'EXOTHERMICREACTION' });
    expect(gridForm({ answer: 'H2O', also: ['Water'] }, 3, 15)?.word).toBe('WATER');
  });

  it('gives the same puzzle for the same seed, and others for other seeds', () => {
    for (const type of ['matching', 'fill', 'wordsearch', 'crossword', 'choice'] as const) {
      const a = makeGame(type, CHEM, 42);
      expect(a, type).not.toBeNull();
      expect(makeGame(type, CHEM, 42), type).toEqual(a);
      const others = seeds.map((s) => JSON.stringify(makeGame(type, CHEM, s)));
      expect(new Set(others).size, type).toBeGreaterThan(30);
    }
    expect(seedOf('student-1|2026-10-09|CBSE10SCI01T01')).toBe(seedOf('student-1|2026-10-09|CBSE10SCI01T01'));
    expect(seedOf('a')).not.toBe(seedOf('b'));
  });

  it('says which games each question can go in, from what was written for it', () => {
    expect(usableIn(CHEM[0])).toEqual(['crossword', 'wordsearch', 'matching', 'fill', 'choice']);
    expect(usableIn(CHEM[7])).toEqual(['crossword', 'wordsearch', 'matching', 'fill']); // no wrong options
    expect(usableIn(CHEM[8])).toEqual(['crossword', 'wordsearch', 'matching', 'fill']); // ___ in the question itself
    expect(usableIn(CHEM[9])).toEqual(['crossword', 'wordsearch', 'matching', 'choice']); // no fill-in sentence
    expect(usableIn(CHEM[13])).toEqual(['matching', 'choice']); // "(g)" has no letters for a grid
    expect(usableIn(CHEM[14])).toEqual(['choice']); // True/False
    expect(usableIn({ id: 'x', question: 'Mitochondria are the powerhouse of the cell', answer: 'Mitochondria' })).toEqual([]); // gives itself away
  });
});

describe('making games from real questions', () => {
  it('matching: unique answers, shuffled, never in question order, no True/False', () => {
    for (const s of seeds) {
      const g = makeMatching(CHEM.slice(0, 14), rng(s))!;
      expect(checkMatching(g, CHEM)).toEqual([]);
      expect(g.left.length).toBe(8);
    }
    const twins = items([['Q1', 'Iron'], ['Q2', 'iron'], ['Q3', 'Zinc'], ['Q4', 'Copper']]);
    expect(makeGame('matching', twins, 1)!.right.map((x) => x.text).filter((t) => t.toLowerCase() === 'iron')).toHaveLength(1);
    expect(makeGame('matching', items([['a', '1'], ['b', '2']]), 1)).toBeNull();
    for (const s of seeds) expect(makeGame('matching', CHEM, s)!.right.some((x) => x.text === 'True')).toBe(false);
  });

  it('fill in the blank: only the sentences the writer wrote, with their one ___', () => {
    for (const s of seeds) {
      const g = makeGame('fill', CHEM, s)!;
      expect(checkFill(g, CHEM)).toEqual([]);
      expect(g.rows.every((r) => !['q7', 'q10', 'q14', 'q15'].includes(r.id))).toBe(true); // nothing written for these
    }
    const g = makeGame('fill', CHEM.filter((it) => ['q3', 'q9'].includes(it.id)), 1)!;
    expect(g.rows.find((r) => r.id === 'q9')).toMatchObject({ before: 'Fats and oils go ', after: ' when they are oxidised' });
    expect(g.rows.find((r) => r.id === 'q3')).toMatchObject({ before: 'Chip packets are filled with ', after: ' gas to keep the chips fresh.', also: ['N2'] });
    // no fill-in sentence, a sentence that still shows the answer, or two blanks: not used
    expect(makeGame('fill', items([['SI unit of force?', 'Newton']]), 1)).toBeNull();
    expect(makeGame('fill', [{ id: 'a', question: 'Q', answer: 'iron', fill: 'Iron rusts when ___ meets water' }], 1)).toBeNull();
    expect(makeGame('fill', items([['The ___ and the ___', 'x']]), 1)).toBeNull();
  });

  it('word search: forwards only, letters only, each word findable once, nothing rude in the filler', () => {
    for (const s of seeds) {
      const g = makeWordSearch(CHEM, rng(s));
      if (!g) continue;
      expect(checkWordSearch(g, CHEM)).toEqual([]);
      for (const w of g.words) expect(occurrences(g.grid, w.word).size).toBe(1);
      expect(rudeWords(g.grid, g.words)).toEqual([]);
    }
    const nested = items([['a', 'Ion'], ['b', 'Ionic'], ['c', 'Atom'], ['d', 'Molecule'], ['e', 'Proton']]);
    const g = makeGame('wordsearch', nested, 5)!;
    const words = g.words.map((w) => w.word);
    expect(words.includes('ION') && words.includes('IONIC')).toBe(false);
  });

  it('word search: answers up to 15 letters go in, and filler comes from the words\' own letters', () => {
    const long = items([['a', 'Transpiration'], ['b', 'Photosynthesis'], ['c', 'Chlorophyll'], ['d', 'Mitochondria'], ['e', 'Stomata']]);
    const g = makeGame('wordsearch', long, 1)!;
    expect(g.words.map((w) => w.word)).toContain('PHOTOSYNTHESIS');
    const hidden = new Set(g.words.flatMap((w) => [...w.word]));
    const cells = new Set(g.words.flatMap((w) => Array.from({ length: w.word.length }, (_, k) => `${w.row + w.dr * k},${w.col + w.dc * k}`)));
    for (let r = 0; r < g.size; r++) for (let c = 0; c < g.size; c++) if (!cells.has(`${r},${c}`)) expect(hidden.has(g.grid[r][c])).toBe(true);
  });

  it('word search: no rude word in the filler, in thousands of grids of real words (an answer may contain one, as ASSAM does)', () => {
    const vocab = 'atom molecule proton neutron electron nucleus isotope element compound mixture solution solvent solute acid base salt oxidation reduction corrosion rusting catalyst enzyme respiration chlorophyll stomata xylem phloem ribosome chromosome gene mitosis meiosis zygote embryo pollen ovary hormone insulin neuron reflex friction gravity inertia momentum velocity force pressure energy power joule newton watt volt ampere magnet compass refraction reflection lens mirror prism spectrum democracy parliament monsoon plateau delta estuary latitude equator glacier erosion volcano assam essex sussex'.split(' ');
    for (let s = 0; s < 400; s++) {
      const r = rng(s + 1);
      const pick = vocab.map((w) => ({ w, k: r() })).sort((a, b) => a.k - b.k).slice(0, 10).map((x) => x.w);
      const g = makeGame('wordsearch', items(pick.map((w, i) => [`Clue ${i}`, w])), s);
      if (g) expect(rudeWords(g.grid, g.words), `seed ${s}`).toEqual([]);
    }
    expect(RUDE.every((w) => /^[A-Z]+$/.test(w))).toBe(true);
  });

  it('crossword: interlocking, numbered, at most 15 wide; long answers go down', () => {
    let made = 0;
    for (const s of seeds) {
      const g = makeCrossword(CHEM, rng(s));
      if (!g) continue;
      made++;
      expect(checkCrossword(g, CHEM)).toEqual([]);
      expect(g.rows).toBeLessThanOrEqual(CROSSWORD.maxRows);
      expect(g.cols).toBeLessThanOrEqual(CROSSWORD.maxCols);
      for (const c of g.clues) if (c.answer.length > CROSSWORD.maxAcross) expect(c.dir).toBe('down');
    }
    expect(made).toBe(seeds.length);
    const noShared = items([['a', 'Ox'], ['b', 'Zinc'], ['c', 'Pyx'], ['d', 'Bud']]);
    expect(makeGame('crossword', noShared, 1)).toBeNull(); // they can't cross: no crossword rather than a wrong one
  });

  it('crossword: a chapter of long answers all goes in (it used to keep 3 of 7)', () => {
    const chem = items(['Law of conservation of mass', 'Combination reaction', 'Decomposition reaction', 'Displacement reaction', 'Precipitate', 'Oxidation', 'Rancidity'].map((a, i) => [`Clue ${i}`, a]));
    for (const s of seeds.slice(0, 10)) expect(makeGame('crossword', chem, s)!.clues).toHaveLength(7);
  });

  it("multiple choice: only the writer's own wrong options, the answer once, True/False its other", () => {
    for (const s of seeds) {
      const g = makeGame('choice', CHEM, s)!;
      expect(checkChoice(g, CHEM)).toEqual([]);
      for (const r of g.rows) {
        expect(r.options.filter((o) => o === r.answer)).toHaveLength(1);
        const it = CHEM.find((x) => x.id === r.id)!;
        if (it.answer === 'True') expect([...r.options].sort()).toEqual(['False', 'True']);
        else expect(r.options.filter((o) => o !== r.answer).every((o) => it.wrong!.includes(o))).toBe(true);
      }
      expect(g.rows.some((r) => ['q8', 'q9', 'q11', 'q12', 'q13'].includes(r.id))).toBe(false); // no wrong options written
    }
    // repeats, and options that count as the answer, are dropped
    const mcq: Item[] = [{ id: 'm1', question: 'Gas in chip packets', answer: 'Nitrogen', also: ['N2'], wrong: ['Oxygen', 'oxygen', 'NITROGEN', 'n2', 'Hydrogen'] }];
    expect([...makeGame('choice', mcq, 1)!.rows[0].options].sort()).toEqual(['Hydrogen', 'Nitrogen', 'Oxygen']);
    expect(makeGame('choice', items([['Capital of France', 'Paris'], ['Capital of Italy', 'Rome']]), 1)).toBeNull(); // nothing borrowed
  });

  it('falls back to the next game, and only gives up when nothing can be made', () => {
    const hindi = items([['पानी का सूत्र', 'एच टू ओ'], ['नमक', 'सोडियम क्लोराइड'], ['लोहा', 'आयरन']]);
    expect(makePuzzle(hindi, 1)?.type).toBe('matching');
    expect(makePuzzle([{ id: 'a', question: 'SI unit of force', answer: 'Newton', fill: 'The SI unit of force is the ___.' }], 1)?.type).toBe('fill');
    expect(makePuzzle(items([['The Sun is a star', 'True']]), 1)?.type).toBe('choice');
    expect(makePuzzle(items([['SI unit of force', 'Newton']]), 1)).toBeNull();
    expect(makePuzzle([], 1)).toBeNull();
    expect(makePuzzle(CHEM, 1, ['wordsearch', 'crossword'])?.type).toBe('wordsearch');
  });
});

// Each checker is shown a correct puzzle with one thing broken, and must catch it. If a checker missed a kind of
// mistake, the stress tests would prove nothing, so every rule is tested here.
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
    const pool = CHEM.slice(0, 14);
    const good = makeGame('matching', pool, 1)!;
    caught<Matching>(good, (g) => checkMatching(g, pool), {
      'answer swapped for another question\'s': (g) => { g.right[0] = { id: g.right[0].id, text: 'Zinc' }; },
      'question text changed': (g) => { g.left[0].text += '?'; },
      'answer from outside the round': (g) => { g.right[0].id = 'q13'; g.right[0].text = CHEM[12].answer; },
      'one side shorter': (g) => { g.right.pop(); },
      'pair repeated': (g) => { g.left[1] = g.left[0]; },
      'two answers the same': (g) => { const extra = { id: 'dup', question: 'Q', answer: g.right[0].text }; pool.push(extra); g.left.push({ id: 'dup', text: 'Q' }); g.right.push({ id: 'dup', text: extra.answer }); },
      'left in the same order': (g) => { g.right = g.left.map((x) => ({ id: x.id, text: pool.find((it) => it.id === x.id)!.answer })); },
      'too few pairs': (g) => { g.left = g.left.slice(0, 2); g.right = g.right.filter((x) => g.left.some((l) => l.id === x.id)); },
    });
  });

  it('fill in the blank', () => {
    const good = makeGame('fill', CHEM, 2)!;
    caught<FillIn>(good, (g) => checkFill(g, CHEM), {
      'wrong answer': (g) => { g.rows[0].answer = 'Zinc'; },
      'other answers changed': (g) => { g.rows[0].also = ['Anything']; },
      'text changed': (g) => { g.rows[0].before = `Not ${g.rows[0].before}`; },
      'gap moved': (g) => { g.rows[0].before = g.rows[0].before.slice(0, -2); },
      'answer still showing': (g) => { g.rows[0].after += ` ${g.rows[0].answer}`; },
      'second gap': (g) => { g.rows[0].before = `___ ${g.rows[0].before}`; },
      'unknown question': (g) => { g.rows[0].id = 'nope'; },
      'repeated question': (g) => { g.rows[1] = g.rows[0]; },
      'a question with no fill-in sentence': (g) => { g.rows[0].id = 'q10'; },
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
    /** Writes a word into a free run of filler, where it doesn't touch the hidden words. */
    const writeInFiller = (g: WordSearch, word: string) => {
      const used = new Set(g.words.flatMap((x) => Array.from({ length: x.word.length }, (_, k) => `${x.row + x.dr * k},${x.col + x.dc * k}`)));
      for (let r = 0; r < g.size; r++) {
        for (let c = 0; c + word.length <= g.size; c++) {
          if ([...word].every((_, k) => !used.has(`${r},${c + k}`))) { [...word].forEach((ch, k) => flip(g, r, c + k, ch)); return; }
        }
      }
    };
    caught<WordSearch>(good, (g) => checkWordSearch(g, CHEM), {
      'a letter of a word changed': (g) => flip(g, w0.row, w0.col),
      'word said to be somewhere else': (g) => { g.words[0].col = (g.words[0].col + 1) % g.size; },
      'backwards direction': (g) => { const w = g.words[0]; w.col += (w.word.length - 1) * w.dc; w.row += (w.word.length - 1) * w.dr; w.dr = -w.dr; w.dc = -w.dc; },
      'word written a second time': (g) => writeInFiller(g, [...g.words].sort((a, b) => a.word.length - b.word.length)[0].word),
      'a rude word in the filler': (g) => writeInFiller(g, 'SHIT'),
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
      'too wide': (g) => { g.cols = 16; },
      'too tall': (g) => { g.rows = 26; },
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
    // an answer longer than 15 letters can't go across
    const across: Crossword = { type: 'crossword', rows: 1, cols: 16, grid: ['ABCDEFGHIJKLMNOP'], clues: [{ id: 'a', n: 1, dir: 'across', row: 0, col: 0, answer: 'ABCDEFGHIJKLMNOP', clue: 'A', enumeration: '(16)' }] };
    expect(checkCrossword(across, [{ id: 'a', question: 'A', answer: 'Abcdefghijklmnop' }]).some((p) => /too long to go across|16/.test(p))).toBe(true);
  });

  it('multiple choice', () => {
    const good = makeGame('choice', CHEM, 4)!;
    const i = good.rows.findIndex((r) => r.id !== 'q15');
    caught<Choice>(good, (g) => checkChoice(g, CHEM), {
      'answer missing from the options': (g) => { g.rows[i].options = g.rows[i].options.filter((o) => o !== g.rows[i].answer).concat('Zinc'); },
      'answer twice': (g) => { g.rows[0].options.push(g.rows[0].answer); },
      'two options the same': (g) => { g.rows[0].options.push(g.rows[0].options.find((o) => o !== g.rows[0].answer)!.toUpperCase()); },
      'option from nowhere': (g) => { g.rows[i].options[g.rows[i].options.findIndex((o) => o !== g.rows[i].answer)] = 'Helium'; },
      'option borrowed from another question': (g) => { g.rows[i].options[g.rows[i].options.findIndex((o) => o !== g.rows[i].answer)] = 'Precipitate'; },
      'wrong answer': (g) => { g.rows[0].answer = 'Zinc'; },
      'question changed': (g) => { g.rows[0].question += '?'; },
      'unknown question': (g) => { g.rows[0].id = 'nope'; },
      'repeated question': (g) => { g.rows[1] = g.rows[0]; },
      'one option only': (g) => { g.rows[0].options = [g.rows[0].answer]; },
    });
  });

  it('checkGame sends each puzzle to its own checker', () => {
    for (const type of ['matching', 'fill', 'wordsearch', 'crossword', 'choice'] as const) expect(checkGame(makeGame(type, CHEM, 11)!, CHEM)).toEqual([]);
  });
});
