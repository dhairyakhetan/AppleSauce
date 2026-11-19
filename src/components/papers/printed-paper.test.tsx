import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  OptionList,
  OrDivider,
  PaperHeader,
  PaperSurface,
  QuestionMeta,
  QuestionRow,
  SectionTitle,
} from '@/components/papers/printed-paper';
import { substituteGlyphs } from '@/lib/glyph-substitution';
import { HeldQuestionCard } from '@/components/papers/held-question-card';

const root = resolve(__dirname, '../../..');
const read = (f: string) => readFileSync(resolve(root, f), 'utf8');

const HEADER = {
  source: 'Sample Hill School',
  headline: 'Pre-board Examination 2023-24',
  sub: 'Class X · Maths · ICSE',
  time: '2 hours 30 minutes',
  marks: 80,
  generalInstructions: 'Answer all questions in Section A.',
  incompleteNote: null,
};

describe('PaperHeader reads like the top of a printed paper', () => {
  it('shows school, exam and year, class line, time and maximum marks', () => {
    const out = renderToStaticMarkup(<PaperHeader {...HEADER} />);
    expect(out).toContain('Sample Hill School');
    expect(out).toContain('Pre-board Examination 2023-24');
    expect(out).toContain('Class X');
    expect(out).toContain('Time allowed:');
    expect(out).toContain('2 hours 30 minutes');
    expect(out).toContain('Maximum marks:');
    expect(out).toContain('80');
    expect(out).toContain('General instructions');
    expect(out).toContain('font-paper');
  });

  it('leaves out what the paper did not record and invents nothing', () => {
    const out = renderToStaticMarkup(
      <PaperHeader {...HEADER} source={null} time={null} marks={null} generalInstructions={null} />,
    );
    expect(out).not.toContain('Time allowed');
    expect(out).not.toContain('Maximum marks');
    expect(out).not.toContain('General instructions');
    expect(out).not.toContain('not set');
  });

  it('uses the class line as the title when there is no exam name or year', () => {
    const out = renderToStaticMarkup(<PaperHeader {...HEADER} headline="" />);
    expect(out).toMatch(/<h2[^>]*>Class X/);
    expect(out.match(/Class X/g)).toHaveLength(1);
  });

  it('shows the incomplete note only when the paper has one', () => {
    expect(renderToStaticMarkup(<PaperHeader {...HEADER} />)).not.toContain('Page 3 is missing.');
    expect(renderToStaticMarkup(<PaperHeader {...HEADER} incompleteNote="Page 3 is missing." />)).toContain('Page 3 is missing.');
  });
});

describe('QuestionRow', () => {
  it('puts the number in the margin and the marks in brackets, with the words for a screen reader', () => {
    const out = renderToStaticMarkup(
      <QuestionRow id="q1" number="3" marks={4}>
        <p>Solve it.</p>
      </QuestionRow>,
    );
    expect(out).toContain('id="q-q1"');
    expect(out).toContain('data-testid="paper-question-number">3<');
    expect(out).toContain('[4]');
    expect(out).toContain('4 marks');
  });

  it('says "1 mark" for one mark and prints no brackets when marks are null', () => {
    expect(renderToStaticMarkup(<QuestionRow id="a" number="1" marks={1}>x</QuestionRow>)).toContain('1 mark<');
    const none = renderToStaticMarkup(<QuestionRow id="a" number="1" marks={null}>x</QuestionRow>);
    expect(none).not.toContain('paper-question-marks');
  });

  it('has no number cell for a paper that never numbered its questions', () => {
    const out = renderToStaticMarkup(<QuestionRow id="a" number={null} marks={2}>x</QuestionRow>);
    expect(out).not.toContain('paper-question-number');
  });

  it('indents a sub-part, by 20px a level and at most three levels', () => {
    expect(renderToStaticMarkup(<QuestionRow id="a" depth={1} number="a" marks={null}>x</QuestionRow>)).toContain('margin-left:20px');
    expect(renderToStaticMarkup(<QuestionRow id="a" depth={9} number="a" marks={null}>x</QuestionRow>)).toContain('margin-left:60px');
    expect(renderToStaticMarkup(<QuestionRow id="a" depth={0} number="a" marks={null}>x</QuestionRow>)).not.toContain('margin-left');
  });

  it('renders the report control and the form it opens, after the words', () => {
    const out = renderToStaticMarkup(
      <QuestionRow id="a" number="1" marks={2} aside={<button>flag</button>} below={<form>report form</form>}>
        <p>the words</p>
      </QuestionRow>,
    );
    expect(out.indexOf('the words')).toBeLessThan(out.indexOf('flag'));
    expect(out.indexOf('flag')).toBeLessThan(out.indexOf('report form'));
  });
});

describe('QuestionRow on a phone and on a wider screen', () => {
  const out = renderToStaticMarkup(
    <QuestionRow id="a" number="3" marks={4} aside={<button>flag</button>}>
      <p>the words</p>
    </QuestionRow>,
  );

  it('keeps the same reading order at every width: number, words, marks, flag', () => {
    const order = [out.indexOf('paper-question-number'), out.indexOf('the words'), out.indexOf('paper-question-marks'), out.indexOf('flag')];
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it('under sm, number and marks share one line above and the words take the full width', () => {
    expect(out).toContain('grid-cols-[1fr_auto]');
    expect(out).toContain('col-span-2 row-start-2');
    expect(out).toContain('col-start-1 row-start-1');
    expect(out).toContain('col-start-2 row-start-1');
  });

  it('from sm up, the number hangs in the margin and the marks sit on the right', () => {
    expect(out).toContain('sm:grid-cols-[minmax(2.25rem,max-content)_minmax(0,1fr)_auto]');
    expect(out).toContain('sm:col-start-2');
    expect(out).toContain('sm:col-start-3');
  });

  it('a question with no number still puts its words in the first column from sm up', () => {
    const bare = renderToStaticMarkup(<QuestionRow id="a" number={null} marks={2}>x</QuestionRow>);
    expect(bare).toContain('sm:grid-cols-[minmax(0,1fr)_auto]');
    expect(bare).toContain('sm:col-start-1');
    expect(bare).toContain('sm:col-start-2');
  });

  it('the sheet is narrower in its side padding on a phone', () => {
    const sheet = renderToStaticMarkup(<PaperSurface>x</PaperSurface>);
    expect(sheet).toContain('px-3.5');
    expect(sheet).toContain('sm:px-10');
  });
});

describe('the small pieces', () => {
  it('draws an option with its own printed letter without adding a marker, and adds a dot otherwise', () => {
    const out = renderToStaticMarkup(<OptionList keyPrefix="q" options={['a. Dominion status', 'Delhi']} />);
    expect(out.match(/rounded-full/g)).toHaveLength(1);
    // The words go through MathText, so the site's glyph substitution still applies to them.
    expect(out).toContain(substituteGlyphs('a. Dominion status'));
    expect(out).toContain(substituteGlyphs('Delhi'));
  });

  it('QuestionMeta renders nothing when there is nothing to say, and joins with a middle dot', () => {
    expect(renderToStaticMarkup(<QuestionMeta parts={[null, undefined, false, '']} />)).toBe('');
    expect(renderToStaticMarkup(<QuestionMeta parts={['Algebra', 'Short answer']} />)).toContain('Algebra · Short answer');
  });

  it('the OR divider is hidden from assistive tech and the section title is a heading', () => {
    expect(renderToStaticMarkup(<OrDivider />)).toContain('aria-hidden="true"');
    expect(renderToStaticMarkup(<SectionTitle label="Section A" />)).toMatch(/<h3[^>]*>Section A<\/h3>/);
  });

  it('the paper surface is a labelled sheet', () => {
    const out = renderToStaticMarkup(<PaperSurface>x</PaperSurface>);
    expect(out).toContain('aria-label="Question paper"');
    expect(out).toContain('max-w-3xl');
  });

  it('a held question shows its number and a note, never any text', () => {
    const out = renderToStaticMarkup(<HeldQuestionCard id="h1" number="7" depth={1} />);
    expect(out).toContain('data-held="true"');
    expect(out).toContain('>7<');
    expect(out).toContain('This question is not shown right now.');
    expect(out).toContain('margin-left:20px');
  });
});

describe('BankPaper keeps everything the sheet must not lose (source checks)', () => {
  const page = read('src/pages/BankPaper.tsx');

  it('still carries the capture shield, the copy and print lock, the share lock and the sign-in gate', () => {
    expect(page).toContain('<CaptureShield />');
    expect(page).toContain('<PaperShareLock');
    expect(page).toContain('data-paper-locked data-protected');
    expect(page).toContain('paperLockClass');
    expect(page).toContain('<GateSheet');
    expect(page).toContain('Sign in to read all');
    expect(page).toContain('withheld > 0 && !filtering');
  });

  it('renders every question word through MathText, never raw', () => {
    expect(page).toContain('<MathText');
    expect(page).toContain('displayBodyWithoutDuplicateNumber(row.t, shownNumber)');
    expect(page).not.toMatch(/dangerouslySetInnerHTML/);
  });

  it('keeps the figure box shaped by its recorded size and the picture failure note', () => {
    expect(page).toContain('dims={figureDims?.[row.f]}');
    expect(page).toContain('width: dims[0], height: dims[1]');
    expect(page).toContain('did not load');
    expect(page).toContain('onError={() => setBad(true)}');
  });

  it('keeps the numbered report control and its focus return', () => {
    expect(page).toContain('Report a problem with question');
    expect(page).toContain('Close report for question');
    expect(page).toContain('aria-expanded={reportFor === row.i}');
    expect(page).toContain('getElementById(`report-chip-${row.i}`)?.focus()');
  });

  it('uses the printed pieces and no longer prints an invented "Answer all questions"', () => {
    expect(page).toContain("from '@/components/papers/printed-paper'");
    expect(page).toContain('<PaperHeader');
    expect(page).toContain('<QuestionRow');
    expect(page).not.toContain('Answer all questions');
  });

  it('writes no em or en dash in what the new files print', () => {
    for (const f of ['src/components/papers/printed-paper.tsx', 'src/components/papers/held-question-card.tsx']) {
      const lines = read(f)
        .split('\n')
        .filter((l) => !/^\s*(\/\*|\*|\/\/)/.test(l));
      expect(lines.join('\n')).not.toMatch(/[–—]/);
    }
  });

  it('the prerender script still asserts that no question text reaches dist', () => {
    const pre = read('scripts/prerender.ts');
    expect(pre).toContain('assertNoQuestionText');
    expect(pre).toContain('Leak assertion passed');
  });
});
