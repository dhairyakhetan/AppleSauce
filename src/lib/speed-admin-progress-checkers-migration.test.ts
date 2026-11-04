import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* 20261012800000_speed_admin_progress_and_checkers.sql cannot run in CI (no
   database), so its load-bearing lines are pinned here: both Admin People-tab
   functions keep their gate and their grants, stay out of per-row correlated
   subqueries, and every index the rewrite leans on is a small partial or
   covering one created with IF NOT EXISTS.

   Rehearsed 12 October 2026 in a rolled-back repeatable-read transaction on live
   data: the new bodies returned the same rows as the previous ones for an admin
   (EXCEPT both ways empty, same order), admin_paper_progress 6.2 s -> 0.7 s and
   admin_checker_list 3.6 s -> 1.4 s on the first call, warm 0.8-1.2 s -> 0.02-0.13 s
   and 1.9-2.8 s -> 0.5-0.7 s. Then applied and checked with has_function_privilege. */

const raw = readFileSync('supabase/migrations/20261012800000_speed_admin_progress_and_checkers.sql', 'utf8');
const sql = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

function body(fn: string): string {
  const start = sql.indexOf(`create or replace function public.${fn}(`);
  expect(start, fn).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf('$function$;', sql.indexOf('as $function$', start)));
}

const FNS = ['admin_paper_progress', 'admin_checker_list'];

describe('speed up admin_paper_progress and admin_checker_list migration', () => {
  it('each function keeps the signature gate: security definer, pinned path, is_admin() with a 42501', () => {
    for (const fn of FNS) {
      const b = body(fn);
      expect(b, fn).toContain('security definer');
      expect(b, fn).toContain("set search_path to 'public', 'pg_temp'");
      expect(b, fn).toContain('if not public.is_admin() then');
      expect(b, fn).toContain("errcode = '42501'");
    }
  });

  it('keeps the return shape of both functions', () => {
    expect(body('admin_paper_progress')).toContain(
      'returns table(audit_paper_id uuid, live_bank_paper_id text, subject text, cls text, school text, open_doubts bigint, cleared bigint, total bigint, pct_done numeric, last_activity timestamp with time zone, workers text[])',
    );
    expect(body('admin_checker_list')).toContain(
      'returns table(actor_key text, name text, role text, first_at timestamp with time zone, last_at timestamp with time zone, total_actions integer)',
    );
  });

  it('closes both functions to public, anon and authenticated, then grants authenticated only', () => {
    for (const fn of FNS) {
      for (const who of ['public', 'anon', 'authenticated']) {
        expect(sql, `${fn} ${who}`).toContain(`revoke all on function public.${fn}() from ${who};`);
      }
      expect(sql, fn).toContain(`grant execute on function public.${fn}() to authenticated;`);
    }
    expect(sql).not.toMatch(/grant\s+execute[^;]*\bto\s+(anon|public)\b/i);
  });

  it('admin_paper_progress aggregates the log by paper and actor first, so names are looked up once per person', () => {
    const b = body('admin_paper_progress');
    expect(b).toContain('group by l.paper_id, l.actor_user_id');
    expect(b).toContain('select distinct b.actor_user_id from by_actor b');
    // the old shape joined profiles and auth.users once per log row
    expect(b).not.toMatch(/left join public\.profiles pr on pr\.id = l\.actor_user_id/);
    expect(b).toContain("btrim(coalesce(aq.body, '')) <> ''");
  });

  it('admin_checker_list reads the system log once through the index, and only the model-naming notes from the heap', () => {
    const b = body('admin_checker_list');
    expect(b).toContain("lower(coalesce(l.note, '')) like '%sonnet%'");
    expect(b).toContain("lower(coalesce(l.note, '')) like '%haiku%'");
    expect(b).toContain("case when ai.ns then 'sonnet' end, case when ai.nh then 'haiku' end, q.checked_by");
    // no per-row key construction: history_actor_key runs over grouped rows only
    expect(b).toContain('left join public.audit_questions q on q.id = ai.question_id');
    expect(b).not.toMatch(/group by l\.note/);
  });

  it('creates only small partial or covering indexes, all idempotent', () => {
    const creates = sql.match(/create index[^;]*;/gi) ?? [];
    expect(creates.length).toBe(7);
    for (const c of creates) {
      expect(c).toContain('if not exists');
      expect(c).not.toMatch(/\bunique\b/i);
      expect(c.includes(' where ') || c.includes(' include ') || c.includes('bank_question_revisions')).toBe(true);
    }
  });

  it('does not alter any table, drop anything, or touch other functions', () => {
    expect(sql).not.toMatch(/\balter\s+table\b/i);
    expect(sql).not.toMatch(/\bdrop\s/i);
    expect(sql).not.toMatch(/(create or replace|alter)\s+function public\.(?!admin_paper_progress|admin_checker_list)/i);
  });
});
