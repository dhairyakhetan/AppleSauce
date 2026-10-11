import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChangesSection, MarksInsideHint, QuestionChips, ToolsRow } from '@/components/checker/TypedBits';
import { PanelTabs, PrintedFrame, TypedFrame } from '@/components/checker/Panels';
import { CHECKER_TOOLS } from '@/lib/checker-tools';

// Rendered with renderToStaticMarkup (no jsdom in this project's tests). The
// open/closed behaviour of the changes section is client state, so what is
// pinned here is what is on screen to begin with and the words used.

const noop = () => undefined;

describe('the two panels cannot be mixed up', () => {
  const typed = renderToStaticMarkup(<TypedFrame>x</TypedFrame>);
  const printed = renderToStaticMarkup(
    <PrintedFrame tourId="picture">
      x
    </PrintedFrame>,
  );

  it('labels the typed side as typed by the computer, in a plain neutral card', () => {
    expect(typed).toContain('Typed by the computer');
    expect(typed).toContain('What the computer typed');
    expect(typed).not.toContain('border-brand');
  });

  it('frames the printed side strongly and says it is a photo of the printed paper', () => {
    expect(printed).toContain('Photo of the printed paper');
    expect(printed).toContain('The printed paper');
    expect(printed).toContain('border-2 border-brand');
    expect(printed).toContain('data-tour="picture"');
  });

  it('uses radii from the scale, concentric: 20 outside, 10 inside', () => {
    expect(printed).toContain('rounded-[20px]');
    expect(printed).toContain('rounded-[10px]');
  });

  it('has two big tabs for a phone, Typed and Printed, that only show below lg', () => {
    const html = renderToStaticMarkup(<PanelTabs value="printed" onChange={noop} />);
    expect(html).toContain('role="tablist"');
    expect(html).toContain('lg:hidden');
    expect(html).toMatch(/aria-selected="true"[^>]*id="verify-tab-printed"|id="verify-tab-printed"[^>]*aria-selected="true"/);
    expect(html).toContain('Typed');
    expect(html).toContain('Printed');
  });
});

describe('question number and marks chips', () => {
  it('shows them as chips outside Fix mode', () => {
    const html = renderToStaticMarkup(
      <QuestionChips number="5(ii)" marks={2} editing={false} numberDraft="" marksDraft="" onNumber={noop} onMarks={noop} marksInvalid={false} />,
    );
    expect(html).toContain('Question 5(ii)');
    expect(html).toContain('2 marks');
    expect(html).not.toContain('<input');
  });

  it('says 1 mark, not 1 marks, and says plainly when there is none', () => {
    const one = renderToStaticMarkup(
      <QuestionChips number={null} marks={1} editing={false} numberDraft="" marksDraft="" onNumber={noop} onMarks={noop} marksInvalid={false} />,
    );
    expect(one).toContain('1 mark<');
    expect(one).toContain('No question number');
    const none = renderToStaticMarkup(
      <QuestionChips number="3" marks={null} editing={false} numberDraft="" marksDraft="" onNumber={noop} onMarks={noop} marksInvalid={false} />,
    );
    expect(none).toContain('No marks');
  });

  it('turns into labelled boxes in Fix mode', () => {
    const html = renderToStaticMarkup(
      <QuestionChips number="5" marks={2} editing numberDraft="5" marksDraft="2" onNumber={noop} onMarks={noop} marksInvalid={false} />,
    );
    expect(html).toContain('Question number');
    expect(html).toContain('Marks');
    expect((html.match(/<input/g) ?? []).length).toBe(2);
  });
});

describe('marks inside the text hint', () => {
  it('shows the hint and a Move marks out button when the marks are inside the text', () => {
    const html = renderToStaticMarkup(<MarksInsideHint body="Find x. [3]" currentMarks="" onMove={noop} />);
    expect(html).toContain('The marks are inside the text. Move them to the Marks box.');
    expect(html).toContain('Move marks out');
    expect(html).toContain('[3]');
  });

  it('says when the Marks box disagrees', () => {
    const html = renderToStaticMarkup(<MarksInsideHint body="Find x. [3]" currentMarks="2" onMove={noop} />);
    expect(html).toContain('The box says 2 now.');
  });

  it('shows nothing when the text has no marks token', () => {
    expect(renderToStaticMarkup(<MarksInsideHint body="Find x." currentMarks="3" onMove={noop} />)).toBe('');
    expect(renderToStaticMarkup(<MarksInsideHint body="(i) one [2] (ii) two [1]" currentMarks="" onMove={noop} />)).toBe('');
  });
});

describe('the tools row', () => {
  const html = renderToStaticMarkup(
    <ToolsRow active={null} available={{ fix: true, split: true, formula: true, or: false }} onPick={noop} />,
  );

  it('always shows all four tools, labelled in words', () => {
    for (const label of ['Fix the words', 'Split into two questions', 'Edit a formula', 'This is just the OR']) {
      expect(html).toContain(label);
    }
    expect((html.match(/data-testid="tool-/g) ?? []).length).toBe(4);
  });

  it('gives each tool a one line explanation as a tooltip, and the reason when it does not apply', () => {
    for (const t of CHECKER_TOOLS) {
      const text = t.id === 'or' ? t.unavailable : t.hint;
      expect(html).toContain(`title="${text}"`);
    }
  });

  it('keeps a tool that does not apply pressable (it explains itself) but marks it disabled for screen readers', () => {
    const or = html.slice(html.indexOf('data-testid="tool-or"') - 200, html.indexOf('data-testid="tool-or"') + 600);
    expect(or).toContain('aria-disabled="true"');
    expect(or).not.toMatch(/\sdisabled=""/);
  });

  it('makes every tool a real 44px target', () => {
    expect((html.match(/min-h-\[44px\]/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});

describe('what the computer changed', () => {
  it('renders nothing for an older question with no change log and no first reading', () => {
    expect(renderToStaticMarkup(<ChangesSection source={{ page: 3 }} rawOcr={null} />)).toBe('');
    expect(renderToStaticMarkup(<ChangesSection source={null} rawOcr={undefined} />)).toBe('');
  });

  it('is there, collapsed and counted, when the pipeline wrote a change log', () => {
    const html = renderToStaticMarkup(
      <ChangesSection source={{ edit_log: [{ kind: 'joined_lines' }, { kind: 'fixed_ocr_word', from: 'rn', to: 'm' }] }} rawOcr="first reading" />,
    );
    expect(html).toContain('What the computer changed');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('>2<');
    // Closed to begin with: neither the list nor the first reading is on screen yet.
    expect(html).not.toContain('Joined broken lines');
    expect(html).not.toContain('first reading</');
  });

  it('is there for a question that only has a first reading', () => {
    expect(renderToStaticMarkup(<ChangesSection source={null} rawOcr="raw words" />)).toContain('What the computer changed');
  });
});

describe('wiring in the verify screen and the practice round', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
  const screen = read('./VerifyScreen.tsx');
  const practice = read('../../pages/CheckerPractice.tsx');

  it('uses the two frames, the phone tabs, the tools and the changes section', () => {
    for (const piece of ['<TypedFrame', '<PrintedFrame', '<PanelTabs', '<ToolsRow', '<ChangesSection', '<QuestionChips', '<MarksInsideHint']) {
      expect(screen, piece).toContain(piece);
      expect(practice, piece).toContain(piece);
    }
  });

  it('shows the printed side first on a phone', () => {
    expect(screen).toContain("useState<PanelId>('printed')");
  });

  it('keeps Looks right, Fix it, Ask the HOD, Skip and Undo in the sticky footer', () => {
    const footer = screen.slice(screen.indexOf('Action footer'));
    for (const label of ['Looks right', 'Fix it', 'Ask the HOD', 'Skip this question', '{undoButton}']) {
      expect(footer).toContain(label);
    }
    expect(footer).toContain('sticky bottom-0');
  });

  it('draws the highlight only on the whole page, through the page viewer', () => {
    expect(screen).toContain('source={question.source}');
  });
});
