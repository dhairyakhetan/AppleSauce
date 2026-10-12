import { describe, expect, it } from 'vitest';
import { mark, rightForms } from './answers';
import { gridWord, enumeration, loose, shownAnswer } from './shared';

/* Typed answers are marked the way a teacher would, in every subject: what may be left out, what counts as the same,
   and what is only a spelling slip (half a point). */

const m = (typed: string, answer: string, question = '', others: string[] = []) => mark(typed, answer, { question, others });

describe('what may be left out', () => {
  it('words the question already says (Science)', () => {
    const q = 'Reaction in which a single reactant breaks down into simpler products';
    for (const t of ['Decomposition', 'decomposition reaction', 'DECOMPOSITION REACTION.']) expect(m(t, 'Decomposition reaction', q), t).toBe('right');
    expect(m('reaction', 'Decomposition reaction', q)).toBe('wrong');
    expect(m('Combination', 'Decomposition reaction', q)).toBe('wrong');
    // the question doesn't say "reaction": the whole answer is needed
    expect(m('Decomposition', 'Decomposition reaction', 'Splitting of a compound into simpler substances')).toBe('wrong');
    expect(m('Pituitary', 'Pituitary gland', 'Which gland is called the master gland?')).toBe('right');
    expect(m('Exothermic', 'Exothermic reactions', 'Reaction in which heat is given out')).toBe('right');
  });

  it('words in square brackets, in any subject', () => {
    expect(m('Decomposition', 'Decomposition [reaction]', 'Splitting of a compound')).toBe('right');
    expect(m('Decomposition reaction', 'Decomposition [reaction]')).toBe('right');
    expect(m('Nehru', '[Jawaharlal] Nehru', 'First Prime Minister of India')).toBe('right');
    expect(m('Jawaharlal', '[Jawaharlal] Nehru', 'First Prime Minister of India')).toBe('wrong');
    expect(m('5', '[x =] 5', 'Solve 2x + 3 = 13')).toBe('right');
    expect(m('x=5', '[x =] 5', 'Solve 2x + 3 = 13')).toBe('right');
    expect(m('Delhi', '[New] Delhi', 'Capital of India')).toBe('right');
    expect(shownAnswer('Decomposition [reaction]')).toBe('Decomposition reaction');
    expect(shownAnswer('[x =] 5')).toBe('x = 5');
  });

  it('a joining word left at the edge (History, Geography)', () => {
    expect(m('Plassey', 'Battle of Plassey', 'Which battle in 1757 gave the British control of Bengal?')).toBe('right');
    expect(m('of Plassey', 'Battle of Plassey', 'Which battle in 1757 gave the British control of Bengal?')).toBe('right');
    expect(m('Battle', 'Battle of Plassey', 'Which battle in 1757 gave the British control of Bengal?')).toBe('wrong');
    expect(m('Cancer', 'Tropic of Cancer', 'Which tropic passes through the middle of India?')).toBe('right');
    expect(m('Bengal', 'Bay of Bengal', 'Into which water body does the Ganga flow?')).toBe('wrong');
  });

  it('a, an and the, and a title before a name', () => {
    expect(m('Himalayas', 'the Himalayas', 'Highest mountain range in the world')).toBe('right');
    expect(m('the Himalayas', 'Himalayas', 'Highest mountain range in the world')).toBe('right');
    expect(m('a simile', 'Simile', 'Figure of speech that compares using like or as')).toBe('right');
    expect(m('Dalhousie', 'Lord Dalhousie', 'Governor-General who brought in the Doctrine of Lapse')).toBe('right');
    expect(m('Gandhi', 'Mahatma Gandhi', 'Leader of the Dandi March')).toBe('right');
    expect(m('cobra', 'King cobra', 'Longest venomous snake')).toBe('wrong'); // King is not a title here
    expect(m('penguin', 'Emperor penguin', 'Largest penguin')).toBe('wrong');
  });

  it("but not when that leaves nothing to type (English)", () => {
    expect(m('An', 'An', 'Article before a vowel sound: ___ apple')).toBe('right');
    expect(m('The', 'An', 'Article before a vowel sound: ___ apple')).toBe('wrong');
    expect(m('', 'Simile')).toBe('wrong');
    expect(m('  ...  ', 'Simile')).toBe('wrong');
  });
});

describe('what counts as the same', () => {
  it('case, spaces, hyphens, punctuation and Latin accents', () => {
    expect(m('carbondioxide', 'Carbon dioxide')).toBe('right');
    expect(m('  carbon-dioxide ', 'Carbon dioxide')).toBe('right');
    expect(m('law of conservation of MASS.', 'Law of conservation of mass')).toBe('right');
    expect(m('Café', 'cafe')).toBe('right');
    expect(m("Newtons", "Newton's")).toBe('right');
  });

  it('the short form after an answer (Computers, Economics, Chemistry)', () => {
    expect(m('CPU', 'Central Processing Unit (CPU)', 'Brain of the computer')).toBe('right');
    expect(m('central processing unit', 'Central Processing Unit (CPU)', 'Brain of the computer')).toBe('right');
    expect(m('NaCl', 'Sodium chloride (NaCl)', 'Common salt')).toBe('right');
    expect(m('Calcutta', 'Kolkata (Calcutta)', 'Capital of West Bengal')).toBe('right');
    // the question already gives the short form: typing it back isn't the answer
    expect(m('CPU', 'Central Processing Unit (CPU)', 'What is the full form of CPU?')).toBe('wrong');
    expect(m('Central Processing Unit', 'Central Processing Unit (CPU)', 'What is the full form of CPU?')).toBe('right');
    expect(gridWord('Central Processing Unit (CPU)')).toBe('CENTRALPROCESSINGUNIT');
    expect(enumeration('Central Processing Unit (CPU)')).toBe('(7, 10, 4)');
    // brackets that are part of the answer stay
    expect(m('f(x)', 'f(x)')).toBe('right');
    expect(m('g', '(g)')).toBe('right');
  });

  it('short forms from initials, in some cases (Economics, Biology, Civics)', () => {
    expect(m('GDP', 'Gross Domestic Product', 'Total value of goods and services produced in a country in a year')).toBe('right');
    expect(m('gdp', 'Gross Domestic Product', 'Total value of goods and services produced in a country in a year')).toBe('right');
    expect(m('RBC', 'Red blood cell', 'Cell that carries oxygen in the blood')).toBe('right');
    expect(m('GST', 'Goods and Services Tax', 'Single tax on the supply of goods and services in India')).toBe('right');
    expect(m('UN', 'United Nations', 'Body formed in 1945 to keep world peace')).toBe('right');
    expect(m('BE', 'Balanced equation', 'Equation with equal atoms on both sides')).toBe('wrong'); // two plain words: not a short form
    expect(m('GDP', 'Gross Domestic Product', 'What is the full form of GDP?')).toBe('wrong'); // the question says it
    // a short form as the answer: the words it stands for count
    expect(m('Goods and Services Tax', 'GST', 'Tax brought in across India in 2017')).toBe('right');
    expect(m('central processing unit', 'CPU', 'Brain of the computer')).toBe('right');
    expect(m('Central Unit', 'CPU', 'Brain of the computer')).toBe('wrong');
  });

  it('numbers by their value (Maths, History, EVS)', () => {
    expect(m('0.75', '3/4')).toBe('right');
    expect(m('3 / 4', '0.75')).toBe('right');
    expect(m('.5', '1/2')).toBe('right');
    expect(m('1000', '1,000')).toBe('right');
    expect(m('100000', '1,00,000')).toBe('right'); // Indian grouping
    expect(m('8', 'Eight', 'How many legs does a spider have?')).toBe('right');
    expect(m('twenty-five', '25')).toBe('right');
    expect(m('twenty five', '25')).toBe('right');
    expect(m('5', '-5')).toBe('wrong');
    expect(m('-5', '-5')).toBe('right');
    expect(m('1875', '1857')).toBe('wrong'); // no slips in numbers
    expect(m('1857', '1857')).toBe('right');
    expect(m('3,4', '34')).toBe('wrong');
    expect(m('2.50', '2.5')).toBe('right');
  });

  it('units given as symbols (Maths, Geography, Physics)', () => {
    for (const t of ['90', '90°', '90 degrees', '90 degree']) expect(m(t, '90°', 'Each angle of a rectangle'), t).toBe('right');
    expect(m('50 percent', '50%')).toBe('right');
    expect(m('50 per cent', '50%')).toBe('right');
    expect(m('50', '50%')).toBe('right');
    expect(m('9.8 m/s2', '9.8 m/s²')).toBe('right');
    expect(m('5cm', '5 cm')).toBe('right');
    expect(m('5', '5 cm')).toBe('wrong');
  });

  it('Hindi, Bengali and other scripts: vowel signs count', () => {
    expect(m('प्रकाश संश्लेषण', 'प्रकाश संश्लेषण')).toBe('right');
    expect(m('काम', 'कम')).toBe('wrong'); // different words, different only by a vowel sign
    expect(loose('कमल')).not.toBe(loose('कमला'));
    expect(m('রবীন্দ্রনাথ ঠাকুর', 'রবীন্দ্রনাথ ঠাকুর')).toBe('right');
    expect(m('ঠাকুর', 'রবীন্দ্রনাথ ঠাকুর', 'রবীন্দ্রনাথ কে ছিলেন?')).toBe('right'); // the question says রবীন্দ্রনাথ
  });
});

describe('a spelling slip is almost (half a point)', () => {
  it('one letter in 5 to 9 letters, two in 10 or more', () => {
    expect(m('Decompositon', 'Decomposition reaction', 'Reaction in which a compound breaks down')).toBe('almost');
    expect(m('Photosynthsis', 'Photosynthesis')).toBe('almost');
    expect(m('Fotosynthsis', 'Photosynthesis')).toBe('wrong'); // three letters out
    expect(m('Mitochondira', 'Mitochondria')).toBe('almost'); // two letters swapped
    expect(m('Oxidaton', 'Oxidation')).toBe('almost');
    expect(m('Shakespear', 'William Shakespeare', 'Who wrote Hamlet?')).toBe('wrong'); // William is needed
    expect(m('Shakespear', '[William] Shakespeare', 'Who wrote Hamlet?')).toBe('almost');
  });

  it('never in short answers, numbers, or when it is another answer in the round', () => {
    expect(m('Ion', 'Iron')).toBe('wrong');
    expect(m('Meiosis', 'Mitosis')).toBe('wrong');
    expect(m('1947', '1974')).toBe('wrong');
    expect(m('Isotone', 'Isotope')).toBe('almost');
    expect(m('Isotone', 'Isotope', '', ['Isotope', 'Isotone'])).toBe('wrong');
  });

  it('keeps the work small even with many optional words', () => {
    expect(rightForms('[a] [b] [c] [d] [e] [f] [g] [h] [i] [j] [k] [l] word').size).toBeLessThan(5000);
  });
});
