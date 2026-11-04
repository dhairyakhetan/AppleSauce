import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* 20261012600100_ai_trust_counts_students_and_hods.sql cannot run in CI. The owner rule (12 October 2026, final) is
   pinned here: the 100-check AI trust counter counts verdicts by students OR HODs, never admin fixes and never the
   AI's own kinds, on swarm and AI questions together. The per-level meter reads the same actors. */

const read = (f: string) =>
  readFileSync(`supabase/migrations/${f}`, 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

const sql = read('20261012600100_ai_trust_counts_students_and_hods.sql');
const overall = sql.slice(
  sql.indexOf('create or replace function public.ai_trust_overall()'),
  sql.indexOf('create or replace function public.ai_trust_outcomes()'),
);
const outcomes = sql.slice(sql.indexOf('create or replace function public.ai_trust_outcomes()'));

describe('ai trust counts: actors', () => {
  it('overall counts student and hod verdicts only, from the undo-aware view', () => {
    expect(overall).toContain("k.checker_kind in ('student', 'hod')");
    expect(overall).toContain('public.content_checks_counted');
    expect(overall).not.toContain("'admin'");
    expect(overall).not.toMatch(/checker_kind\s*=\s*'student'/);
  });

  it('the per-level meter drops admin fixes and keeps student and hod', () => {
    expect(outcomes).toContain("k.checker_kind in ('student', 'hod')");
    expect(outcomes).not.toContain("'student', 'hod', 'admin'");
    expect(outcomes).toContain('public.content_checks_counted');
    expect(outcomes).toContain('public.audit_review_log_counted');
  });

  it('splits count only when a person who is not an admin made them', () => {
    for (const body of [overall, outcomes]) {
      expect(body).toContain("l.action = 'checker_split'");
      expect(body).toContain('l.actor_user_id is not null');
      expect(body).toContain('not exists (select 1 from public.admins a where a.id = l.actor_user_id)');
    }
  });

  it('counts swarm and AI questions together (no source filter) and keeps the 100 threshold function untouched', () => {
    expect(overall).not.toMatch(/source/);
    expect(sql).not.toContain('ai_trust_overall_threshold() returns');
    expect(overall).toContain('public.ai_trust_overall_threshold()');
  });
});

describe('ai trust counts: security shape and fail-closed gate', () => {
  it('stays security definer with the pinned search_path and the inside role check', () => {
    expect(overall).toContain('security definer');
    expect(outcomes).toContain('security definer');
    expect(overall).toContain("set search_path to 'public', 'pg_temp'");
    expect(outcomes).toContain("set search_path to 'public', 'pg_temp'");
    expect(overall).toContain("if not (public.is_hod() or auth.role() = 'service_role') then");
    expect(overall).toContain("errcode = '42501'");
  });

  it('closes both functions to public, anon and authenticated, then grants exactly as before', () => {
    expect(sql).toContain('revoke all on function public.ai_trust_overall() from public, anon, authenticated;');
    expect(sql).toContain('revoke all on function public.ai_trust_outcomes() from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.ai_trust_overall() to authenticated, service_role;');
    expect(sql).toContain('grant execute on function public.ai_trust_outcomes() to service_role;');
    expect(sql).not.toMatch(/grant execute[^;]*to anon/i);
    expect(sql).not.toMatch(/grant execute[^;]*to public/i);
  });

  it('does not touch the gate, the meter, the trust switch or the bar, and writes no rows', () => {
    expect(sql).not.toContain('ai_auto_approve_allowed');
    expect(sql).not.toContain('ai_trust_meter');
    expect(sql).not.toContain('admin_set_ai_trust');
    expect(sql).not.toContain('ai_trust_bar');
    expect(sql).not.toMatch(/\b(insert into|update|delete from)\b/i);
  });

  it('uses no em or en dashes', () => {
    const raw = readFileSync('supabase/migrations/20261012600100_ai_trust_counts_students_and_hods.sql', 'utf8');
    expect(raw).not.toMatch(/[–—]/);
  });
});
