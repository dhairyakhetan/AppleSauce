import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* 20261113310000_hod_lists_speed.sql cannot run in CI (no database), so its load-bearing lines are pinned here.
   The HOD lists were cut off at 8 seconds because an expensive per-question check ran on every open question and only
   then dropped the papers somebody already holds. The speed comes from narrowing to the right papers FIRST; the doors
   (HOD only, closed to signed-out visitors) and the output columns must not change. */

const raw = readFileSync('supabase/migrations/20261113310000_hod_lists_speed.sql', 'utf8');
const sql = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

function body(fn: string): string {
  const start = sql.indexOf(`create or replace function public.${fn}(`);
  expect(start).toBeGreaterThan(-1);
  const next = sql.indexOf('create or replace function', start + 10);
  return sql.slice(start, next === -1 ? sql.length : next);
}

describe('hod_unassigned_papers', () => {
  const b = body('hod_unassigned_papers');
  it('collects the free papers first and checks only their questions', () => {
    expect(b).toContain('v_free uuid[]');
    expect(b).toContain('q.paper_id = any (v_free)');
    expect(b.indexOf('array_agg(ap.id)')).toBeLessThan(b.indexOf('public.checker_question_servable(q)'));
  });
  it('keeps the HOD gate, the picture rule and the same output columns', () => {
    expect(b).toContain('if not public.is_hod() then');
    expect(b).toContain("errcode = '42501'");
    expect(b).toContain('public.paper_pictures_complete(c.pid)');
    expect(b).toContain('returns table(paper_id uuid, subject text, school text, cls text, exam text, year text, open_count integer)');
  });
});

describe('hod_held_back_papers', () => {
  const b = body('hod_held_back_papers');
  it('narrows to papers with an open question and no holder before it counts gaps', () => {
    expect(b).toContain('with cand as materialized');
    expect(b.indexOf("a.status in ('queued', 'assigned')")).toBeLessThan(b.indexOf('paper_picture_gaps(cand.id)'));
  });
  it('keeps the HOD gate and the same output columns', () => {
    expect(b).toContain('if not public.is_hod() then');
    expect(b).toContain('missing_snips integer, pages_total integer, pages_missing integer');
  });
});

describe('hod_paper_trail', () => {
  const b = body('hod_paper_trail');
  it('asks "did a person verify it" only for papers waiting for approval', () => {
    expect(b).toContain("case when ap.approval_state = 'awaiting'");
    expect(b).toContain('public.approval_person_verdict(q.id, q.checked_by_user)');
  });
  it('keeps the HOD gate and the live-copy exclusion', () => {
    expect(b).toContain("Only HODs and admins can use this.");
    expect(b).toContain("ap.source <> 'live_copy'");
  });
});

describe('doors', () => {
  it('closes all three to signed-out visitors and opens them to signed-in people', () => {
    for (const f of ['hod_unassigned_papers(integer)', 'hod_held_back_papers(integer)', 'hod_paper_trail()']) {
      expect(sql).toContain(`revoke all on function public.${f} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${f} to authenticated;`);
    }
  });
});
