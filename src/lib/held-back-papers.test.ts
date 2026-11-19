import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { heldBackWhy, normaliseHeldBack } from '@/lib/hod-api';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

/* Owner, 6 Nov 2026: "if papers dont have their supporting snips and all of the pages dont allow them to be
   assigned show them seperately". A paper can be given out only when every open question has its picture and
   every printed page is stored; the others get their own list that says what is missing. */

describe('normaliseHeldBack', () => {
  it('reads the rows and drops any without an id', () => {
    const out = normaliseHeldBack([
      { paper_id: 'p1', subject: 'History', school: 'Sample School', cls: 'X', exam: 'Annual', year: '2024', open_count: 9, missing_snips: 3, pages_total: 7, pages_missing: 2 },
      { subject: 'no id' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ paper_id: 'p1', open_count: 9, missing_snips: 3, pages_total: 7, pages_missing: 2 });
  });

  it('turns missing numbers into zeros and a non-list into an empty list', () => {
    expect(normaliseHeldBack([{ paper_id: 'p2' }])[0]).toMatchObject({ open_count: 0, missing_snips: 0, pages_total: 0, pages_missing: 0 });
    expect(normaliseHeldBack(null)).toEqual([]);
  });
});

describe('heldBackWhy (plain words)', () => {
  it('names both gaps', () => {
    expect(heldBackWhy({ missing_snips: 3, pages_total: 7, pages_missing: 2 })).toBe('3 questions have no picture. 2 of 7 printed pages are missing.');
  });

  it('says one question or one page in the singular', () => {
    expect(heldBackWhy({ missing_snips: 1, pages_total: 0, pages_missing: 0 })).toBe('1 question has no picture.');
    expect(heldBackWhy({ missing_snips: 0, pages_total: 1, pages_missing: 1 })).toBe('1 of 1 printed page is missing.');
  });

  it('never leaves the line blank, and has no dashes or database words', () => {
    expect(heldBackWhy({ missing_snips: 0, pages_total: 0, pages_missing: 0 })).toBe('Some pictures are missing.');
    for (const s of [heldBackWhy({ missing_snips: 2, pages_total: 5, pages_missing: 5 }), heldBackWhy({ missing_snips: 0, pages_total: 0, pages_missing: 4 })]) {
      expect(s).not.toMatch(/[–—]/);
      expect(s).not.toMatch(/snip|rpc|table|null/i);
    }
  });
});

describe('the database rule (migration 20261106400000)', () => {
  const sql = readFileSync('supabase/migrations/20261106400000_papers_missing_pictures_not_assignable.sql', 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');

  it('counts a paper complete only with no picture missing AND no page missing', () => {
    expect(sql).toContain('g.missing_snips = 0 and g.pages_missing = 0');
    expect(sql).toContain('not public.checker_has_picture(q)');
    expect(sql).toContain("coalesce(pg.object_path, '') <> ''");
    expect(sql).toContain('ap.page_count');
  });

  it('keeps incomplete papers out of the free list, the hand-out and the manual assign', () => {
    expect(sql).toContain('and public.paper_pictures_complete(c.paper_id)\n    order by ap.subject');
    expect(sql).toContain("'where ap.source is distinct from ''live_copy'' and public.paper_pictures_complete(c.paper_id)'");
    expect(sql).toContain('if v_prev.id is null and not public.paper_pictures_complete(p_paper_id) then');
    expect(sql).toContain('It is listed under Not ready to give out.');
  });

  it('never takes back a paper that is already held, and the new list leaves held papers out', () => {
    expect(sql).toContain('v_prev.id is null and not public.paper_pictures_complete');
    expect(sql).toContain("a.audit_paper_id = ap.id and a.status in ('queued', 'assigned')");
  });

  it('is gated to HODs, closed to anon, and patches asserting each swap', () => {
    expect(sql).toContain('if not public.is_hod() then');
    expect(sql).toContain('revoke all on function public.hod_held_back_papers(integer) from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.hod_held_back_papers(integer) to authenticated;');
    expect(sql).toContain('revoke all on function public.paper_pictures_complete(uuid) from public, anon, authenticated;');
    expect(sql).toContain("raise exception 'could not patch distribute_unassigned_papers (anchor not found)'");
    expect(sql).toContain("raise exception 'could not patch hod_assign_paper (anchor not found)'");
    expect(sql).not.toMatch(/\b(delete from|truncate|drop table|alter table)\b/i);
  });
});

describe('the screens', () => {
  it('the Assignments tab shows the not-ready papers in their own list, with no assign button on them', () => {
    const tab = readFileSync('src/components/hod/AssignmentsTab.tsx', 'utf8');
    const section = tab.slice(tab.indexOf('aria-labelledby="papers-not-ready"'), tab.indexOf('{confirmDialog}'));
    expect(tab).toContain('api.heldBackPapers(UNASSIGNED_SHOWN)');
    expect(section).toContain('Not ready to give out');
    expect(section).toContain('heldBackWhy(p)');
    expect(section).toContain('data-testid="not-ready-paper"');
    expect(section).not.toContain('Assign to');
    expect(section).not.toContain('api.assignPaper');
  });

  it('the real API reads hod_held_back_papers', () => {
    expect(readFileSync('src/lib/hod-api.ts', 'utf8')).toContain("call('hod_held_back_papers', { p_limit: limit })");
  });
});
