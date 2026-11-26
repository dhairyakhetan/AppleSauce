import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import { PaperSheet } from '@/components/hod/PaperSheet';
import { PaperRowEditor, rowKindWords } from '@/components/hod/PaperRowEditor';
import { createFakeHodApi } from '@/dummy/hod-fake-api';
import { normalisePreview, normalisePreviewQuestion } from '@/lib/hod-publish';

/* Owner, 25 Nov 2026: every line of the paper must be editable before it goes live: headings, instruction lines,
   the general instructions and each question's own instructions and heading. Rendered to markup (node, no DOM). */

const q = (over: Record<string, unknown>) => ({
  id: 'q-' + String(over.ord),
  ord: 0,
  kind: 'question',
  state: 'passed',
  body: 'Words',
  version: 1,
  ...over,
});

const preview = (generalInstructions: string | null) =>
  normalisePreview({
    paper: {
      audit_paper_id: 'p1',
      title: 'History and Civics',
      approval_state: 'awaiting',
      kind: 'new',
      is_live: false,
      page_count: 5,
      header: { school: 'A School', cls: 'X', subject: 'History', board: 'ICSE', year: '2024', general_instructions: generalInstructions },
    },
    questions: [
      q({ ord: 1, kind: 'section_break', state: 'section', body: 'PART I ATTEMPT ALL QUESTIONS QUESTION 1 (A) WHAT IS' }),
      q({ ord: 2, kind: 'section_instruction', state: 'section', body: 'Answer any three of the following.' }),
      q({ ord: 3, kind: 'question', display_number: '1(a)', instructions: 'Attempt all', section_label: 'PART I', body: 'What is the term of the Lok Sabha?' }),
    ],
    counts: { total: 1, passed: 1, open: 0, set_aside: 0 },
    pages: [],
    checks: [],
  });

const render = (editable: boolean, general: string | null = null) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <PaperSheet preview={preview(general)} api={createFakeHodApi()} editable={editable} onChanged={() => undefined} />
    </MemoryRouter>,
  );

describe('PaperSheet: everything is editable while the paper is not live', () => {
  it('offers Edit on the heading line, the instruction line and the question', () => {
    const html = render(true);
    expect(html).toContain('aria-label="Edit this heading line"');
    expect(html).toContain('aria-label="Edit this line"');
    expect(html).toContain('aria-label="Edit question 1(a)"');
  });

  it('offers to add general instructions when there are none, and to edit them when there are', () => {
    expect(render(true, null)).toContain('Add general instructions');
    expect(render(true, 'Answer all questions.')).toContain('Edit the general instructions');
  });

  it("draws the question's own heading as the live page does, with an Edit that changes it", () => {
    const html = render(true);
    expect(html).toMatch(/<h3[^>]*>PART I<\/h3>/);
    expect(html).toContain('aria-label="Edit the heading PART I"');
    expect(html).not.toContain('Heading above this question on the site');
  });

  it('marks heading and instruction lines that are not on the live site, and offers to put them there', () => {
    const html = render(true);
    expect(html).toContain('Not shown on the live site.');
    expect(html).toContain('Edit and show it on the site');
  });

  it('shows no edit buttons once the paper is live', () => {
    const html = render(false, 'Answer all questions.');
    expect(html).not.toContain('Edit this heading line');
    expect(html).not.toContain('Edit this line');
    expect(html).not.toContain('Edit the general instructions');
    expect(html).not.toContain('Edit question');
    expect(html).not.toContain('Edit the heading');
    expect(html).not.toContain('Not shown on the live site');
  });
});

describe('PaperSheet: drawn with the live page parts', () => {
  const sheet = (questions: Record<string, unknown>[], header: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <PaperSheet
          preview={normalisePreview({
            paper: {
              audit_paper_id: 'p1',
              title: 'T',
              approval_state: 'awaiting',
              kind: 'new',
              is_live: false,
              page_count: 1,
              header: { school: 'A School', cls: 'X', subject: 'Maths', board: 'ICSE', year: '2024', marks: 80, allowed_time_minutes: 150, ...header },
            },
            questions,
            counts: { total: questions.length, passed: questions.length, open: 0, set_aside: 0 },
            pages: [],
            checks: [],
          })}
          api={createFakeHodApi()}
          editable
          onChanged={() => undefined}
          currentId="q-2"
        />
      </MemoryRouter>,
    );

  it('uses the printed header, the number in the margin and the marks in brackets, not badges', () => {
    const html = sheet([q({ ord: 1, display_number: '1', marks: 3, body: 'Find x.' })]);
    expect(html).toContain('data-testid="paper-header"');
    expect(html).toContain('2 hours 30 minutes');
    expect(html).toContain('data-testid="paper-question-number"');
    expect(html).toContain('[3]');
    expect(html).not.toContain('bg-brand-blue px-1.5');
  });

  it('shows the options as the live page gets them: a stored label goes in front, the words are untouched', () => {
    const html = sheet([q({ ord: 1, options: [{ label: 'a', text: 'Delhi' }, { label: 'b', text: '(b) Kolkata' }, 'Mumbai'] })]);
    // The words themselves are drawn by MathText (which scrambles glyphs in markup), so the rule is tested in
    // hod-publish.test.ts (liveOptionTexts); here: the live list is used, and only the option with no letter gets a dot.
    expect(html).toContain('data-testid="paper-options"');
    expect(html.match(/<li class="flex gap-2">/g)).toHaveLength(3);
    expect(html.match(/rounded-full bg-warm-label/g)).toHaveLength(1);
  });

  it('draws OR between the choices of an OR group, and the incomplete note', () => {
    const html = sheet(
      [q({ ord: 1, alternative_group: 'g' }), q({ ord: 2, alternative_group: 'g' })],
      { incomplete_note: 'Page 3 is missing from this paper.' },
    );
    expect(html).toMatch(/>OR</);
    expect(html).toContain('Page 3 is missing from this paper.');
  });

  it('rings the question a "Show me" points at', () => {
    const html = sheet([q({ ord: 1 }), q({ ord: 2, scanner_junk: true })]);
    expect(html).toContain('data-current="true"');
    expect(html).toContain('Scanner junk');
  });

  it('does not draw a heading line twice when the live heading already says it', () => {
    const html = sheet([
      q({ ord: 1, kind: 'section_break', state: 'section', body: 'Section A' }),
      q({ ord: 2, section_label: 'SECTION A' }),
    ]);
    expect(html).toMatch(/<h3[^>]*>SECTION A<\/h3>/);
    expect(html).not.toContain('Not shown on the live site');
  });

  it('offers Leave it out only where the server accepts it (questions that came to the HOD)', () => {
    expect(sheet([q({ ord: 1, review_bucket: 'admin' })])).toContain('Leave it out');
    expect(sheet([q({ ord: 1, review_bucket: 'escalated' })])).toContain('Leave it out');
    expect(sheet([q({ ord: 1, review_bucket: 'kid' })])).not.toContain('Leave it out');
  });
});

describe('PaperRowEditor', () => {
  const row = (over: Record<string, unknown>) => normalisePreviewQuestion(q({ ord: 1, ...over }))!;
  const html = (r: ReturnType<typeof row>) =>
    renderToStaticMarkup(<PaperRowEditor row={r} busy={false} error={null} onError={() => undefined} onSave={() => undefined} onCancel={() => undefined} />);

  it('a question gets number, marks, its heading and its own instructions', () => {
    const out = html(row({ display_number: '1(a)', marks: 1, instructions: 'Attempt all', section_label: 'PART I' }));
    expect(out).toContain('data-testid="row-heading"');
    expect(out).toContain('data-testid="row-instructions"');
    expect(out).toContain('Question number');
    expect(out).toContain('Marks');
    expect(out).toContain('Attempt all');
  });

  it('a heading line gets its words, a way to remove it, and a plain note that it is not on the live site', () => {
    const out = html(row({ kind: 'section_break', state: 'section', body: 'PART I' }));
    expect(out).toContain('data-testid="row-remove"');
    expect(out).toContain('data-testid="row-preview-only-note"');
    expect(out).toContain('not shown on the live site');
    expect(out).not.toContain('Question number');
  });

  it('a line that reaches the live site says where its words go', () => {
    const r = row({ kind: 'section_break', state: 'section', body: 'PART I' });
    const out = renderToStaticMarkup(
      <PaperRowEditor row={r} busy={false} error={null} onError={() => undefined} onSave={() => undefined} onCancel={() => undefined} liveNote="Saving shows these words on the live site as the heading." />,
    );
    expect(out).toContain('data-testid="row-live-note"');
    expect(out).toContain('Saving shows these words on the live site as the heading.');
  });

  it('names each kind of line in plain words', () => {
    expect(rowKindWords('section_break')).toBe('Heading line');
    expect(rowKindWords('master_instruction')).toMatch(/whole paper/);
    expect(rowKindWords('section_instruction')).toMatch(/part of the paper/);
    expect(rowKindWords('question')).toBe('Question');
  });
});
