import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* 20261011120000_verifier_returns_raw_ocr.sql cannot run in CI. Its
   load-bearing lines are pinned here: the grant trap, that every column the
   screen already reads is still returned in the same place, that the skip rule
   is untouched, and that each patch refuses to half-apply. */

const FILE = '20261011120000_verifier_returns_raw_ocr.sql';
const read = (f: string) =>
  readFileSync(`supabase/migrations/${f}`, 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

const raw = read(FILE);
const previous = read('20261008160000_verifier_skip_for_later.sql');

/** The "returns table(...)" column list of verifier_next_in_paper in a migration. */
function returnsOf(sql: string): string[] {
  const start = sql.indexOf('create or replace function public.verifier_next_in_paper');
  const open = sql.indexOf('returns table(', start);
  const close = sql.indexOf(')\nlanguage', open);
  return sql
    .slice(open + 'returns table('.length, close)
    .split(',')
    .map((c) => c.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
}

/** The select list the function hands back, as written, in a migration. */
function selectListOf(sql: string): string {
  const start = sql.indexOf('create or replace function public.verifier_next_in_paper');
  const from = sql.indexOf('return query', start);
  const end = sql.indexOf('from public.audit_questions aq', from);
  return sql.slice(from, end).replace(/\s+/g, ' ').trim();
}

describe('verifier raw_ocr migration: the new column', () => {
  it('adds audit_questions.raw_ocr only if it is not already there', () => {
    expect(raw).toContain('alter table public.audit_questions add column if not exists raw_ocr text;');
  });

  it('returns raw_ocr last and keeps every old column in its place', () => {
    const before = returnsOf(previous);
    const after = returnsOf(raw);
    expect(before.length).toBe(21);
    expect(after).toEqual([...before, 'raw_ocr text']);
  });

  it('selects raw_ocr last, after the existing select list unchanged', () => {
    const before = selectListOf(previous);
    const after = selectListOf(raw);
    expect(after).toBe(`${before}, aq.raw_ocr`);
  });

  it('drops the old signature first, because a function cannot gain an output column in place', () => {
    const dropAt = raw.indexOf('drop function if exists public.verifier_next_in_paper(uuid, boolean);');
    const createAt = raw.indexOf('create or replace function public.verifier_next_in_paper(p_paper_id uuid, p_include_skipped boolean default false)');
    expect(dropAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(dropAt);
  });
});

describe('verifier raw_ocr migration: nothing else about the function changed', () => {
  const functionBody = (sql: string) => {
    const start = sql.indexOf('create or replace function public.verifier_next_in_paper');
    const end = sql.indexOf('$$;', sql.indexOf('as $$', start));
    return sql.slice(sql.indexOf('as $$', start), end);
  };

  it('keeps SECURITY DEFINER and the pinned search_path', () => {
    const head = raw.slice(raw.indexOf('create or replace function public.verifier_next_in_paper'), raw.indexOf('as $$'));
    expect(head).toContain('language plpgsql security definer');
    expect(head).toContain("set search_path to 'public', 'pg_temp'");
  });

  it('has the same body as 20261008160000 apart from the one added column', () => {
    const before = functionBody(previous).replace(/\s+/g, ' ');
    const after = functionBody(raw).replace(/\s+/g, ' ');
    expect(after).toBe(
      before.replace(
        "nullif(aq.source ->> 'whole_snippet_object', '')) from public.audit_questions aq join",
        "nullif(aq.source ->> 'whole_snippet_object', '')), aq.raw_ocr from public.audit_questions aq join",
      ),
    );
    expect(after).not.toBe(before);
  });

  it('keeps the checks first: a paper checker, holding this paper', () => {
    const body = functionBody(raw);
    expect(body.indexOf('is_paper_checker()')).toBeGreaterThan(0);
    expect(body.indexOf('is_paper_checker()')).toBeLessThan(body.indexOf('from public.checker_assignments a'));
    expect(body).toContain("raise exception 'This paper is not assigned to you' using errcode = '42501'");
  });

  it('keeps the skip rule and the ten minute lease', () => {
    const body = functionBody(raw);
    expect(body).toContain('coalesce(p_include_skipped, false) or sk.at is null');
    expect(body).toContain("interval '10 minutes'");
  });
});

describe('verifier raw_ocr migration: access', () => {
  it('revokes the function from public, anon and authenticated, then grants authenticated only', () => {
    expect(raw).toContain("'public.verifier_next_in_paper(uuid, boolean)'");
    expect(raw).toContain("execute format('revoke all on function %s from public, anon, authenticated', f);");
    expect(raw).toContain("execute format('grant execute on function %s to authenticated', f);");
    expect(raw).not.toMatch(/grant execute[^;]*to anon/i);
    expect(raw).not.toMatch(/grant execute[^;]*to public/i);
  });

  it('opens no table to a browser role', () => {
    expect(raw).not.toMatch(/\bgrant\s+(select|all|insert|update)\b/i);
    expect(raw).not.toMatch(/create policy/i);
  });

  it('leaves the paper list function alone', () => {
    expect(raw).not.toContain('verifier_paper_questions');
  });
});

describe('verifier raw_ocr migration: the undo hands the row back', () => {
  it('patches verifier_undo_last in place and refuses to half-apply', () => {
    expect(raw).toContain("pg_get_functiondef('public.verifier_undo_last(uuid)'::regprocedure)");
    expect(raw).toContain("raise exception 'patch did not apply: verifier_undo_last (flag_detail line not found)'");
    expect(raw).toContain('if patched = src then');
    expect(raw).toContain('execute patched;');
  });

  it('adds raw_ocr to the same json object as the other question fields', () => {
    expect(raw).toContain("'''flag_detail'', aq.flag_detail, ''source'', aq.source,'");
    expect(raw).toContain("'''flag_detail'', aq.flag_detail, ''raw_ocr'', aq.raw_ocr, ''source'', aq.source,'");
    const undo = readFileSync('supabase/migrations/20261008140000_verifier_undo_last.sql', 'utf8');
    expect(undo).toContain("'flag_detail', aq.flag_detail, 'source', aq.source,");
  });

  it('is safe to run twice', () => {
    expect(raw).toContain('already patched');
    expect(raw).toContain('drop function if exists');
    expect(raw).toContain('add column if not exists');
  });
});

describe('verifier raw_ocr migration: it checks its own work', () => {
  it('verifies the new column, the skip rule, the undo patch and the table column', () => {
    const verify = raw;
    expect(verify).toContain("raise exception 'patch did not apply: verifier_next_in_paper';");
    expect(verify).toContain("raise exception 'patch did not apply: verifier_next_in_paper lost the skip rule';");
    expect(verify).toContain("raise exception 'patch did not apply: verifier_undo_last';");
    expect(verify).toContain("raise exception 'audit_questions.raw_ocr is missing';");
  });
});
