import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import { verifierQuestionDiagrams, type QuestionDiagram } from '@/lib/checker-api';
import { DIAGRAM_CHECK_LINE, diagramHeading, diagramItems, diagramPaths, diagramsKey, withoutShownFigureFlag } from '@/lib/checker-diagrams';
import { QuestionDiagrams } from '@/components/checker/QuestionDiagrams';
import { createFakeCheckerApi } from '@/dummy/checker-fake-api';
import { DUMMY_DIAGRAM_PATH, dummyQuestions } from '@/dummy/checker-fixtures';

/* Owner, 6 November 2026: "when i am checking questions and it has an accompanying diagram, it should
   also show to the checker". Many flagged questions already had their diagram cut out and stored, but the
   verify screen never asked for it. These tests pin: the read never throws (the database function may not
   be applied yet), only plain object paths are used, stem diagrams come first, a link still loading never
   holds the question, the screen draws the block in both layouts, and the database function is read-only,
   gated and closed to signed-out visitors. */

const d = (id: string, extra: Partial<QuestionDiagram> = {}): QuestionDiagram => ({
  id, path: `paper/${id}.png`, page: 2, ord: 1, width: 300, height: 200, kind: 'diagram', caption: null, fromStem: false, ...extra,
});

describe('verifierQuestionDiagrams (the read)', () => {
  beforeEach(() => {
    rpc.mockReset();
  });

  it('asks the database function by question and maps the rows', async () => {
    rpc.mockResolvedValue({
      data: [
        { figure_id: 'f1', question_id: 'q0', storage_path: 'p/f1.png', page: 3, ord: 1, width: 855, height: 384, kind: 'diagram', caption: ' Fig 1 ', from_stem: true },
        { figure_id: 'f2', question_id: 'q1', storage_path: 'p/f2.png', page: null, ord: 2, width: null, height: null, kind: 'photo', caption: null, from_stem: false },
      ],
      error: null,
    });
    const out = await verifierQuestionDiagrams('q1');
    expect(rpc).toHaveBeenCalledWith('verifier_question_diagrams', { p_question_id: 'q1' });
    expect(out).toEqual([
      { id: 'f1', path: 'p/f1.png', page: 3, ord: 1, width: 855, height: 384, kind: 'diagram', caption: 'Fig 1', fromStem: true },
      { id: 'f2', path: 'p/f2.png', page: null, ord: 2, width: null, height: null, kind: 'photo', caption: null, fromStem: false },
    ]);
  });

  it('never throws: a missing function, a refusal, a bad shape or a network failure all give an empty list', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42883', message: 'function does not exist' } });
    expect(await verifierQuestionDiagrams('q1')).toEqual([]);
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Not authorized' } });
    expect(await verifierQuestionDiagrams('q1')).toEqual([]);
    rpc.mockResolvedValue({ data: { not: 'a list' }, error: null });
    expect(await verifierQuestionDiagrams('q1')).toEqual([]);
    rpc.mockRejectedValue(new Error('Failed to fetch'));
    expect(await verifierQuestionDiagrams('q1')).toEqual([]);
  });

  it('asks nothing for an empty question id', async () => {
    expect(await verifierQuestionDiagrams('')).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('drops a row whose path is empty, absolute or climbs out of the bucket', async () => {
    rpc.mockResolvedValue({
      data: [
        { figure_id: 'a', storage_path: '', kind: 'diagram' },
        { figure_id: 'b', storage_path: '/etc/x.png', kind: 'diagram' },
        { figure_id: 'c', storage_path: '../other/x.png', kind: 'diagram' },
        { figure_id: 'd', storage_path: 'paper/ok.png', kind: 'diagram' },
      ],
      error: null,
    });
    const out = await verifierQuestionDiagrams('q1');
    expect(out.map((x) => x.id)).toEqual(['d']);
  });
});

describe('diagram helpers', () => {
  const list = [d('stem', { fromStem: true }), d('own'), d('late')];

  it('names the paths by id, and the set by question', () => {
    expect(diagramPaths(list)).toEqual({ stem: 'paper/stem.png', own: 'paper/own.png', late: 'paper/late.png' });
    expect(diagramsKey('q1', list)).toBe('q1|stem:paper/stem.png,own:paper/own.png,late:paper/late.png');
  });

  it('asks for nothing when there is no question or no diagram', () => {
    expect(diagramsKey('q1', [])).toBe('');
    expect(diagramsKey(null, list)).toBe('');
    expect(diagramsKey(undefined, list)).toBe('');
  });

  it('keeps the order given (stem first) and leaves out a link that is loading or failed', () => {
    const items = diagramItems(list, { stem: 'https://x/stem', own: undefined, late: null });
    expect(items.map((i) => i.id)).toEqual(['stem']);
    const all = diagramItems(list, { stem: 'https://x/stem', own: 'https://x/own', late: 'https://x/late' });
    expect(all.map((i) => i.id)).toEqual(['stem', 'own', 'late']);
    expect(all[0].fromStem).toBe(true);
    expect(all[1].alt).toBe('Diagram 2 of 3 for this question');
  });

  it('says "the diagram" for one and "the diagrams" for several', () => {
    expect(diagramHeading(1)).toBe('The diagram for this question');
    expect(diagramHeading(2)).toBe('The diagrams for this question');
    expect(diagramItems([d('one')], { one: 'https://x/one' })[0].alt).toBe('The diagram for this question');
  });
});

describe('the tips no longer say the diagram is missing once it is on screen', () => {
  it('leaves "figure missing" out only while a diagram is shown, and keeps the other flags', () => {
    const flags = ['marks_mismatch', 'figure_missing', 'figure_ambiguous'];
    expect(withoutShownFigureFlag(flags, true)).toEqual(['marks_mismatch', 'figure_ambiguous']);
    expect(withoutShownFigureFlag(flags, false)).toEqual(flags);
    expect(withoutShownFigureFlag(null, true)).toEqual([]);
    expect(withoutShownFigureFlag(undefined, false)).toEqual([]);
  });

  it('the screen writes the tips from those flags, not from the raw ones', () => {
    const screen = readFileSync('src/components/checker/VerifyScreen.tsx', 'utf8');
    expect(screen).toContain('withoutShownFigureFlag(question.flag_reasons, diagramShown.length > 0)');
    expect(screen).toContain('whatToCheck(guidanceFlags, question.flag_detail');
    expect(screen).toContain('describeLanes(guidanceFlags, question.flag_detail)');
    // the diagram list is known before the tips are worked out
    expect(screen.indexOf('const diagramShown =')).toBeLessThan(screen.indexOf('const guidanceFlags ='));
  });

  it('the diagram block says what to do with it', () => {
    const html = renderToStaticMarkup(<QuestionDiagrams items={[{ id: 'a', url: 'https://x/a.png', alt: 'The diagram for this question', fromStem: false }]} onEnlarge={() => {}} />);
    expect(html).toContain(DIAGRAM_CHECK_LINE);
    expect(DIAGRAM_CHECK_LINE).not.toMatch(/[–—]/);
  });
});

describe('QuestionDiagrams (what is drawn)', () => {
  it('draws nothing when the question has no diagram', () => {
    expect(renderToStaticMarkup(<QuestionDiagrams items={[]} onEnlarge={() => {}} />)).toBe('');
  });

  it('draws each diagram as a picture the checker can enlarge, with a heading and no dashes', () => {
    const html = renderToStaticMarkup(
      <QuestionDiagrams
        items={[
          { id: 'a', url: 'https://x/a.png', alt: 'Diagram 1 of 2 for this question', fromStem: true },
          { id: 'b', url: 'https://x/b.png', alt: 'Diagram 2 of 2 for this question', fromStem: false },
        ]}
        onEnlarge={() => {}}
      />,
    );
    expect(html).toContain('data-testid="question-diagrams"');
    expect(html).toContain('The diagrams for this question');
    expect(html.match(/data-testid="diagram-item"/g)).toHaveLength(2);
    expect(html).toContain('src="https://x/a.png"');
    expect(html).toContain('alt="Diagram 2 of 2 for this question"');
    expect(html).toContain('aria-label="Enlarge: Diagram 1 of 2 for this question"');
    expect(html).not.toMatch(/[–—]/);
  });
});

describe('the verify screen draws it in both layouts', () => {
  const screen = readFileSync('src/components/checker/VerifyScreen.tsx', 'utf8');

  it('asks for the diagrams of the open question and signs their links like the crop', () => {
    expect(screen).toContain("queryKey: ['checker-question-diagrams', scope, question?.id ?? null]");
    expect(screen).toContain('api.questionDiagrams(question!.id)');
    expect(screen).toContain('useSignedUrls(picApi, diagramsKey(question?.id, diagramList), diagramPaths(diagramList))');
    expect(screen).toContain('const diagramShown = diagramItems(diagramList, diagramUrls);');
  });

  it('draws the block with the question itself (the left side), once for a part of a bigger question and once for a plain one', () => {
    // one block is built, and the question side uses it in both of its shapes
    expect([...screen.matchAll(/<QuestionDiagrams items=\{diagramShown\}/g)]).toHaveLength(1);
    const uses = [...screen.matchAll(/\{diagramBlock\}/g)].map((m) => m.index as number);
    expect(uses).toHaveLength(2);
    const leftContent = screen.indexOf('const leftContent');
    const printedPane = screen.indexOf('const printedPane');
    expect(screen.indexOf('const diagramBlock')).toBeLessThan(leftContent);
    // both uses sit inside the question side and before the printed-page side
    for (const u of uses) {
      expect(u).toBeGreaterThan(leftContent);
      expect(u).toBeLessThan(printedPane);
    }
  });

  it('keeps the diagram off the page picture side, so it is never shown twice', () => {
    const printedPane = screen.indexOf('const printedPane');
    const wide = screen.indexOf('data-testid="bento-right"');
    expect(screen.indexOf('<QuestionDiagrams', printedPane)).toBe(-1);
    expect(screen.indexOf('<QuestionDiagrams', wide)).toBe(-1);
  });

  it('opens a tapped diagram in the same viewer as the crop', () => {
    expect(screen).toContain('<QuestionDiagrams items={diagramShown} onEnlarge={(src, alt) => setLightbox({ src, alt })}');
  });
});

describe('the demo data has a diagram too', () => {
  it('gives a flagged "figure missing" demo question its stored diagram, and the others none', async () => {
    const api = createFakeCheckerApi();
    const qs = dummyQuestions();
    const flagged = qs.find((q) => q.flag_reasons?.includes('figure_missing'));
    const plain = qs.find((q) => !q.flag_reasons?.includes('figure_missing'));
    expect(flagged).toBeDefined();
    expect(plain).toBeDefined();
    const got = await api.questionDiagrams(flagged!.id);
    expect(got).toHaveLength(1);
    expect(got[0].path).toBe(DUMMY_DIAGRAM_PATH);
    expect(await api.questionDiagrams(plain!.id)).toEqual([]);
    expect(await api.questionDiagrams('not-a-demo-question')).toEqual([]);
    expect(await api.pictureUrl(DUMMY_DIAGRAM_PATH)).toMatch(/^data:image\/svg\+xml/);
  });
});

describe('verifier_question_diagrams (the database function)', () => {
  const raw = readFileSync('supabase/migrations/20261106200000_verifier_question_diagrams.sql', 'utf8');
  const sql = raw
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  it('is read-only, a definer function with a pinned search path, and gates the caller first', () => {
    expect(sql).toContain('create or replace function public.verifier_question_diagrams(p_question_id uuid)');
    expect(sql).toContain('security definer');
    expect(sql).toContain('set search_path = public, pg_temp');
    expect(sql).toMatch(/\bstable\b/);
    expect(sql).not.toMatch(/\b(insert into|update public|delete from|truncate|alter table|drop function|drop table)\b/i);
    const gate = sql.indexOf('if not (public.is_paper_checker() or public.is_hod()) then');
    expect(gate).toBeGreaterThan(-1);
    expect(sql.indexOf("errcode = '42501'")).toBeGreaterThan(gate);
    expect(sql.indexOf('return query')).toBeGreaterThan(gate);
  });

  it('only returns what the caller may open, only active figures, the stem first, up to four levels', () => {
    expect(sql).toContain('public.checker_can_see_audit_object(f.storage_path)');
    expect(sql).toContain("f.status = 'active'");
    expect(sql).toContain('f.storage_path is not null');
    expect(sql).toContain('order by c.depth desc, f.ord, f.created_at');
    expect(sql).toContain('where c.depth < 4');
    expect(sql).toContain('(c.depth > 0)');
  });

  it('is closed to public, anon and authenticated, then granted to authenticated only', () => {
    expect(sql).toContain('revoke all on function public.verifier_question_diagrams(uuid) from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.verifier_question_diagrams(uuid) to authenticated;');
    expect(sql).not.toMatch(/grant\s+execute[^;]*\bto\s+(anon|public)\b/i);
  });

  it('returns the columns the screen reads', () => {
    for (const col of ['figure_id uuid', 'question_id uuid', 'storage_path text', 'page integer', 'ord integer', 'width integer', 'height integer', 'kind text', 'caption text', 'from_stem boolean']) {
      expect(sql, col).toContain(col);
    }
  });
});
