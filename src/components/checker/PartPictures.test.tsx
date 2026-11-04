import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';

import { PartPictures } from '@/components/checker/PartPictures';
import { ContextPart } from '@/components/checker/CheckerBits';
import { PartCard } from '@/components/checker/PartCard';
import { assembleQuestionContext, wholeQuestionRows, type ContextRow } from '@/lib/checker-context';
import { dummyContext, ENGLISH_PART_ID } from '@/dummy/checker-fixtures';
import { dummyPictureDataUrl } from '@/dummy/checker-fixtures';
import { focusedPartId, noPictureLine, planPartPictures } from '@/lib/checker-pictures';

const QUESTION_5B = 'd0000003-0000-4000-8000-000000000003';

function row(id: string, ord: number, extra: Partial<ContextRow> = {}): ContextRow {
  return {
    id,
    ord,
    display_number: null,
    number_path: null,
    body: `body of ${id}`,
    options: null,
    source: null,
    is_current: false,
    is_parent: false,
    depth: 1,
    ...extra,
  };
}

const plan = (id: string) => planPartPictures(wholeQuestionRows(assembleQuestionContext(dummyContext(id), id)));

describe('one picture tile per part (owner request #110)', () => {
  it('plans a slot for the stem and every part, in the same order as the typed words', () => {
    const parts = plan(QUESTION_5B)!;
    expect(parts.map((p) => p.label)).toEqual(['The question', '(a)', '(b)', '(c)']);
    const typed = wholeQuestionRows(assembleQuestionContext(dummyContext(QUESTION_5B), QUESTION_5B)).map((r) => r.id);
    expect(parts.map((p) => p.id)).toEqual(typed);
    expect(parts.filter((p) => p.current).map((p) => p.label)).toEqual(['(b)']);
  });

  it('plans the English question too: stem then (a) to (h), with (f) as the checked one', () => {
    const parts = plan(ENGLISH_PART_ID)!;
    expect(parts.map((p) => p.label)).toEqual(['The question', '(a)', '(b)', '(c)', '(d)', '(e)', '(f)', '(g)', '(h)']);
    expect(parts.find((p) => p.current)?.label).toBe('(f)');
    // (d) and (g) have no crop of their own.
    expect(parts.filter((p) => !p.path).map((p) => p.label)).toEqual(['(d)', '(g)']);
  });

  it('every planned picture in the dummy fixtures really exists', () => {
    for (const id of [QUESTION_5B, ENGLISH_PART_ID]) {
      for (const p of plan(id)!) if (p.path) expect(dummyPictureDataUrl(p.path), p.path).toMatch(/^data:image\/svg\+xml/);
    }
  });

  it('never shows a doubtful crop: a part scored below 0.9 gets the no-picture tile', () => {
    const rows = wholeQuestionRows(
      assembleQuestionContext(
        [
          row('root', 1, { is_parent: true, depth: 0, display_number: '1', source: { snippet_object: 'p/root.png' } }),
          row('a', 2, { display_number: '(a)', source: { snippet_object: 'p/a.png', align_score: 0.5 } }),
          row('b', 3, { display_number: '(b)', is_current: true, source: { snippet_object: 'p/b.png', align_score: 0.95 } }),
        ],
        'b',
      ),
    );
    const parts = planPartPictures(rows)!;
    expect(parts.find((p) => p.label === '(a)')?.path).toBeNull();
    expect(parts.find((p) => p.label === '(b)')?.path).toBe('p/b.png');
  });

  it('drops a stem that has no crop of its own, but keeps every part slot', () => {
    const rows = wholeQuestionRows(
      assembleQuestionContext(
        [
          row('root', 1, { is_parent: true, depth: 0, display_number: '1' }),
          row('a', 2, { display_number: '(a)', is_current: true, source: { snippet_object: 'p/a.png' } }),
          row('b', 3, { display_number: '(b)' }),
        ],
        'a',
      ),
    );
    expect(planPartPictures(rows)!.map((p) => p.label)).toEqual(['(a)', '(b)']);
  });

  it('keeps the old single picture when no row has a crop of its own, and for a stand-alone question', () => {
    // A group where only the parent has a whole-question crop: today's behaviour (planCheckerPicture) applies.
    const rows = wholeQuestionRows(
      assembleQuestionContext(
        [
          row('root', 1, { is_parent: true, depth: 0, display_number: '1', source: { whole_snippet_object: 'p/whole.png' } }),
          row('a', 2, { display_number: '(a)', is_current: true }),
        ],
        'a',
      ),
    );
    expect(planPartPictures(rows)).toBeNull();
    expect(planPartPictures([])).toBeNull();
    expect(planPartPictures(wholeQuestionRows(null))).toBeNull();
  });
});

describe('PartPictures markup', () => {
  const parts = plan(QUESTION_5B)!;
  const urls = Object.fromEntries(parts.filter((p) => p.path).map((p) => [p.id, `https://img/${p.id}.png`]));
  const render = (focusId: string, u: Record<string, string | null | undefined> = urls) =>
    renderToStaticMarkup(<PartPictures parts={parts} urls={u} focusId={focusId} onFocus={() => undefined} onEnlarge={() => undefined} />);

  it('renders one tile per part, in order, each labelled', () => {
    const html = render(QUESTION_5B);
    const tiles = html.split('data-testid="part-picture"').length - 1;
    expect(tiles).toBe(parts.length);
    const labels = [...html.matchAll(/text-\[12px\] font-semibold[^"]*">([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(labels).toEqual(['The question', '(a)', '(b)', '(c)']);
    // Same order as the typed words.
    const ids = [...html.matchAll(/data-part-id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(parts.map((p) => p.id));
  });

  it('highlights only the focused tile, with the same orange ring as the left card', () => {
    const html = render(QUESTION_5B);
    expect((html.match(/data-focused="true"/g) || []).length).toBe(1);
    const focusedTile = html.slice(html.indexOf(`data-part-id="${QUESTION_5B}"`));
    expect(focusedTile.slice(0, 600)).toContain('data-focused="true"');
    expect(focusedTile.slice(0, 700)).toContain('border-brand ring-2 ring-brand/30');
    // The checked tile keeps its mark even when the view is elsewhere.
    const moved = render('d0000003-0000-4000-8000-0000000000aa');
    expect((moved.match(/data-focused="true"/g) || []).length).toBe(1);
    expect(moved).toContain('data-checked="true"');
    expect(moved.indexOf('data-checked="true"')).toBeGreaterThan(moved.indexOf('data-focused="true"'));
  });

  it('a part without a picture keeps its slot as a small "No separate picture" tile', () => {
    const html = render(QUESTION_5B);
    expect(html).toContain('data-testid="no-part-picture"');
    expect(html).toContain(noPictureLine('(c)'));
    expect(noPictureLine('(c)')).toBe('No separate picture for (c)');
    expect((html.match(/data-testid="no-part-picture"/g) || []).length).toBe(1);
  });

  it('shows a loading block while a link is on the way, never a broken image', () => {
    const html = render(QUESTION_5B, { ...urls, 'd0000003-0000-4000-8000-0000000000aa': undefined });
    expect(html).toContain('animate-pulse');
    expect((html.match(/<img /g) || []).length).toBe(parts.filter((p) => p.path).length - 1);
  });

  it('is one scroll-free column of calm tiles: gaps, no toolbar of its own', () => {
    const html = render(QUESTION_5B);
    expect(html).toContain('flex flex-col gap-3');
    expect(html).not.toContain('<header');
    expect(html).not.toContain('overflow-y-auto');
  });
});

describe('tap to move the highlight is a view aid only', () => {
  it('focusedPartId defaults to the checked question and ignores a stale pick', () => {
    const ids = ['root', 'a', 'b'];
    expect(focusedPartId(null, 'b', ids)).toBe('b');
    expect(focusedPartId({ questionId: 'b', partId: 'a' }, 'b', ids)).toBe('a');
    // Moved on to another question: back to its own part.
    expect(focusedPartId({ questionId: 'b', partId: 'a' }, 'c', ['root', 'c'])).toBe('c');
    // A row that is no longer there.
    expect(focusedPartId({ questionId: 'b', partId: 'zz' }, 'b', ids)).toBe('b');
  });

  const screen = readFileSync(resolve(__dirname, './VerifyScreen.tsx'), 'utf8');
  const focusFn = screen.slice(screen.indexOf('const focusPart ='), screen.indexOf('\n  };', screen.indexOf('const focusPart =')) + 5);

  it('focusPart only sets the view pick: no outbox, lease, save or question change', () => {
    expect(focusFn).toContain('setFocusPick(');
    for (const forbidden of ['outbox', 'lease', 'api.', 'setQuestion', 'submit', 'save', 'advance', 'navigate']) {
      expect(focusFn.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it('the checked question is still `question`, never the focus', () => {
    // The focus feeds only the highlight, the reveal key and the Enlarge picture.
    const uses = screen.split('focusId').length - 1;
    expect(uses).toBeGreaterThan(5);
    expect(screen).not.toMatch(/question\s*=\s*[^;]*focusId/);
    expect(screen).not.toMatch(/(submitVerdict|enqueue|sendVerdict|passQuestion|fixQuestion)\([^)]*focusId/);
    expect(screen).toContain('useEffect(() => setFocusPick(null), [mode])');
  });

  it('a read-only part, and a calm card, move the highlight when tapped; the editing card stays put', () => {
    const rows = wholeQuestionRows(assembleQuestionContext(dummyContext(QUESTION_5B), QUESTION_5B));
    const part = renderToStaticMarkup(<ContextPart row={rows[1]} focused onFocus={() => undefined} />);
    expect(part).toContain('role="button"');
    expect(part).toContain('data-focused="true"');
    expect(part).toContain('border-brand');
    const plain = renderToStaticMarkup(<ContextPart row={rows[1]} />);
    expect(plain).not.toContain('role="button"');
    const card = (focused: boolean, mode: 'read' | 'edit') =>
      renderToStaticMarkup(<PartCard mode={mode} body="x" options={null} focused={focused} onFocus={() => undefined} />);
    expect(card(true, 'read')).toContain('data-focused="true"');
    expect(card(false, 'read')).not.toContain('data-focused');
    expect(card(false, 'read')).toContain('border-warm-hairline');
    // Editing keeps its ring even while the view looks at another part.
    expect(card(false, 'edit')).toContain('border-brand');
    expect(card(false, 'edit')).toContain('ring-2 ring-brand/30');
  });

  it('a stand-alone question is unchanged: no tiles, the single picture path', () => {
    expect(screen).toContain('tilesOn ? partsBody : cropVisible ? cropBody(false) : null');
    expect(screen).toContain('cropBody(true)');
    expect(planPartPictures(wholeQuestionRows(assembleQuestionContext([], 'q1')))).toBeNull();
  });
});
