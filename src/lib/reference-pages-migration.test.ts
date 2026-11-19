import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* 20261103000000_reference_pages_before_serving.sql cannot run in CI (no database), so its load-bearing
   lines are pinned here. checker_reference_ok is new; checker_question_servable keeps every rule it had
   (the body left by 20261102110000, pdf_mismatch hold included) and gains exactly one more. Both stay plain
   create or replace: no drop, no grant, no revoke, no security definer. The logic was replayed as a read-only
   SELECT on 3 November 2026: 328 open questions lean on a parent or figure, 323 covered, 5 held (2 papers). */

const raw = readFileSync('supabase/migrations/20261103000000_reference_pages_before_serving.sql', 'utf8');
const sql = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

const servableStart = sql.indexOf('create or replace function public.checker_question_servable');
const servable = sql.slice(servableStart);
const refOk = sql.slice(sql.indexOf('create or replace function public.checker_reference_ok'), servableStart);

describe('checker_reference_ok', () => {
  it('is a new plain SQL function over audit_questions, stable, with a pinned search path', () => {
    expect(refOk).toContain('create or replace function public.checker_reference_ok(p_q audit_questions)');
    expect(refOk).toContain('returns boolean');
    expect(refOk).toMatch(/language sql\s+stable/);
    expect(refOk).not.toMatch(/security definer/i);
    expect(refOk).toContain("set search_path to 'public', 'pg_temp'");
  });

  it('knows what a question leans on: its own figure, and its parent figure, table, long text or passage', () => {
    for (const rule of [
      "'figure_missing' = any (coalesce(p_q.flag_reasons, '{}'::text[]))",
      "coalesce(p_q.figure::text, 'null') not in ('null', '{}', '[]', '\"\"')",
      "'figure_missing' = any (coalesce(par.flag_reasons, '{}'::text[]))",
      "coalesce(par.figure::text, 'null') not in ('null', '{}', '[]', '\"\"')",
      "coalesce(par.body, '') ~* '\\mtable\\M'",
      "position('|' in coalesce(par.body, '')) > 0",
      "length(coalesce(par.body, '')) > 300",
      "coalesce(par.source -> 'swarm' ->> 'kind', '') = 'passage'",
    ]) {
      expect(refOk, rule).toContain(rule);
    }
  });

  it('is satisfied by standing alone, a whole-question crop, or EVERY page it leans on being stored', () => {
    expect(refOk).toContain('select not (select needed from need)');
    expect(refOk).toContain("coalesce(p_q.source ->> 'whole_snippet_object', '') <> ''");
    expect(refOk).toContain("coalesce(par.source ->> 'whole_snippet_object', '') <> ''");
    expect(refOk).toContain('exists (select 1 from leaned where pg is not null)');
    expect(refOk).toContain('from public.audit_paper_pages a');
    // a page number is only cast after the digits check, as checker_has_picture does
    expect(refOk).toContain("case when (p_q.source ->> 'page') ~ '^[0-9]{1,3}$' then (p_q.source ->> 'page')::int end");
    expect(refOk).toContain("case when (par.source ->> 'page') ~ '^[0-9]{1,3}$' then (par.source ->> 'page')::int end");
  });
});

describe('checker_question_servable', () => {
  it('is replaced in place with the same signature and is not made security definer', () => {
    expect(servable).toContain('create or replace function public.checker_question_servable(p_q audit_questions)');
    expect(servable).toMatch(/language sql\s+stable/);
    expect(servable).not.toMatch(/security definer/i);
    expect(servable).toContain("set search_path to 'public', 'pg_temp'");
  });

  it('gains the reference rule, right after the picture rule', () => {
    expect(servable).toContain('and public.checker_has_picture(p_q)\n     and public.checker_reference_ok(p_q)');
  });

  it('keeps every rule it had, the pdf_mismatch hold included', () => {
    for (const rule of [
      "p_q.kind = 'question'",
      "p_q.review_bucket = 'kid'",
      'p_q.question_passed = false',
      'p_q.set_aside_at is null',
      'coalesce(public.checker_body_ok(p_q), false)',
      "'incomplete_text' = any (coalesce(p_q.flag_reasons, '{}'::text[]))",
      "coalesce(p_q.source ->> 'page_verified', '') = 'true'",
      'from public.audit_paper_pages pg',
      "coalesce(p_q.source ->> 'pipeline', '') <> 'english_w14'",
      "ap.source in ('live_copy', 'new_ocr')",
      "not ('pdf_mismatch' = any (coalesce(ap.flag_reasons, '{}'::text[])))",
    ]) {
      expect(servable, rule).toContain(rule);
    }
  });
});

describe('the whole file', () => {
  it('changes nothing else: no drop, no grant, no revoke, exactly two functions', () => {
    expect(sql).not.toMatch(/\bdrop\b/i);
    expect(sql).not.toMatch(/\b(grant|revoke)\b/i);
    expect((sql.match(/create or replace function/g) ?? []).length).toBe(2);
  });
});
