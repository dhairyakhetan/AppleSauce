import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* 20261114100000_team_and_assignments_speed.sql cannot run in CI (no database), so its load-bearing lines are pinned here.
   The Team tab (hod_team) and "Who has what" (hod_assignments) were slow because the per-question check
   checker_question_servable ran once per open question and the database sets it up again on every call. The speed comes
   from one flat helper that does the same test once for all held papers; the rows, the HOD doors and the columns must not change. */

const raw = readFileSync('supabase/migrations/20261114100000_team_and_assignments_speed.sql', 'utf8');
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

describe('hod_held_papers_waiting (the flat helper)', () => {
  const b = body('hod_held_papers_waiting');
  it('looks only at papers somebody holds and groups per paper', () => {
    expect(b).toContain("a.status in ('queued', 'assigned')");
    expect(b).toContain('group by q.paper_id');
  });
  it('repeats every rule of checker_question_servable and reuses its three helpers', () => {
    expect(b).toContain("q.review_bucket = 'kid' and q.question_passed = false and q.kind = 'question'");
    expect(b).toContain('q.set_aside_at is null');
    expect(b).toContain('public.checker_body_ok(q)');
    expect(b).toContain('public.checker_has_picture(q)');
    expect(b).toContain('public.checker_reference_ok(q)');
    expect(b).toContain("'incomplete_text' = any");
    expect(b).toContain("<> 'english_w14'");
    expect(b).toContain("ap.source in ('live_copy', 'new_ocr')");
    expect(b).toContain("'pdf_mismatch'");
  });
  it('is not the slow per-question call and is closed to everyone but the lists that run as the owner', () => {
    expect(b).not.toContain('checker_question_servable');
    expect(sql).toContain('revoke all on function public.hod_held_papers_waiting() from public, anon, authenticated;');
    expect(sql).not.toContain('grant execute on function public.hod_held_papers_waiting()');
  });
  it('carries the marker the paste check looks for', () => {
    expect(raw).toContain('marker: held-papers-waiting-20261114');
  });
});

describe('hod_assignments', () => {
  const b = body('hod_assignments');
  it('reads the remaining count from the helper, not from the per-question check', () => {
    expect(b).toContain('public.hod_held_papers_waiting()');
    expect(b).toContain('coalesce(w.waiting, 0)');
    expect(b).not.toContain('checker_question_servable');
  });
  it('keeps the HOD gate, the filter, the order and the same output columns', () => {
    expect(b).toContain('if not public.is_hod() then');
    expect(b).toContain("errcode = '42501'");
    expect(b).toContain("where a.status in ('assigned', 'queued')");
    expect(b).toContain("order by 4, case a.status when 'assigned' then 0 else 1 end, a.assigned_at, a.id");
    expect(b).toContain(
      'returns table(assignment_id bigint, status text, user_id uuid, checker_name text, paper_id uuid, subject text, school text, cls text, exam text, year text, remaining integer, given_by_name text, assigned_at timestamp with time zone, started_at timestamp with time zone)',
    );
    expect(b).toContain('security definer');
    expect(b).toContain('set search_path = public, pg_temp');
  });
});

describe('hod_team', () => {
  const b = body('hod_team');
  it('reads the waiting count from the helper, per assignment, so papers held and waiting add up as before', () => {
    expect(b).toContain('public.hod_held_papers_waiting()');
    expect(b).toContain('sum(coalesce(w.waiting, 0))::int as waiting');
    expect(b).toContain('count(*)::int as papers');
    expect(b).not.toContain('checker_question_servable');
  });
  it('keeps the HOD gate, the counted views and the same output columns', () => {
    expect(b).toContain('if not public.is_hod() then');
    expect(b).toContain('public.audit_review_log_counted');
    expect(b).toContain('public.content_checks_counted');
    expect(b).toContain('order by p.active desc, 11 desc, 2');
    expect(b).toContain(
      'returns table(user_id uuid, name text, email text, active boolean, subjects text[], classes text[], papers_held integer, questions_waiting integer, reviewed_today integer, reviewed_7d integer, reviewed_all integer, papers_reviewed integer, passed_as_is integer, edited integer, escalated integer, skipped integer, skipped_done integer, overturned integer, last_active timestamp with time zone)',
    );
    expect(b).toContain('security definer');
    expect(b).toContain('set search_path = public, pg_temp');
  });
});

describe('markers and doors', () => {
  it('both lists carry the marker the paste check looks for', () => {
    expect(raw.split('marker: team-assignments-speed-20261114').length - 1).toBe(2);
  });
  it('closes both lists to signed-out visitors and opens them to signed-in people', () => {
    for (const f of ['hod_team()', 'hod_assignments()']) {
      expect(sql).toContain(`revoke all on function public.${f} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${f} to authenticated;`);
    }
  });
});
