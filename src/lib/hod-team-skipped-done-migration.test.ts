import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import { TEAM_COLUMNS } from '@/lib/hod-api';

/* 20261102100000_hod_team_skipped_done.sql cannot run in CI (no database), so its load-bearing
   lines are pinned here: hod_team() keeps its is_hod() gate (42501), stays closed to public, anon
   AND authenticated before being granted to authenticated, gains the skipped_done column in the
   position the Verifiers tab reads it from, and counts a skipped question as "later corrected"
   only when the same verifier dealt with it afterwards, from the counted log (so an undone answer
   does not count). */

const raw = readFileSync('supabase/migrations/20261102100000_hod_team_skipped_done.sql', 'utf8');
const sql = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('hod_team', () => {
  it('is dropped and created again, because the return type changes', () => {
    expect(sql).toContain('drop function public.hod_team();');
    expect(sql).toContain('create function public.hod_team()');
  });

  it('is security definer with a pinned search path and an is_hod() check raising 42501', () => {
    expect(sql).toContain('security definer');
    expect(sql).toContain('set search_path = public, pg_temp');
    expect(sql).toContain('if not public.is_hod() then');
    expect(sql).toContain("errcode = '42501'");
  });

  it('returns skipped_done between skipped and overturned, as the screen reads them', () => {
    expect(sql).toMatch(/escalated integer, skipped integer,\s+skipped_done integer, overturned integer, last_active timestamptz/);
    const keys = TEAM_COLUMNS.map((c) => c.key as string);
    expect(keys.indexOf('skipped_done')).toBe(keys.indexOf('skipped') + 1);
    expect(keys.indexOf('overturned')).toBe(keys.indexOf('skipped_done') + 1);
  });

  it('selects the new count in the same position as the column list', () => {
    expect(sql).toMatch(
      /action = 'checker_skip'\),\s+coalesce\(l\.n, 0\),\s+coalesce\(o\.n, 0\),\s+\(select max\(a\.at\)/,
    );
    expect(sql).toContain('left join later l on l.uid = p.user_id');
  });

  it('counts a skipped question once, when the same verifier later did something other than skip it', () => {
    const start = sql.indexOf('later as (');
    expect(start).toBeGreaterThan(-1);
    const b = sql.slice(start, sql.indexOf('held as (', start));
    expect(b).toContain('count(distinct s.question_id)');
    expect(b).toContain("s.action = 'checker_skip'");
    expect(b).toContain('d.uid = s.uid and d.question_id = s.question_id');
    expect(b).toContain("d.action <> 'checker_skip' and d.at > s.at");
  });

  it('reads the counted log, so an answer a verifier undid does not count', () => {
    expect(sql).toContain('from public.audit_review_log_counted l');
    expect(sql).not.toMatch(/from public\.audit_review_log l/);
  });

  it('keeps the ordering: active first, then reviewed_all, then name', () => {
    expect(sql).toContain('order by p.active desc, 11 desc, 2;');
  });
});

describe('grants', () => {
  it('closes hod_team to public, anon and authenticated, then grants authenticated only', () => {
    expect(sql).toContain('revoke all on function public.hod_team() from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.hod_team() to authenticated;');
    expect(sql).not.toMatch(/grant\s+execute[^;]*\bto\s+(anon|public)\b/i);
  });
});
