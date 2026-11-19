import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import {
  formatGrade,
  gradeSelectValue,
  isVerifierGrade,
  normaliseProfile,
  VERIFIER_GRADE_OPTIONS,
} from '@/lib/verifier-papers';
import { createFakeHodApi } from '@/dummy/hod-fake-api';

/* Owner, 2026-10-08: the verifier grade list runs Under grade 6, Grade 6 to
   12, UG 1st to 4th year, Beyond UG. One plain integer: 5, 6..12, 13..16, 17. */

describe('the verifier grade list', () => {
  it('is in the owner order, with Not given first', () => {
    expect(VERIFIER_GRADE_OPTIONS.map((o) => o.label)).toEqual([
      'Not given',
      'Under grade 6',
      'Grade 6',
      'Grade 7',
      'Grade 8',
      'Grade 9',
      'Grade 10',
      'Grade 11',
      'Grade 12',
      'UG 1st year',
      'UG 2nd year',
      'UG 3rd year',
      'UG 4th year',
      'Beyond UG',
    ]);
  });

  it('stores Under grade 6 as 5, Grade N as N, UG as 13 to 16, Beyond UG as 17, Not given as null', () => {
    expect(VERIFIER_GRADE_OPTIONS.map((o) => o.value)).toEqual([null, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  });

  it('every stored value is a valid grade and reads back as its own label', () => {
    for (const o of VERIFIER_GRADE_OPTIONS) {
      if (o.value === null) continue;
      expect(isVerifierGrade(o.value)).toBe(true);
      expect(formatGrade(o.value)).toBe(o.label);
    }
  });

  it('has no em or en dashes in any label', () => {
    for (const o of VERIFIER_GRADE_OPTIONS) expect(o.label).not.toMatch(/[–—]/);
  });
});

describe('formatGrade', () => {
  it('names every band', () => {
    expect(formatGrade(null)).toBe('Not set');
    expect(formatGrade(5)).toBe('Under grade 6');
    expect(formatGrade(6)).toBe('Grade 6');
    expect(formatGrade(12)).toBe('Grade 12');
    expect(formatGrade(13)).toBe('UG 1st year');
    expect(formatGrade(14)).toBe('UG 2nd year');
    expect(formatGrade(15)).toBe('UG 3rd year');
    expect(formatGrade(16)).toBe('UG 4th year');
    expect(formatGrade(17)).toBe('Beyond UG');
  });

  it('reads legacy rows 1 to 4 as Under grade 6', () => {
    for (const g of [1, 2, 3, 4]) expect(formatGrade(g)).toBe('Under grade 6');
  });

  it('treats anything outside 1 to 17 as not set', () => {
    expect(formatGrade(0)).toBe('Not set');
    expect(formatGrade(18)).toBe('Not set');
    expect(formatGrade(9.5)).toBe('Not set');
  });
});

describe('gradeSelectValue and the profile reader', () => {
  it('shows legacy 1 to 4 as the Under grade 6 option, so the select never goes blank', () => {
    expect(gradeSelectValue(3)).toBe('5');
    expect(gradeSelectValue(5)).toBe('5');
    expect(gradeSelectValue(10)).toBe('10');
    expect(gradeSelectValue(16)).toBe('16');
    expect(gradeSelectValue(null)).toBe('');
    expect(gradeSelectValue(18)).toBe('');
  });

  it('reads grades 1 to 17 and drops 0 and 18', () => {
    for (const g of [1, 5, 12, 13, 17]) expect(normaliseProfile({ grade: g })?.grade).toBe(g);
    for (const g of [0, 18, -1]) expect(normaliseProfile({ grade: g })?.grade).toBeNull();
  });
});

describe('dummy HOD api takes the new range', () => {
  it('saves 13 to 17 and refuses 0 and 18', async () => {
    const api = createFakeHodApi();
    const team = await api.team();
    const who = team[0];
    const input = { full_name: 'V', school: 'S', board: 'ICSE', valid_until: '2027-03-31' };
    for (const g of [13, 17]) {
      await api.setProfile(who.user_id, { ...input, grade: g });
      expect((await api.profiles()).find((p) => p.user_id === who.user_id)?.grade).toBe(g);
    }
    for (const g of [0, 18]) {
      await expect(api.setProfile(who.user_id, { ...input, grade: g })).rejects.toBeTruthy();
    }
  });
});

describe('20261008130000 verifier grade range migration', () => {
  const sql = readFileSync(resolve(__dirname, '../../supabase/migrations/20261008130000_verifier_grade_range.sql'), 'utf8');

  it('widens the check to null or 1 to 17, keeping legacy rows valid', () => {
    expect(sql).toContain('check (grade is null or grade between 1 and 17)');
    expect(sql).toContain('drop constraint');
  });

  it('replaces both setters with the same signatures, range 1 to 17, no old message', () => {
    expect(sql).toContain('create or replace function public.hod_set_verifier_profile(p_user_id uuid, p_full_name text, p_grade integer,');
    expect(sql).toContain('create or replace function public.verifier_set_my_profile(');
    expect(sql).toContain('p_grade is null or p_grade not between 1 and 17');
    expect(sql).toContain('p_grade is not null and p_grade not between 1 and 17');
    expect(sql).toContain("raise exception 'Grade is out of range'");
    expect(sql).not.toContain('Grade must be 1 to 12');
    expect(sql).not.toMatch(/between 1 and 12/);
  });

  it('keeps the auth gates and the audit log lines of the originals', () => {
    expect(sql).toContain('if not public.is_hod() then');
    expect(sql).toContain('if not public.is_paper_checker() then');
    expect(sql).toContain("'hod_set_verifier_profile'");
    expect(sql).toContain("'verifier_set_my_profile'");
    expect(sql).toContain('security definer');
  });

  it('revokes from public, anon and authenticated, then grants to authenticated only', () => {
    expect(sql).toContain('revoke all on function %s from public, anon, authenticated');
    expect(sql).toContain('grant execute on function %s to authenticated');
    expect(sql).not.toMatch(/grant execute[^;]*\banon\b/i);
    expect(sql).not.toMatch(/grant execute[^;]*\bpublic\b[^;]*\bto\b/i);
    expect(sql).toContain("'public.hod_set_verifier_profile(uuid, text, integer, text, text, date)'");
    expect(sql).toContain("'public.verifier_set_my_profile(text, integer, text, text)'");
  });

  it('refuses to half-apply', () => {
    expect(sql).toContain("raise exception 'patch did not apply");
  });

  it('leaves public.class_grade alone (paper classes stay 1 to 12)', () => {
    expect(sql).not.toMatch(/function public\.class_grade/);
    expect(sql).not.toMatch(/alter function public\.class_grade/i);
  });

  it('has no em or en dashes', () => {
    expect(sql).not.toMatch(/[–—]/);
  });
});
