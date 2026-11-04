import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChangesChip, ChangesPanel, ChangesSection, MarksInsideHint, QuestionChips, ToolsRow, ToolsToolbar, toolTooltip } from '@/components/checker/TypedBits';
import { PartCard } from '@/components/checker/PartCard';
import { ContextPart } from '@/components/checker/CheckerBits';
import { revealOffset } from '@/components/checker/BentoParts';
import { assembleQuestionContext, wholeQuestionRows, type ContextRow } from '@/lib/checker-context';
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

  it('uses the two frames, the phone tabs, the part card, the tools and the changes chip', () => {
    // The practice round keeps the older pieces (the tools row with its hint line, the full changes section).
    for (const piece of ['<TypedFrame', '<PrintedFrame', '<PanelTabs', '<QuestionChips', '<MarksInsideHint']) {
      expect(screen, piece).toContain(piece);
      expect(practice, piece).toContain(piece);
    }
    for (const piece of ['<PartCard', '<ToolsToolbar', '<ChangesChip', '<ChangesPanel', '<ContextPart', '<ShortcutsPopover', '<RulesInfo']) {
      expect(screen, piece).toContain(piece);
    }
    for (const piece of ['<ToolsRow', '<ChangesSection']) {
      expect(practice, piece).toContain(piece);
      expect(screen, piece).not.toContain(piece);
    }
  });

  it('opens on the typed words on a phone, and goes back to them on every new question', () => {
    // QA 2026-10-11 finding 6: on the Printed tab the words being checked were
    // hidden, and Looks right worked without them on screen.
    expect(screen).toContain("useState<PanelId>('typed')");
    // 12 Oct 2026 (bento ask): the tile you were on now stays for the next question,
    // except Fix, which goes back to the words (tileForNextQuestion, checker-bento.test.ts).
    expect(screen).toMatch(/setPanel\(\(p\) => tileForNextQuestion\(p\)\);\s+setShowPage\(false\)/);
    expect(practice).toContain("useState<PanelId>('typed')");
  });

  it('keeps Looks right, Fix it, Ask the HOD and Skip in the sticky footer', () => {
    const footer = screen.slice(screen.indexOf('Action footer'));
    for (const label of ['Looks right', 'Fix it', 'Ask the HOD', 'Skip this question']) {
      expect(footer).toContain(label);
    }
    expect(footer).toContain('sticky bottom-0');
  });

  it('draws the highlight only on the whole page, through the page viewer', () => {
    expect(screen).toContain('source={question.source}');
  });
});

describe('the tools toolbar', () => {
  const html = renderToStaticMarkup(
    <ToolsToolbar active="fix" available={{ fix: true, split: true, formula: true, or: false }} onPick={noop} />,
  );

  it('has an icon and a short label for each of the four tools', () => {
    for (const short of ['Fix words', 'Split', 'Formula', 'Just the OR']) expect(html).toContain(short);
    expect((html.match(/data-testid="tool-/g) ?? []).length).toBe(4);
    // One icon per button, drawn by the icon library and hidden from screen readers.
    expect((html.match(/<svg[^>]*aria-hidden="true"/g) ?? []).length).toBe(4);
  });

  it('names each tool in full for a screen reader, while the visible label is short', () => {
    for (const t of CHECKER_TOOLS) expect(html).toContain(`aria-label="${t.label}"`);
    expect(html).toContain('aria-label="Split into two questions"');
  });

  it('puts the long name and the key in the tooltip', () => {
    expect(toolTooltip('fix', true)).toMatch(/^Fix the words\. .* Key: F\.$/);
    expect(toolTooltip('split', true)).toMatch(/^Split into two questions\. .* Key: S\.$/);
    expect(toolTooltip('formula', true)).not.toContain('Key:');
    // A tool that does not apply says why instead.
    expect(toolTooltip('or', false)).toContain('only for a row that is nothing but the word OR');
    for (const t of CHECKER_TOOLS) expect(html).toContain(`title="${toolTooltip(t.id, t.id !== 'or')}"`);
  });

  it('is at least 44px tall and shows which tool is open', () => {
    expect((html.match(/min-h-\[52px\]/g) ?? []).length).toBe(4);
    const fix = html.slice(html.indexOf('data-testid="tool-fix"') - 60, html.indexOf('data-testid="tool-split"'));
    expect(fix).toContain('aria-pressed="true"');
    expect(fix).toContain('bg-panel');
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(3);
  });

  it('keeps a tool that does not apply pressable but marked disabled for screen readers', () => {
    const or = html.slice(html.indexOf('data-testid="tool-or"') - 60);
    expect(or).toContain('aria-disabled="true"');
    expect(or).not.toMatch(/\sdisabled=""/);
  });

  it('has no hint line and no Tools label eating a row', () => {
    expect(html).not.toContain('id="tool-hint"');
    expect(html).not.toContain('Point at a tool');
  });
});

describe('the part card is one card that edits in place', () => {
  const read = renderToStaticMarkup(<PartCard mode="read" body="Find the value of x." options={null} changesChip={<i>chip</i>} />);
  const edit = renderToStaticMarkup(
    <PartCard mode="edit" body="Find the value of x." options={null} changesChip={<i>chip</i>} editFooter={<b>footer</b>} />,
  );

  it('reads as a card with the Typed by the computer badge on it and the words large', () => {
    expect(read).toContain('data-testid="part-card"');
    expect(read).toContain('data-mode="read"');
    expect(read).toContain('Typed by the computer');
    // The words go through MathText (which may scramble glyphs for capture protection), so only the wrapper is pinned.
    expect(read).toContain('break-words text-[18px]');
    expect(read).not.toContain('Editing');
    expect(read).not.toContain('<textarea');
  });

  it('turns into the editor in the same card: same text, an Editing badge, a ring, the footer attached', () => {
    expect((edit.match(/data-testid="part-card"/g) ?? []).length).toBe(1);
    expect(edit).toContain('data-mode="edit"');
    expect(edit).toContain('Editing');
    expect(edit).toContain('Typed by the computer');
    expect(edit).toContain('ring-2 ring-brand');
    expect(edit).toContain('<textarea');
    expect(edit).toContain('footer');
    // The same words are on the page once: no second box with a copy.
    expect(edit.split('Find the value of x.').length - 1).toBe(1);
  });

  it('shows Show code as a small text link and keeps the changes chip on the same card', () => {
    expect(edit).toContain('data-testid="show-code"');
    expect(edit).toMatch(/data-testid="show-code"[^>]*underline|underline[^>]*data-testid="show-code"/);
    expect(edit).toContain('chip');
    expect(read).toContain('chip');
  });

  it('turns into the place to choose a split in the same card', () => {
    const split = renderToStaticMarkup(
      <PartCard mode="split" body="a b" options={null} splitBody={<u>pick</u>} splitFooter={<s>preview</s>} />,
    );
    expect(split).toContain('data-mode="split"');
    expect(split).toContain('Splitting');
    expect(split).toContain('pick');
    expect(split).toContain('preview');
    expect((split.match(/data-testid="part-card"/g) ?? []).length).toBe(1);
  });
});

describe('the changes chip', () => {
  const source = { edit_log: [{ kind: 'joined_lines' }, { kind: 'fixed_ocr_word', from: 'rn', to: 'm' }] };

  it('is a small counted chip, closed to begin with, and nothing when there is nothing to show', () => {
    const html = renderToStaticMarkup(<ChangesChip source={source} rawOcr="first" open={false} onToggle={noop} />);
    expect(html).toContain('What the computer changed');
    expect(html).toContain('>2<');
    expect(html).toContain('aria-expanded="false"');
    expect(renderToStaticMarkup(<ChangesChip source={{ page: 3 }} rawOcr={null} open={false} onToggle={noop} />)).toBe('');
    expect(renderToStaticMarkup(<ChangesPanel source={{ page: 3 }} rawOcr={null} />)).toBe('');
  });

  it('opens a scrolling list inline', () => {
    const html = renderToStaticMarkup(<ChangesPanel source={source} rawOcr="first" />);
    expect(html).toContain('Joined broken lines');
    expect(html).toContain('max-h-48 overflow-y-auto');
  });
});

describe('the whole question is shown, with the checked part as the one card', () => {
  const rows: ContextRow[] = [
    { id: 'p', ord: 1, display_number: '3', number_path: '3', body: 'Read the passage.', options: null, source: null, is_current: false, is_parent: true, depth: 0 },
    { id: 'a', ord: 2, display_number: '(a)', number_path: '3.a', body: '(a) Name the river.', options: null, source: null, is_current: false, is_parent: false, depth: 1 },
    { id: 'b', ord: 3, display_number: '(b)', number_path: '3.b', body: '(b) Where does it rise?', options: null, source: null, is_current: true, is_parent: false, depth: 1 },
    { id: 'c', ord: 4, display_number: '(c)', number_path: '3.c', body: '(c) Where does it end?', options: null, source: null, is_current: false, is_parent: false, depth: 1 },
  ];
  const ctx = assembleQuestionContext(rows, 'b')!;

  it('lists the stem first, then every part in order, with the checked one flagged in its own place', () => {
    const list = wholeQuestionRows(ctx);
    expect(list.map((r) => r.id)).toEqual(['p', 'a', 'b', 'c']);
    expect(list.map((r) => r.current)).toEqual([false, false, true, false]);
    expect(list.map((r) => r.isParent)).toEqual([true, false, false, false]);
    expect(list.map((r) => r.label)).toEqual(['', '(a)', '(b)', '(c)']);
    expect(list.map((r) => r.depth)).toEqual([0, 1, 1, 1]);
  });

  it('flags the stem when the stem itself is being checked', () => {
    const own = assembleQuestionContext(rows, 'p')!;
    expect(wholeQuestionRows(own).map((r) => r.current)).toEqual([true, false, false, false]);
  });

  it('is empty for a stand-alone question, so the screen shows just the card', () => {
    expect(wholeQuestionRows(null)).toEqual([]);
    expect(wholeQuestionRows(assembleQuestionContext([rows[2]], 'b'))).toEqual([]);
  });

  it('shows each other part read-only and calm: its words, no editor, no box of its own', () => {
    const list = wholeQuestionRows(ctx);
    const stem = renderToStaticMarkup(<ContextPart row={list[0]} />);
    const part = renderToStaticMarkup(<ContextPart row={list[1]} />);
    expect(stem).toContain('data-testid="context-stem"');
    expect(part).toContain('data-testid="context-part"');
    for (const html of [stem, part]) {
      expect(html).not.toContain('<textarea');
      // Calm: no ring, no filled box, no border all round (only the keyboard focus ring and the thin left rule).
      expect(html).not.toMatch(/(^|[\s"])ring-2/);
      expect(html).not.toMatch(/\bborder border-/);
      expect(html).not.toContain('border-2 ');
      expect(html).not.toContain('bg-white');
      expect(html).not.toContain('bg-brand-subtle');
    }
    // A thin rule at the left, not a box, and a short label only when the words do not carry it.
    expect(part).toContain('border-l-2');
    expect(renderToStaticMarkup(<ContextPart row={{ ...list[1], body: 'Name the river.' }} />)).toContain('>(a)<');
    expect(part).not.toContain('>(a)<');
  });

  it('has no folded Other parts row any more', () => {
    const bits = readFileSync(resolve(__dirname, './CheckerBits.tsx'), 'utf8');
    expect(bits).not.toContain('Other parts of this question');
    expect(bits).not.toContain('OtherParts');
    expect(bits).not.toContain('<details');
  });
});

describe('the verify screen lays the whole question out around the card', () => {
  const screen = readFileSync(resolve(__dirname, './VerifyScreen.tsx'), 'utf8');
  const left = screen.slice(screen.indexOf('const leftContent'), screen.indexOf('/* ----', screen.indexOf('const leftContent')));

  it('renders every row of the question in order, the checked one as the card, the others as read-only parts', () => {
    expect(left).toContain('contextRows.map(');
    expect(left).toMatch(/r\.current \? checkedPart : <ContextPart row=\{r\}/);
    expect(left).toContain('focused={r.id === focusId}');
    expect(left).toContain('data-testid="whole-question"');
    expect(screen).toContain('wholeQuestionRows(context)');
    expect(screen).not.toContain('<OtherParts');
    expect(screen).not.toContain('<WholeQuestion');
  });

  it('puts the rules line, the card, the tools right under it, and the marks hint together as the checked part', () => {
    const checked = screen.slice(screen.indexOf('const checkedPart'), screen.indexOf('const leftContent'));
    const order = ['{rulesLine}', '{partCard}', '{tools}', '{marksHint}'].map((p) => checked.indexOf(p));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('keeps the stem above the parts, the passage under the stem, and instructions at the very top', () => {
    expect(left.indexOf('{instructionsBlock}')).toBeLessThan(left.indexOf('data-testid="whole-question"'));
    expect(left).toContain('i === 0 && r.isParent ? passageBlock : null');
  });

  it('has one scroll area for the whole pane, with no inner scroller on the passage', () => {
    expect(screen).not.toContain('max-h-[40vh]');
    // The left pane and the right pane each reveal the highlighted part (wide, and the phone's two tabs).
    expect(screen).toContain("const FOCUSED_SELECTOR = '[data-focused=\"true\"]'");
    expect((screen.match(/revealKey=/g) ?? []).length).toBe(4);
  });

  it('a stand-alone question is unchanged: the card, the tools, then its passage and instructions', () => {
    expect(left).toMatch(/\{questionTop\}\s+\{alerts\}\s+\{checkedPart\}\s+\{passageBlock\}\s+\{instructionsBlock\}/);
  });
});

describe('the card stays the only editor', () => {
  const screen = readFileSync(resolve(__dirname, './VerifyScreen.tsx'), 'utf8');

  it('has no second editor box and no three line rules callout', () => {
    expect(screen).not.toContain('const fixEditor');
    expect(screen).not.toContain('<BodyEditor');
    expect(screen).not.toContain('FIX_RULE_NOTE');
    expect(screen).toContain('FIX_RULE_LINE');
  });

  it('keeps the tools docked at the foot of the pane while the card is long', () => {
    expect(screen).toContain('sticky bottom-0 z-[1]');
    expect(screen).toContain('data-testid="tools-dock"');
  });
});

describe('scrolling the checked part into view', () => {
  it('does not move when the part is already in view', () => {
    expect(revealOffset({ scrollTop: 0, viewHeight: 400, top: 100, height: 120 })).toBe(0);
    expect(revealOffset({ scrollTop: 50, viewHeight: 400, top: 200, height: 100 })).toBe(50);
  });

  it('moves just far enough to show a part below a long passage, leaving the stem above it', () => {
    const next = revealOffset({ scrollTop: 0, viewHeight: 400, top: 900, height: 150 });
    // Bottom edge of the part (plus 12px of air) lands on the bottom of the area, not its top.
    expect(next).toBe(900 + 150 + 12 - 400);
    expect(900 - next).toBeGreaterThan(100);
  });

  it('brings a part that is above the view back, and lines up a part taller than the area at its top', () => {
    expect(revealOffset({ scrollTop: 500, viewHeight: 400, top: 300, height: 100 })).toBe(288);
    expect(revealOffset({ scrollTop: 0, viewHeight: 300, top: 400, height: 500 })).toBe(388);
  });
});

describe('the action bar', () => {
  const screen = readFileSync(resolve(__dirname, './VerifyScreen.tsx'), 'utf8');
  const bar = screen.slice(screen.indexOf('const actionBar ='), screen.indexOf('const incomingBar'));

  it('gives each button its icon and its tone', () => {
    expect(bar).toMatch(/tone=\{blank[\s\S]*?<Check /);
    expect(bar).toMatch(/tone="dark"[\s\S]*?<Pencil /);
    expect(bar).toMatch(/tone="outline"[\s\S]*?<CircleHelp /);
    expect(bar).toMatch(/tone="muted"[\s\S]*?<SkipForward /);
  });

  it('collapses the long keyboard hint line into a "?" button that opens the shortcuts', () => {
    expect(bar).toContain('<ShortcutsPopover');
    expect(screen).not.toContain('shortcutHint(');
    expect(screen).not.toContain('Esc cancels');
  });
});
