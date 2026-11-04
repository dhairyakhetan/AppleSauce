import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* The students-first change (owner decision 2026-10-12) cannot run in CI (no
   database), so its load-bearing lines are pinned here.

   20261012900000_checks_need_a_person_verdict.sql   the check "Every question is checked"
   20261012910000_trail_needs_a_person_verdict.sql   the route trail
   supabase/ops/20261012_students_first.sql          the one-off data move (not a migration)

   Rehearsed 12 October 2026 in a rolled-back transaction: anon and a plain student
   refused (42501) on the helper, the checks and the trail; an HOD and an admin
   allowed; the 29 AI-only questions of the retro paper read "checked by the AI
   only"; the data move touched 96 audit questions (75 AI-only passes and 21
   admin-bucket questions) in 7 papers, with question text hashes unchanged. Then
   applied, and has_function_privilege checked. */

function strip(path: string): string {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

const checks = strip('supabase/migrations/20261012900000_checks_need_a_person_verdict.sql');
const trail = strip('supabase/migrations/20261012910000_trail_needs_a_person_verdict.sql');
const ops = strip('supabase/ops/20261012_students_first.sql');

describe('checks need a person verdict', () => {
  it('defines the helper as security definer with a pinned path and closes it to every API role', () => {
    const start = checks.indexOf('create or replace function public.approval_person_verdict(');
    expect(start).toBeGreaterThan(-1);
    const b = checks.slice(start, checks.indexOf('$$;', start));
    expect(b).toContain('security definer');
    expect(b).toContain('set search_path = public, pg_temp');
    expect(b).toContain('p_checked_by_user is not null');
    expect(b).toContain('l.undone_at is null');
    expect(b).toContain('l.actor_user_id is not null');
    expect(b).toContain("'checker_pass', 'checker_fix', 'checker_printed_typo', 'admin_pass'");
    // the AI actions must never count as a person
    expect(b).not.toMatch(/'ai_[a-z_]+'/);
    expect(b).not.toContain('live_match_loop_resolve');
    expect(checks).toContain('revoke all on function public.approval_person_verdict(uuid, uuid) from public, anon, authenticated;');
    expect(checks).not.toMatch(/grant\s+execute[^;]*approval_person_verdict/i);
  });

  it('counts AI-only passes as open, with the words "checked by the AI only"', () => {
    expect(checks).toContain('not public.approval_person_verdict(q.id, q.checked_by_user)');
    expect(checks).toContain("v_open_eff := v_open + v_ai_only;");
    expect(checks).toContain("' checked by the AI only'");
    expect(checks).toContain("'ok', v_total > 0 and v_open_eff = 0 and v_passed > 0");
    expect(checks).toContain("'open', v_open_eff");
  });

  it('leaves frozen live copies on the old rule and keeps the other three checks', () => {
    expect(checks).toContain("if v_source is distinct from 'live_copy' then");
    for (const key of ['pictures_present', 'header_complete', 'scanner_junk_gone']) {
      expect(checks).toContain(`'key', '${key}'`);
    }
    expect(checks).toContain("'left_out', v_aside");
    expect(checks).toContain('revoke all on function public.approval_paper_checks(uuid) from public, anon, authenticated;');
    expect(checks).not.toMatch(/grant\s+execute[^;]*\bto\s+(anon|public)\b/i);
  });
});

describe('the route trail needs a person verdict', () => {
  it('is gated on is_hod(), closed by name and granted to authenticated only', () => {
    expect(trail).toContain('security definer');
    expect(trail).toContain('set search_path = public, pg_temp');
    expect(trail).toContain('if not public.is_hod() then');
    expect(trail).toContain("errcode = '42501'");
    expect(trail).toContain('revoke all on function public.hod_paper_trail() from public, anon, authenticated;');
    expect(trail).toContain('grant execute on function public.hod_paper_trail() to authenticated;');
    expect(trail).not.toMatch(/grant\s+execute[^;]*\bto\s+(anon|public)\b/i);
  });

  it('shows Ready only when no question lacks a person verdict, and keeps Maths live copies out', () => {
    expect(trail).toContain("when ap.approval_state = 'awaiting' and c.no_person = 0 then 'ready'");
    expect(trail).toContain("count(*) filter (where s.st in ('open', 'passed') and not s.pv) as no_person");
    expect(trail).toContain('public.approval_person_verdict(q.id, q.checked_by_user) as pv');
    expect(trail).toContain("where ap.source <> 'live_copy'");
  });

  it('puts a paper at Needs you only for escalated or admin-bucket open questions', () => {
    expect(trail).toContain("count(*) filter (where s.st = 'open' and s.bucket in ('escalated', 'admin')) as need");
    expect(trail).toContain("when c.need > 0 then 'needs_you'");
  });

  it('keeps the return shape the front end reads', () => {
    for (const col of [
      'audit_paper_id uuid', 'stage text', 'total integer', 'passed integer', 'checking integer',
      'needs_you integer', 'set_aside integer', 'title text', 'subject text', 'cls text', 'school text', 'is_live boolean',
    ]) {
      expect(trail).toContain(col);
    }
  });
});

describe('the students-first data move (ops file)', () => {
  it('runs as one transaction on audit tables only', () => {
    expect(ops).toMatch(/^\s*begin;/m);
    expect(ops).toMatch(/^\s*commit;/m);
    expect(ops).not.toMatch(/(update|insert\s+into|delete\s+from|alter\s+table)\s+public\.bank_/i);
    expect(ops).not.toMatch(/(update|delete\s+from)\s+public\.(bank_|papers\b|teachers)/i);
  });

  it('never touches question text', () => {
    const upd = ops.slice(ops.indexOf('update public.audit_questions q'), ops.indexOf('update public.audit_papers ap'));
    expect(upd).toContain('question_passed = false');
    expect(upd).toContain("review_bucket = 'kid'");
    expect(upd).not.toMatch(/\bbody\b|\boptions\b|\binstructions\b|flag_reasons/);
  });

  it('excludes live copies and set-aside questions, and picks AI-only passes and the admin bucket', () => {
    expect(ops).toContain("ap.source <> 'live_copy'");
    expect(ops).toContain('q.set_aside_at is null');
    expect(ops).toContain('q.question_passed and not public.approval_person_verdict(q.id, q.checked_by_user)');
    expect(ops).toContain("not q.question_passed and q.review_bucket = 'admin'");
  });

  it('backs up first, closes the backups to API roles, and logs one row per moved question', () => {
    const iBackup = ops.indexOf('create table public.audit_students_first_backup_20261012');
    const iUpdate = ops.indexOf('update public.audit_questions q');
    expect(iBackup).toBeGreaterThan(-1);
    expect(iBackup).toBeLessThan(iUpdate);
    expect(ops).toContain('audit_students_first_backup_papers_20261012');
    expect(ops).toContain('revoke all on table public.audit_students_first_backup_20261012 from public, anon, authenticated;');
    expect(ops).toContain('revoke all on table public.audit_students_first_backup_papers_20261012 from public, anon, authenticated;');
    expect(ops).toContain("'moved_to_students'");
    expect(ops).toContain("'owner decision 2026-10-12: students first'");
    expect(ops.indexOf('insert into public.audit_review_log')).toBeLessThan(iUpdate);
  });

  it('takes the retro paper out of Ready', () => {
    expect(ops).toContain('set approval_state = null');
    expect(ops).toContain("ap.approval_state = 'awaiting' and ap.approval_kind = 'retro'");
  });

  it('uses no em or en dashes', () => {
    for (const text of [checks, trail, ops]) {
      expect(text).not.toMatch(/[–—]/);
    }
    for (const p of [
      'supabase/migrations/20261012900000_checks_need_a_person_verdict.sql',
      'supabase/migrations/20261012910000_trail_needs_a_person_verdict.sql',
      'supabase/ops/20261012_students_first.sql',
    ]) {
      expect(readFileSync(p, 'utf8')).not.toMatch(/[–—]/);
    }
  });
});
