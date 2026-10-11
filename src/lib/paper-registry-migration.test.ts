import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* 20261005140000_paper_registry.sql cannot run in CI (no database), so its
   load-bearing lines are pinned here: the exact columns, the state check, RLS
   with no policy and every role revoked, both functions admin-only and closed
   to anon AND authenticated by name before being granted to authenticated,
   and no question text or answer key anywhere.

   Applied to the live project on 2026-10-05 as version 20261005141356 (the
   apply tool stamps its own version); rehearsed first in a rolled-back
   transaction. */

const raw = readFileSync('supabase/migrations/20261005140000_paper_registry.sql', 'utf8');
const sql = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

const COLUMNS = [
  'registry_key', 'pdf_name', 'board', 'class', 'subject', 'year', 'school', 'ocr_state',
  'processed_state', 'audit_paper_id', 'bank_paper_id', 'source', 'questions_total',
  'questions_passed', 'open_student', 'open_admin', 'approval_state', 'frozen', 'excluded', 'updated_at',
];

describe('paper registry migration', () => {
  it('creates the table with exactly the agreed columns, in order', () => {
    const body = sql.match(/create table if not exists public\.paper_registry \(([\s\S]*?)\n\);/)?.[1] ?? '';
    const names = [...body.matchAll(/^\s{2}([a-z_]+) (?:text|integer|uuid|boolean|timestamptz)/gm)].map((m) => m[1]);
    expect(names).toEqual(COLUMNS);
    expect(body).toContain('registry_key text primary key');
    expect(body).toContain('frozen boolean default false');
    expect(body).toContain('excluded boolean default false');
    expect(body).toContain('updated_at timestamptz default now()');
  });

  it('allows exactly the eight processed states', () => {
    const list = sql.match(/check \(processed_state in \(([\s\S]*?)\)\)/)?.[1] ?? '';
    const states = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(states).toEqual([
      'not_started', 'ocr_queued', 'ocr_done', 'loaded', 'ai_checked', 'fully_checked', 'awaiting_approval', 'live',
    ]);
  });

  it('turns RLS on with no policy and revokes the table from every role', () => {
    expect(sql).toContain('alter table public.paper_registry enable row level security;');
    expect(sql).toContain('revoke all on table public.paper_registry from public, anon, authenticated;');
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/grant\s+(select|insert|update|delete|all)[^;]*on\s+(table\s+)?public\.paper_registry/i);
  });

  it('keeps both functions admin-only, with a pinned search path', () => {
    for (const fn of ['admin_paper_registry_summary', 'admin_paper_registry']) {
      const start = sql.indexOf(`create or replace function public.${fn}(`);
      expect(start, fn).toBeGreaterThan(-1);
      const end = sql.indexOf('$function$;', sql.indexOf('as $function$', start));
      const body = sql.slice(start, end);
      expect(body, fn).toContain('security definer');
      expect(body, fn).toContain('set search_path = public, pg_temp');
      expect(body, fn).toContain('if not public.is_admin() then');
      expect(body, fn).toContain("errcode = '42501'");
    }
  });

  it('closes both functions to public, anon and authenticated, then grants authenticated only', () => {
    expect(sql).toContain('revoke all on function public.admin_paper_registry_summary() from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.admin_paper_registry_summary() to authenticated;');
    expect(sql).toContain(
      'revoke all on function public.admin_paper_registry(text, text, text, integer, integer) from public, anon, authenticated;',
    );
    expect(sql).toContain(
      'grant execute on function public.admin_paper_registry(text, text, text, integer, integer) to authenticated;',
    );
    expect(sql).not.toMatch(/grant\s+execute[^;]*\bto\s+(anon|public)\b/i);
  });

  it('bounds the page size and escapes LIKE wildcards in the search', () => {
    expect(sql).toContain('least(greatest(coalesce(p_limit, 100), 1), 200)');
    expect(sql).toContain("'%' || replace(replace(replace(v_search, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%'");
  });

  it('never touches question text or answer keys, and has no dashes in it', () => {
    expect(sql).not.toMatch(/answer_key|bank_questions|audit_questions|\bbody\b/i);
    expect(sql).not.toMatch(/[–—]/);
  });
});
