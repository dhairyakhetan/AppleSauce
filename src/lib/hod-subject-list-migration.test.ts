import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* 20261012960000_hod_subject_list_and_profile_limits.sql cannot run in CI (no database), so its
   load-bearing lines are pinned here: hod_list_subjects() is gated on is_hod() and closed to
   public, anon AND authenticated before being granted to authenticated, and
   hod_set_verifier_profile carries the same length limits as verifier_set_my_profile.

   Rehearsed 12 October 2026 in a rolled-back transaction: anon and a plain student refused
   (42501) on both functions, an admin (which counts as an HOD) allowed, a name of 121, a school
   of 161, a board of 61 characters and grade 18 each refused with 22023, and an edit exactly at
   the limits (with surrounding spaces) stored trimmed with one audit row. Then applied and
   checked with has_function_privilege. */

const raw = readFileSync('supabase/migrations/20261012960000_hod_subject_list_and_profile_limits.sql', 'utf8');
const sql = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

function body(fn: string): string {
  const start = sql.indexOf(`create or replace function public.${fn}(`);
  expect(start, fn).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf('$function$;', sql.indexOf('as $function$', start)));
}

describe('hod_list_subjects', () => {
  const b = body('hod_list_subjects');
  it('is security definer with a pinned search path and an is_hod() check raising 42501', () => {
    expect(b).toContain('security definer');
    expect(b).toContain('set search_path = public, pg_temp');
    expect(b).toContain('if not public.is_hod() then');
    expect(b).toContain("errcode = '42501'");
  });
  it('returns only id, name and slug of the subjects table', () => {
    expect(b).toContain('returns table (id uuid, name text, slug text)');
    expect(b).toContain('select s.id, s.name, s.slug');
    expect(b).toContain('from public.subjects s');
  });
});

describe('grants', () => {
  it('closes both functions to public, anon and authenticated, then grants authenticated only', () => {
    for (const sig of ['hod_list_subjects()', 'hod_set_verifier_profile(uuid, text, integer, text, text, date)']) {
      expect(sql, sig).toContain(`revoke all on function public.${sig} from public, anon, authenticated;`);
      expect(sql, sig).toContain(`grant execute on function public.${sig} to authenticated;`);
    }
    expect(sql).not.toMatch(/grant\s+execute[^;]*\bto\s+(anon|public)\b/i);
  });
});

describe('hod_set_verifier_profile limits', () => {
  const b = body('hod_set_verifier_profile');
  it('keeps the HOD check and the grade rule', () => {
    expect(b).toContain('if not public.is_hod() then');
    expect(b).toContain("if p_grade is null or p_grade not between 1 and 17 then raise exception 'Grade is out of range' using errcode = '22023'");
  });
  it('limits name 120, school 160, board 60 after trimming, with 22023, as verifier_set_my_profile does', () => {
    expect(b).toContain("length(btrim(coalesce(p_full_name, ''))) > 120");
    expect(b).toContain("length(btrim(coalesce(p_school, ''))) > 160");
    expect(b).toContain("length(btrim(coalesce(p_board, ''))) > 60");
    expect((b.match(/errcode = '22023'/g) ?? []).length).toBe(4);
    const own = readFileSync('supabase/migrations/20261011220000_verifier_profile_length_limits.sql', 'utf8');
    expect(own).toContain('> 120');
    expect(own).toContain('> 160');
    expect(own).toContain('> 60');
  });
  it('stores trimmed values and still writes the audit row', () => {
    expect(b).toContain("nullif(btrim(p_full_name), '')");
    expect(b).toContain("nullif(btrim(p_school), '')");
    expect(b).toContain("nullif(btrim(p_board), '')");
    expect(b).toContain("'hod_set_verifier_profile'");
    expect(b).toContain('insert into public.audit_review_log');
  });
  it('keeps the signature, so callers and the existing grant still match', () => {
    expect(sql).toContain("p_valid_until date default '2027-03-31'::date");
    expect(sql).toMatch(/returns void\s+language plpgsql\s+security definer/);
  });
});
