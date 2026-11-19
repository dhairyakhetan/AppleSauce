import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* 20261105100000_checker_counts_subjects_and_lock.sql cannot run in CI (no database), so its
   load-bearing lines are pinned here: the two counters count distinct questions from the counted
   log (so an undone answer does not count, and a re-saved question counts once), include the
   printed-typo fix, keep their gate and grants; checker_reference_ok is closed to the three roles
   by name; and the new subjects function is a read-only definer function behind is_paper_checker(),
   closed to public, anon AND authenticated before being granted to authenticated. */

const raw = readFileSync('supabase/migrations/20261105100000_checker_counts_subjects_and_lock.sql', 'utf8');
const sql = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

const body = (name: string) => {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} is defined`).toBeGreaterThan(-1);
  const end = sql.indexOf('$function$;', sql.indexOf('as $function$', start));
  return sql.slice(start, end);
};

describe('the two counters', () => {
  const ACTIONS = "('checker_pass', 'checker_fix', 'checker_printed_typo', 'checker_split', 'checker_ask_help')";

  it('keep their names, return types, gate and pinned search path (CREATE OR REPLACE keeps the grants)', () => {
    const stats = body('checker_my_stats');
    expect(stats).toContain('returns table (today_count bigint, total_count bigint)');
    expect(stats).toContain('security definer');
    expect(stats).toContain('set search_path = public, pg_temp');
    expect(stats).toContain('if not public.is_paper_checker() then');
    expect(stats).toContain("errcode = '42501'");
    const today = body('checker_checked_today_count');
    expect(today).toContain('returns integer');
    expect(today).toContain('if not public.is_paper_checker() then');
    expect(today).toContain("errcode = '42501'");
  });

  it('count distinct questions, not log lines, so a re-saved question counts once', () => {
    expect(body('checker_my_stats')).toContain('count(distinct l.question_id)');
    expect(body('checker_my_stats')).not.toMatch(/count\(\*\)/);
    expect(body('checker_checked_today_count')).toContain('count(distinct l.question_id)');
    expect(body('checker_checked_today_count')).not.toMatch(/count\(\*\)/);
  });

  it('include the printed-typo fix, and read the counted log of this verifier only', () => {
    for (const fn of ['checker_my_stats', 'checker_checked_today_count']) {
      const b = body(fn);
      expect(b).toContain(`l.action in ${ACTIONS}`);
      expect(b).toContain('from public.audit_review_log_counted l');
      expect(b).toContain('l.actor_user_id = auth.uid()');
      expect(b).not.toMatch(/from public\.audit_review_log l/);
    }
  });

  it('keep the Kolkata day, not the UTC day', () => {
    expect(body('checker_my_stats')).toContain("'Asia/Kolkata'");
    expect(body('checker_checked_today_count')).toContain("'Asia/Kolkata'");
  });

  it('leave skips and the OR separator out, on purpose', () => {
    expect(sql).not.toContain("'checker_skip'");
    expect(sql).not.toContain("'verifier_or_separator'");
  });
});

describe('checker_reference_ok', () => {
  it('is closed to public, anon and authenticated by name', () => {
    expect(sql).toContain('revoke all on function public.checker_reference_ok(public.audit_questions) from public, anon, authenticated;');
  });

  it('is never granted back to a client role', () => {
    expect(sql).not.toMatch(/grant\s+execute\s+on\s+function\s+public\.checker_reference_ok/i);
  });
});

describe('verifier_subjects_with_papers', () => {
  const start = sql.indexOf('create function public.verifier_subjects_with_papers()');
  const b = sql.slice(start, sql.indexOf('$function$;', sql.indexOf('as $function$', start)));

  it('is a read-only definer function behind is_paper_checker() with a pinned search path', () => {
    expect(start).toBeGreaterThan(-1);
    expect(b).toContain('returns text[]');
    expect(b).toContain('stable');
    expect(b).toContain('security definer');
    expect(b).toContain('set search_path = public, pg_temp');
    expect(b).toContain('if not public.is_paper_checker() then');
    expect(b).toContain("errcode = '42501'");
    expect(b).not.toMatch(/\b(insert|update|delete)\b/i);
  });

  it('uses the same subject families the server checks a request against', () => {
    expect(b).toContain('public.subject_family(p.subject)');
    expect(b).toContain('from public.audit_papers p');
  });

  it('is closed to public, anon and authenticated, then granted to authenticated only', () => {
    expect(sql).toContain('revoke all on function public.verifier_subjects_with_papers() from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.verifier_subjects_with_papers() to authenticated;');
    expect(sql).not.toMatch(/grant\s+execute[^;]*\bto\s+(anon|public)\b/i);
  });
});
