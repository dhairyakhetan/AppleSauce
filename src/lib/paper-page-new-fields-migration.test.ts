import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* 20260929130000_paper_page_new_fields.sql cannot be run in CI (no
   database), so its load-bearing facts are pinned here:

   1. bank_paper_questions() -- reachable by anon and authenticated -- was
      returning answer_key (confirmed live, project uvtifolnsneitetzohtn,
      2026-09-29: has_function_privilege('anon', ..., 'EXECUTE') = true and
      pg_get_functiondef showed answer_key in both the RETURNS TABLE and the
      SELECT list). The owner's brief for this change is explicit: "NOT
      answer_key (answers are a future product decision; never expose)".
      This migration must remove it from both places.
   2. It must add parent_question_id (sub-parts), the one field the public
      paper page needed that the prior migration's RETURNS TABLE did not
      already carry.
   3. CLAUDE.md's grant trap: revoke from public, anon AND authenticated,
      then grant execute back to anon and authenticated (this function must
      stay reachable by a signed-out reader -- it IS the free-preview path). */

const raw = readFileSync('supabase/migrations/20260929130000_paper_page_new_fields.sql', 'utf8')
  .replace(/\r\n/g, '\n'); // a Windows checkout has CRLF
const sql = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('paper page new fields migration', () => {
  it('drops and recreates bank_paper_questions(text) in one statement pair', () => {
    expect(sql).toContain('drop function if exists public.bank_paper_questions(text);');
    expect(sql).toContain('create function public.bank_paper_questions(p_paper_id text)');
  });

  it('never returns or selects answer_key', () => {
    const body = sql.split('create function public.bank_paper_questions')[1] ?? '';
    expect(body.toLowerCase()).not.toContain('answer_key');
  });

  it('adds parent_question_id to the returns table and the select list', () => {
    const body = sql.split('create function public.bank_paper_questions')[1] ?? '';
    const returnsClause = body.split('as $function$')[0];
    expect(returnsClause).toContain('parent_question_id text');
    expect(body).toContain('q.parent_question_id');
  });

  it('keeps every field the public page already relied on', () => {
    const body = sql.split('create function public.bank_paper_questions')[1] ?? '';
    for (const col of [
      'id text', 'paper_id text', 'number text', 'body text', 'marks numeric',
      'chapter text', 'qtype text', 'page integer', 'figure text', 'options text[]',
      'display_number text', 'instructions text', 'suggested_time_minutes numeric',
      'chapter_from_paper boolean', 'alternative_group text', 'alternative_label text',
      'section_label text',
    ]) {
      expect(body, col).toContain(col);
    }
  });

  it('keeps the free-preview gate and the read_events write byte-for-byte', () => {
    expect(sql).toContain('limit case when v_uid is null then 2 else null end;');
    expect(sql).toContain("insert into public.read_events (user_id, kind, target_id, ip_hash)");
    expect(sql).toContain("values (v_uid, 'paper', p_paper_id,");
  });

  it('restates security definer and the fixed search_path (CREATE OR REPLACE does not inherit either)', () => {
    const body = sql.split('create function public.bank_paper_questions')[1] ?? '';
    expect(body).toContain('security definer');
    expect(body).toContain("set search_path to 'public', 'extensions'");
  });

  it('re-runs CLAUDE.md\'s revoke-from-all-three-then-grant pattern', () => {
    expect(sql).toContain('revoke all on function public.bank_paper_questions(text) from public;');
    expect(sql).toContain('revoke all on function public.bank_paper_questions(text) from anon;');
    expect(sql).toContain('revoke all on function public.bank_paper_questions(text) from authenticated;');
    expect(sql).toContain('grant execute on function public.bank_paper_questions(text) to anon, authenticated;');
  });

  it('wraps the whole change in one transaction', () => {
    expect(sql.trim().startsWith('begin;')).toBe(true);
    expect(sql.trim().endsWith('commit;')).toBe(true);
  });
});
