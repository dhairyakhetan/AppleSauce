import { describe, expect, it } from 'vitest';
import { looksLikeCurrency, reassemble, segmentBody, segmentToRaw, type BodySegment } from './math-segments';

/** Every case here must reassemble byte-identically -- that is the one
 *  guarantee (D76) this module exists to protect. */
function expectRoundTrip(body: string) {
  const result = segmentBody(body);
  expect(reassemble(result.segments)).toBe(body);
  return result;
}

describe('segmentBody: round trip on real-shaped bodies', () => {
  it('the owner\'s example: a fraction equation', () => {
    const body = '15. Solve and verify your answer: $$\\frac{2x}{3} + 6 = -4 + \\frac{x}{9}$$';
    const r = expectRoundTrip(body);
    expect(r.fallback).toBe(false);
    expect(r.segments.filter((s) => s.kind === 'math')).toHaveLength(1);
    const math = r.segments.find((s) => s.kind === 'math')!;
    expect(math.kind === 'math' && math.display).toBe(true);
  });

  it('a quadratic with inline maths either side', () => {
    const body = 'Solve for $x$ and verify your answer: $$2x^2 - 7x + 3 = 0$$ Answer: $x = 3$ or $x = \\frac{1}{2}$';
    const r = expectRoundTrip(body);
    expect(r.fallback).toBe(false);
    // $x$, $$2x^2-7x+3=0$$, $x=3$, $x=\frac{1}{2}$ -- four separate spans.
    expect(r.segments.filter((s) => s.kind === 'math')).toHaveLength(4);
  });

  it('powers and roots', () => {
    expectRoundTrip('Simplify $\\sqrt[3]{27} + 2^{4}$ and show your steps.');
  });

  it('a matrix in display maths', () => {
    const body =
      'Find the inverse of the matrix $$A = \\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}$$ and verify $AA^{-1} = I$.';
    expectRoundTrip(body);
  });

  it('chemistry mhchem inside inline maths', () => {
    const body = 'Balance the equation $\\ce{2H2 + O2 -> 2H2O}$ and name the reaction type.';
    const r = expectRoundTrip(body);
    expect(r.fallback).toBe(false);
  });

  it('\\( \\) and \\[ \\] delimiter forms', () => {
    expectRoundTrip('The slope is \\(m = 2\\) so the line is \\[y = 2x + 3\\] through the origin.');
  });

  it('Hindi text around a formula', () => {
    expectRoundTrip('दिए गए समीकरण को हल करें $x + 5 = 12$ और अपने उत्तर की जांच करें।');
  });

  it('Bengali text around a formula', () => {
    expectRoundTrip('প্রদত্ত সমীকরণটি সমাধান করো $x + 5 = 12$ এবং তোমার উত্তর যাচাই করো।');
  });

  it('a pipe table with a formula in a cell', () => {
    const body = '| Class | Value |\n| --- | --- |\n| VI | $x=2$ |\n| VII | 22 |';
    expectRoundTrip(body);
  });

  it('tabs and newlines', () => {
    expectRoundTrip('Q1.\tState the formula.\n\n$$F = ma$$\n\tAnswer here.');
  });

  it('CRLF line endings', () => {
    expectRoundTrip('Line one\r\nLine two: $x^2$\r\nLine three');
  });

  it('escaped dollar next to real maths', () => {
    const body = 'Price is \\$5 today; compute $x + 2$ tomorrow.';
    const r = expectRoundTrip(body);
    expect(r.fallback).toBe(false);
    const math = r.segments.filter((s) => s.kind === 'math');
    expect(math).toHaveLength(1);
    expect(math[0].kind === 'math' && math[0].inner).toBe('x + 2');
  });

  it('multiple escaped dollars and no real maths at all', () => {
    const body = 'It cost \\$5, then \\$10, then \\$15.';
    const r = expectRoundTrip(body);
    expect(r.fallback).toBe(false);
    expect(r.segments.every((s) => s.kind === 'text')).toBe(true);
  });

  it('plain text with no maths at all', () => {
    const body = 'State two uses of a lever in daily life.';
    const r = expectRoundTrip(body);
    expect(r.fallback).toBe(false);
    expect(r.segments).toEqual([{ kind: 'text', value: body }]);
  });

  it('empty body', () => {
    const r = expectRoundTrip('');
    expect(r.fallback).toBe(false);
    expect(r.segments).toEqual([]);
  });
});

describe('segmentBody: currency heuristic', () => {
  it('"$5 and $10" reads as prose, not maths', () => {
    const body = 'The price rose from $5 and $10 over the year.';
    const r = expectRoundTrip(body);
    expect(r.fallback).toBe(false);
    expect(r.segments.every((s) => s.kind === 'text')).toBe(true);
  });

  it('currency followed later by real maths still finds the maths', () => {
    const body = 'It costs $5 and profit is $x^2$ rupees.';
    const r = expectRoundTrip(body);
    expect(r.fallback).toBe(false);
    const math = r.segments.filter((s) => s.kind === 'math');
    expect(math).toHaveLength(1);
    expect(math[0].kind === 'math' && math[0].inner).toBe('x^2');
  });

  it('a bare single-token amount like "$5" (no other $) is unbalanced, falls back', () => {
    const r = segmentBody('The book costs $5 only.');
    expect(r.fallback).toBe(true);
    expect(r.segments).toEqual([{ kind: 'text', value: 'The book costs $5 only.' }]);
  });

  it('looksLikeCurrency: direct unit cases', () => {
    expect(looksLikeCurrency('5 and 10')).toBe(true);
    expect(looksLikeCurrency('x+2')).toBe(false);
    expect(looksLikeCurrency('x')).toBe(false);
    expect(looksLikeCurrency('5')).toBe(false);
    expect(looksLikeCurrency('x^2')).toBe(false);
    expect(looksLikeCurrency('a = b')).toBe(false);
    expect(looksLikeCurrency('\\frac{1}{2}')).toBe(false);
    expect(looksLikeCurrency('')).toBe(true);
  });
});

describe('segmentBody: unbalanced delimiters fall back to plain text', () => {
  const cases: Array<[string, string]> = [
    ['unterminated display maths', 'Solve $$x + 1 = 2 for x.'],
    ['unterminated \\[', 'Solve \\[x + 1 = 2 for x.'],
    ['unterminated \\(', 'The slope is \\(m = 2 for the line.'],
    ['a single unmatched $', 'That costs $5 only, no closing sign.'],
  ];
  for (const [label, body] of cases) {
    it(label, () => {
      const r = segmentBody(body);
      expect(r.fallback).toBe(true);
      expect(r.segments).toEqual([{ kind: 'text', value: body }]);
      expect(reassemble(r.segments)).toBe(body);
    });
  }
});

describe('segmentToRaw', () => {
  it('reconstructs a math segment with its delimiters', () => {
    const seg: BodySegment = { kind: 'math', open: '$$', close: '$$', inner: 'x^2', display: true };
    expect(segmentToRaw(seg)).toBe('$$x^2$$');
  });
  it('reconstructs a text segment as-is', () => {
    const seg: BodySegment = { kind: 'text', value: 'hello' };
    expect(segmentToRaw(seg)).toBe('hello');
  });
});

/* ---------------------------------------------------------------------------
 * Property / fuzz test: build many random-ish bodies out of known-good text
 * and math fragments (so we know ahead of time whether the result SHOULD be
 * balanced), across a fixed seed for reproducibility, and assert the one
 * invariant that matters: reassembly is always byte-identical to the input,
 * whatever segmentBody() decided about fallback. */
describe('segmentBody: property test over many generated bodies', () => {
  // Deterministic PRNG (mulberry32) -- no external fuzz dependency needed,
  // and a fixed seed means a failure is always reproducible.
  function mulberry32(seed: number) {
    return function rand() {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const TEXT_FRAGMENTS = [
    'State the reason. ',
    'Find the value of the unknown.\n',
    'नमस्ते, ',
    'উত্তর লেখো ',
    'Tab\there\t',
    'Line one\r\nLine two\r\n',
    'Answer in one sentence: ',
    '(a) first part ',
    'Price is \\$5 today. ',
  ];
  const MATH_FRAGMENTS = [
    '$x^2$',
    '$$\\frac{2x}{3} + 6 = -4$$',
    '\\(m = 2\\)',
    '\\[y = 2x + 3\\]',
    '$\\sqrt[3]{27}$',
    '$\\ce{2H2 + O2 -> 2H2O}$',
    '$$\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}$$',
  ];

  const rand = mulberry32(20260928);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

  for (let trial = 0; trial < 200; trial++) {
    const partCount = 1 + Math.floor(rand() * 8);
    let body = '';
    for (let p = 0; p < partCount; p++) {
      body += rand() < 0.5 ? pick(TEXT_FRAGMENTS) : pick(MATH_FRAGMENTS);
    }
    it(`trial ${trial}: reassembly is byte-identical`, () => {
      const r = segmentBody(body);
      expect(reassemble(r.segments)).toBe(body);
    });
  }
});
