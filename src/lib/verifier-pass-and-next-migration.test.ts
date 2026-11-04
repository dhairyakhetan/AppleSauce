import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* 20261012970000_verifier_pass_and_next.sql cannot run in CI (no database), so its
   load-bearing lines are pinned here: one transaction that calls the EXISTING
   verdict function (no rule copied), then claims the next question through
   verifier_next_in_paper, with the same 42501 gate, and closed to public, anon
   AND authenticated before being granted to authenticated.

   Rehearsed 12 October 2026 in one rolled-back transaction with a synthetic
   non-admin verifier holding a real paper: anon and a plain student refused
   (42501) on both functions; a pass then next in one call returned exactly the
   question and the 16 context rows the two-call path returned, with exactly one
   new review-log row; skip, ask_help and fix each logged one row and served a
   different next question; a stale version (40001), a wrong paper (22023), an
   unknown action (22023) and an expired lease (42501) each left locked_by,
   locked_until, leased_at, version and question_passed of every row of the paper
   unchanged and logged nothing; the last question of a paper returned next null.
   Then applied and checked with has_function_privilege (anon false,
   authenticated true, public false). */

const raw = readFileSync('supabase/migrations/20261012970000_verifier_pass_and_next.sql', 'utf8');
const sql = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('verifier_verdict_and_next / verifier_pass_and_next migration', () => {
  it('are security definer functions with a pinned search path, returning jsonb', () => {
    expect(sql).toContain('create or replace function public.verifier_verdict_and_next(');
    expect(sql).toContain('create or replace function public.verifier_pass_and_next(');
    expect(sql.match(/security definer/g)?.length).toBe(2);
    expect(sql.match(/set search_path = public, pg_temp/g)?.length).toBe(2);
    expect(sql.match(/returns jsonb/g)?.length).toBe(2);
  });

  it('refuses non-checkers with 42501 before doing anything', () => {
    expect(sql.match(/if not public\.is_paper_checker\(\) then\s+raise exception 'Not authorized' using errcode = '42501';/g)?.length).toBe(2);
  });

  it('delegates every verdict to the existing function and copies none of their rules', () => {
    expect(sql).toContain('public.checker_pass_locked(p_question_id, p_expected_version)');
    expect(sql).toContain('public.checker_fix_locked(p_question_id, p_expected_version, p_body, p_display_number, p_marks,');
    expect(sql).toContain('perform public.checker_skip_question(p_question_id);');
    expect(sql).toContain('perform public.checker_ask_for_help(p_question_id, p_reason);');
    // no verdict rule of its own: it never writes the question or the review log itself
    expect(sql).not.toMatch(/\b(update|insert|delete)\b/i);
    expect(sql).not.toContain('audit_review_log');
    expect(sql).not.toContain('question_passed');
  });

  it('claims the next question the way verifier_next_in_paper does, and reads its context', () => {
    expect(sql).toContain('public.verifier_next_in_paper(v_paper, coalesce(p_include_skipped, false))');
    expect(sql).toContain('public.checker_question_context(v_next.id)');
    // the verdict runs before the next question is looked at, so a refused verdict claims nothing
    expect(sql.indexOf('checker_pass_locked')).toBeLessThan(sql.indexOf('verifier_next_in_paper(v_paper'));
    expect(sql).toContain("raise exception 'Unknown verdict: %'");
  });

  it('returns verdict_ok, next and next_paper_id', () => {
    expect(sql).toContain("'verdict_ok', true");
    expect(sql).toContain("'next', v_nextj");
    expect(sql).toContain("'next_paper_id'");
  });

  it('closes both to public, anon and authenticated by name, then grants authenticated only', () => {
    expect(sql).toContain(
      'revoke all on function public.verifier_verdict_and_next(text, uuid, uuid, integer, text, text, numeric, boolean, text, text, boolean) from public, anon, authenticated;',
    );
    expect(sql).toContain(
      'grant execute on function public.verifier_verdict_and_next(text, uuid, uuid, integer, text, text, numeric, boolean, text, text, boolean) to authenticated;',
    );
    expect(sql).toContain('revoke all on function public.verifier_pass_and_next(uuid, integer, uuid, boolean) from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.verifier_pass_and_next(uuid, integer, uuid, boolean) to authenticated;');
    expect(sql).not.toMatch(/grant\s+execute[^;]*\bto\s+(anon|public)\b/i);
  });

  it('uses no em or en dash', () => {
    expect(raw).not.toMatch(/[–—]/);
  });
});
