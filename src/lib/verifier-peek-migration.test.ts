import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* 20261012950000_verifier_peek_next_in_paper.sql cannot run in CI (no database), so
   its load-bearing lines are pinned here: a read-only (STABLE) security definer
   function with the same gate, servable rule and order as verifier_next_in_paper,
   no write anywhere, no question text in the result, and closed to public, anon
   AND authenticated before being granted to authenticated.

   Rehearsed 12 October 2026 in a rolled-back transaction: anon, a plain student
   and a verifier who does not hold the paper all refused (42501); the holder got
   1 to 3 rows (0 and null clamped to 1 and 2, 99 to 3); locked_by, locked_until
   and leased_at of every row of the paper identical before and after five peeks;
   verifier_next_in_paper then served exactly the row the peek had put first, and
   a skipped question was left out. Then applied and checked with
   has_function_privilege (anon false, authenticated true). */

const raw = readFileSync('supabase/migrations/20261012950000_verifier_peek_next_in_paper.sql', 'utf8');
const sql = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');
const next = readFileSync('supabase/migrations/20261011120000_verifier_returns_raw_ocr.sql', 'utf8');

describe('verifier_peek_next_in_paper migration', () => {
  it('is a STABLE security definer function with a pinned search path', () => {
    expect(sql).toContain('create or replace function public.verifier_peek_next_in_paper(p_audit_paper_id uuid, p_count integer default 2)');
    expect(sql).toMatch(/\bstable\b/);
    expect(sql).toContain('security definer');
    expect(sql).toContain('set search_path = public, pg_temp');
  });

  it('refuses non-checkers and checkers who do not hold the paper, both 42501', () => {
    expect(sql).toContain('if not public.is_paper_checker() then');
    expect(sql).toContain("a.status in ('queued', 'assigned')");
    expect(sql.match(/errcode = '42501'/g)?.length).toBe(2);
  });

  it('writes nothing and leases nothing', () => {
    expect(sql).not.toMatch(/\b(update|insert|delete)\b/i);
    expect(sql).not.toContain('locked_until =');
    expect(sql).not.toContain('leased_at =');
    expect(sql).not.toContain('verifier_close_finished');
    expect(sql).not.toMatch(/perform /i);
  });

  it('mirrors the servable rule and order of verifier_next_in_paper (include_skipped = false)', () => {
    expect(sql).toContain("aq.review_bucket = 'kid' and aq.question_passed = false and aq.kind = 'question'");
    expect(sql).toContain('public.checker_question_servable(aq)');
    expect(sql).toContain('(aq.locked_until is null or aq.locked_until < now() or aq.locked_by = v_uid)');
    expect(sql).toContain('and sk.at is null');
    expect(sql).toContain(
      'order by case when aq.locked_by = v_uid and aq.locked_until > now() and sk.at is null then 0 else 1 end,\n             sk.at nulls first, aq.ord, aq.id',
    );
    // the next function (as created in 20261011120000, patched later only in what it returns) carries the same filter lines
    expect(next).toContain('and public.checker_question_servable(aq)');
    expect(next).toContain('sk.at nulls first, aq.ord, aq.id');
  });

  it('caps p_count at 3 and returns no question text', () => {
    expect(sql).toContain('least(greatest(coalesce(p_count, 2), 1), 3)');
    expect(sql).toContain('limit v_n');
    expect(sql).not.toMatch(/aq\.(body|options|raw_ocr|instructions|flag_detail|marks)\b/);
    expect(sql).not.toContain('aq.source,');
  });

  it('closes to public, anon and authenticated by name, then grants authenticated only', () => {
    expect(sql).toContain('revoke all on function public.verifier_peek_next_in_paper(uuid, integer) from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.verifier_peek_next_in_paper(uuid, integer) to authenticated;');
    expect(sql).not.toMatch(/grant\s+execute[^;]*\bto\s+(anon|public)\b/i);
  });
});
