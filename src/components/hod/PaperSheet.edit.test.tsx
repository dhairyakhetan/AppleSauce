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

  it("shows the question's own heading so it can be checked against the printed page", () => {
    expect(render(true)).toContain('Heading above this question on the site: PART I');
  });

  it('shows no edit buttons once the paper is live', () => {
    const html = render(false, 'Answer all questions.');
    expect(html).not.toContain('Edit this heading line');
    expect(html).not.toContain('Edit this line');
    expect(html).not.toContain('Edit the general instructions');
    expect(html).not.toContain('Edit question');
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

  it('a heading line gets its words, a way to remove it, and a plain note that it is preview only', () => {
    const out = html(row({ kind: 'section_break', state: 'section', body: 'PART I' }));
    expect(out).toContain('data-testid="row-remove"');
    expect(out).toContain('data-testid="row-preview-only-note"');
    expect(out).not.toContain('Question number');
  });

  it('names each kind of line in plain words', () => {
    expect(rowKindWords('section_break')).toBe('Heading line');
    expect(rowKindWords('master_instruction')).toMatch(/whole paper/);
    expect(rowKindWords('section_instruction')).toMatch(/part of the paper/);
    expect(rowKindWords('question')).toBe('Question');
  });
});
