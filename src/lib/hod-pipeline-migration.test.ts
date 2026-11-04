import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* 20261012600000_hod_pipeline_page.sql cannot run in CI (no database), so its
   load-bearing lines are pinned here: four hod_* twins of the admin reads, each
   gated on is_hod(), closed to public, anon AND authenticated by name before
   being granted to authenticated, an email-shaped pdf_name hidden from anyone
   who is not an admin, and no copy of the activity feed.

   Rehearsed 12 October 2026 in a rolled-back transaction: anon and a plain
   student refused (42501) on all four, an HOD and an admin allowed, the admin_*
   functions still refused to an HOD, and for an admin every hod_* result equal
   to its admin_* twin. Then applied and checked with has_function_privilege. */

const raw = readFileSync('supabase/migrations/20261012600000_hod_pipeline_page.sql', 'utf8');
const sql = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

function body(fn: string): string {
  const start = sql.indexOf(`create or replace function public.${fn}(`);
  expect(start, fn).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf('$function$;', sql.indexOf('as $function$', start)));
}

const FNS = ['hod_pipeline_stats', 'hod_registry_summary', 'hod_registry', 'hod_nav_counts'];

describe('HOD pipeline page migration', () => {
  it('each function is security definer, pins the search path and checks is_hod() with a 42501', () => {
    for (const fn of FNS) {
      const b = body(fn);
      expect(b, fn).toContain('security definer');
      expect(b, fn).toContain('set search_path = public, pg_temp');
      expect(b, fn).toContain('if not public.is_hod() then');
      expect(b, fn).toContain("errcode = '42501'");
      expect(b, fn).not.toContain('is_admin() then\n    raise');
    }
  });

  it('closes every function to public, anon and authenticated, then grants authenticated only', () => {
    const sigs: Record<string, string> = {
      hod_pipeline_stats: '()',
      hod_registry_summary: '()',
      hod_registry: '(text, text, text, integer, integer)',
      hod_nav_counts: '()',
    };
    for (const fn of FNS) {
      expect(sql, fn).toContain(`revoke all on function public.${fn}${sigs[fn]} from public, anon, authenticated;`);
      expect(sql, fn).toContain(`grant execute on function public.${fn}${sigs[fn]} to authenticated;`);
    }
    expect(sql).not.toMatch(/grant\s+execute[^;]*\bto\s+(anon|public)\b/i);
  });

  it('does not touch the admin functions and does not copy the activity feed', () => {
    expect(sql).not.toMatch(/(create|alter|drop)[^;]*function public\.admin_/i);
    expect(sql).not.toContain('hod_activity_feed');
    expect(sql).not.toContain('actor_user_id');
  });

  it('hides any word holding an @ in pdf_name from non-admins and searches the hidden text', () => {
    const b = body('hod_registry');
    expect(b).toContain('v_admin := public.is_admin();');
    expect(b).toContain("regexp_replace(r.pdf_name, '\\S*@\\S*', '[hidden]', 'g')");
    expect(b).toContain('r.shown_name ilike v_pattern');
    expect(b).not.toContain('r.pdf_name ilike v_pattern');
  });

  it('keeps the registry page size bound and the LIKE escaping of the admin twin', () => {
    const b = body('hod_registry');
    expect(b).toContain('least(greatest(coalesce(p_limit, 100), 1), 200)');
    expect(b).toContain("'%' || replace(replace(replace(v_search, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%'");
  });
});
