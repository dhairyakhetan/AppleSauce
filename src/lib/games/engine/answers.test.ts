import { describe, expect, it } from 'vitest';
import { mark, sameAnswer } from './answers';

/* Typed answers are marked strictly: right only when they are the answer or one of the other answers the writer wrote
   (Also lines), half a point for a small spelling slip, and nothing guessed. Each case below is one a teacher or
   student would actually meet, in some subject. */

const m = (typed: string, answer: string, also: string[] = [], others: string[] = []) =>
  mark(typed, { answer, also }, others.map((a) => ({ answer: a })));

describe('right', () => {
  it('the answer, whatever the case, spaces, hyphens, punctuation, dashes and Latin accents', () => {
    for (const t of ['carbondioxide', '  carbon-dioxide ', 'CARBON DIOXIDE.', 'Carbon  Dioxide!']) expect(m(t, 'Carbon dioxide'), t).toBe('right');
    expect(m('law of conservation of MASS.', 'Law of conservation of mass')).toBe('right');
    expect(m('Café', 'cafe')).toBe('right');
    expect(m("Newtons", "Newton's")).toBe('right');
    expect(m('-5', '−5')).toBe('right'); // a typed minus and the minus sign Word puts in
    expect(m('100°C', '100 °C')).toBe('right');
    expect(m('x+y', 'x + y')).toBe('right');
    expect(m('1,00,000', '100000')).toBe('right'); // commas between digits
  });

  it('another answer the writer wrote, and a, an or the at the start', () => {
    expect(m('cpu', 'Central Processing Unit', ['CPU'])).toBe('right');
    expect(m('Calcutta', 'Kolkata', ['Calcutta'])).toBe('right');
    expect(m('Decomposition', 'Decomposition reaction', ['Decomposition'])).toBe('right');
    expect(m('The Himalayas', 'Himalayas')).toBe('right');
    expect(m('Himalayas', 'The Himalayas')).toBe('right');
    expect(m('a simile', 'Simile')).toBe('right');
  });

  it('any script, as written', () => {
    expect(m('নাইট্রোজেন', 'নাইট্রোজেন')).toBe('right');
    expect(m('नाइट्रोजन', 'नाइट्रोजन')).toBe('right');
  });
});

describe('wrong: nothing the writer didn\'t write counts', () => {
  it('a word left out, unless an Also line allows it', () => {
    expect(m('Decomposition', 'Decomposition reaction')).toBe('wrong');
    expect(m('Vitamin', 'Vitamin A')).toBe('wrong');
    expect(m('World War', 'World War I')).toBe('wrong');
    expect(m('Dalhousie', 'Lord Dalhousie')).toBe('wrong');
    expect(m('Lord Dalhousie', 'Dalhousie')).toBe('wrong');
    expect(m('Nitrogen gas', 'Nitrogen')).toBe('wrong');
  });

  it('any short form or initials not written down', () => {
    expect(m('CPU', 'Central Processing Unit')).toBe('wrong');
    expect(m('Read Access Memory', 'RAM')).toBe('wrong');
    expect(m('CO', 'Calcium Oxide')).toBe('wrong');
    expect(m('LCM', 'Law of conservation of mass')).toBe('wrong');
  });

  it('numbers exactly as written: no values, no word forms', () => {
    expect(m('5', '−5')).toBe('wrong');
    expect(m('35', '3.5')).toBe('wrong');
    expect(m('34', '3, 4')).toBe('wrong');
    expect(m('102', '10^2')).toBe('wrong');
    expect(m('0.75', '3/4')).toBe('wrong'); // "Write 0.75 as a fraction": 0.75 is not the answer
    expect(m('eight', '8')).toBe('wrong');
    expect(m('8', '8', ['Eight'])).toBe('right');
    expect(m('Eight', '8', ['Eight'])).toBe('right');
  });

  it('empty, or only punctuation', () => {
    expect(m('', 'Simile')).toBe('wrong');
    expect(m('  ...  ', 'Simile')).toBe('wrong');
  });
});

describe('almost: half a point for a spelling slip, and only that', () => {
  it('one letter missing, extra or swapped with the next, in a word of 5 letters or more', () => {
    for (const [t, a] of [['Photosynthsis', 'Photosynthesis'], ['Mitochondira', 'Mitochondria'], ['Chlorophyl', 'Chlorophyll'], ['Exotehrmic', 'Exothermic'], ['Galvanisatoin', 'Galvanisation'], ['Thar Desrt', 'Thar Desert']]) {
      expect(m(t, a), t).toBe('almost');
    }
  });

  it("never a letter changed for another: that is usually another word (Science, Geography, History, English)", () => {
    for (const [t, a] of [
      ['Endothermic', 'Exothermic'], ['Alkene', 'Alkane'], ['Ethyne', 'Ethene'], ['Nitrite', 'Nitrate'], ['Sodium sulphate', 'Sodium sulphite'],
      ['Sodium chlorite', 'Sodium chloride'], ['Hypotonic', 'Hypertonic'], ['Afferent', 'Efferent'], ['Ilium', 'Ileum'], ['Fusion', 'Fission'],
      ['Eastern Ghats', 'Western Ghats'], ['Microeconomics', 'Macroeconomics'], ['drank', 'drink'], ['effect', 'affect'], ['Inhalation', 'Exhalation'],
    ]) expect(m(t, a), `${t} for ${a}`).toBe('wrong');
  });

  it('never at the first letter, never in a short word, a number or a Roman numeral', () => {
    for (const [t, a] of [
      ['Abiotic', 'Biotic'], ['Unsaturated', 'Saturated'], ['Indirect tax', 'Direct tax'], ['itochondria', 'Mitochondria'],
      ['Vitamin D', 'Vitamin K'], ['Chandragupta I', 'Chandragupta II'], ['Louis XIV', 'Louis XVI'], ['XXXVII', 'XXXVIII'],
      ['Ion', 'Iron'], ['1875', '1857'], ['১০০০১', '১০০০০'], ['World War II', 'World War I'],
    ]) expect(m(t, a), `${t} for ${a}`).toBe('wrong');
  });

  it("never when what was typed is another answer in the same round", () => {
    expect(m('Combination reaction', 'Combination reactoin', [], ['Combination reaction'])).toBe('wrong');
    expect(m('Conduction', 'Convection', [], ['Conduction'])).toBe('wrong');
  });

  it('a slip in an Also answer counts too', () => {
    expect(m('Decompositon', 'Decomposition reaction', ['Decomposition'])).toBe('almost');
  });
});

describe('sameAnswer', () => {
  it('is the comparison the checker uses for Also and Wrong lines', () => {
    expect(sameAnswer('Oxygen', 'oxygen.')).toBe(true);
    expect(sameAnswer('The Himalayas', 'Himalayas')).toBe(true);
    expect(sameAnswer('Floodplain', 'Flood plain')).toBe(true);
    expect(sameAnswer('Oxygen', 'Ozone')).toBe(false);
  });
});
