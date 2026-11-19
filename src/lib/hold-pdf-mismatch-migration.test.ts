import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* 20261102110000_hold_pdf_mismatch_papers.sql cannot run in CI (no database), so its load-bearing
   lines are pinned here: checker_question_servable keeps every rule it had (the live body as read
   on 2 November 2026) and gains exactly one more, that the paper is not flagged pdf_mismatch. The
   function stays a plain create or replace, so its signature and grants are untouched. */

const raw = readFileSync('supabase/migrations/20261102110000_hold_pdf_mismatch_papers.sql', 'utf8');
const sql = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('checker_question_servable', () => {
  it('is replaced in place, with the same signature, and is not made security definer', () => {
    expect(sql).toContain('create or replace function public.checker_question_servable(p_q audit_questions)');
    expect(sql).toContain('returns boolean');
    expect(sql).toMatch(/language sql\s+stable/);
    expect(sql).not.toMatch(/security definer/i);
    expect(sql).toContain("set search_path to 'public', 'pg_temp'");
  });

  it('holds a paper flagged pdf_mismatch, inside the paper lookup', () => {
    const start = sql.indexOf('select 1 from public.audit_papers ap');
    expect(start).toBeGreaterThan(-1);
    const b = sql.slice(start, sql.indexOf(');', start));
    expect(b).toContain("ap.source in ('live_copy', 'new_ocr')");
    expect(b).toContain("not ('pdf_mismatch' = any (coalesce(ap.flag_reasons, '{}'::text[])))");
  });

  it('keeps every rule the function already had', () => {
    for (const rule of [
      "p_q.kind = 'question'",
      "p_q.review_bucket = 'kid'",
      'p_q.question_passed = false',
      'p_q.set_aside_at is null',
      'coalesce(public.checker_body_ok(p_q), false)',
      "'incomplete_text' = any (coalesce(p_q.flag_reasons, '{}'::text[]))",
      "coalesce(p_q.source ->> 'page_verified', '') = 'true'",
      'from public.audit_paper_pages pg',
      'public.checker_has_picture(p_q)',
      "coalesce(p_q.source ->> 'pipeline', '') <> 'english_w14'",
    ]) {
      expect(sql, rule).toContain(rule);
    }
  });

  it('changes nothing else: no drop, no grant, no revoke, no other function', () => {
    expect(sql).not.toMatch(/\bdrop\b/i);
    expect(sql).not.toMatch(/\b(grant|revoke)\b/i);
    expect((sql.match(/create or replace function/g) ?? []).length).toBe(1);
  });
});
