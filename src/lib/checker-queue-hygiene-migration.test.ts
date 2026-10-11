import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* 20260929013000_checker_queue_hygiene.sql cannot be run in CI (no
   database), so its load-bearing lines are pinned here: CLAUDE.md's grant
   trap, the blank-body rules, the Kolkata day, and that the proposed data
   changes stay commented out (data is run by hand, never by a migration). */

const raw = readFileSync('supabase/migrations/20260929013000_checker_queue_hygiene.sql', 'utf8');
const sql = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

const FUNCTIONS = [
  'checker_get_preferences()',
  'checker_set_preferences(text[], text[])',
  'checker_next_question()',
  'checker_pass_question(uuid)',
  'checker_fix_question(uuid, text, text, numeric)',
  'checker_split_question(uuid, text, int)',
  'checker_checked_today_count()',
  'checker_my_stats()',
  'checker_queue_facets()',
];

describe('checker queue hygiene migration', () => {
  it('revokes every function from public, anon AND authenticated by name, then grants authenticated only', () => {
    for (const f of FUNCTIONS) {
      expect(sql, f).toContain(`revoke all on function public.${f} from public, anon, authenticated;`);
      expect(sql, f).toContain(`grant execute on function public.${f} to authenticated;`);
      expect(sql, f).not.toContain(`grant execute on function public.${f} to anon`);
    }
  });

  it('keeps the preferences table closed to direct access', () => {
    expect(sql).toContain('alter table public.paper_checker_prefs enable row level security;');
    expect(sql).toContain('revoke all on public.paper_checker_prefs from public, anon, authenticated;');
    expect(sql).not.toMatch(/grant\s+(select|insert|update|all)[^;]*paper_checker_prefs/i);
  });

  it('every function is security definer with a fixed search_path and checks the caller', () => {
    const bodies = sql.split(/create (?:or replace )?function /).slice(1);
    expect(bodies.length).toBe(FUNCTIONS.length);
    for (const b of bodies) {
      expect(b).toContain('security definer');
      expect(b).toContain("set search_path to 'public'");
      expect(b).toMatch(/is_paper_checker\(\)|checker_authorize_question\(/);
    }
  });

  it('never serves or passes a blank body', () => {
    expect(sql).toContain("and btrim(coalesce(aq.body, '')) <> ''");
    expect(sql).toContain("if btrim(coalesce(v_before.body, '')) = '' then");
    expect(sql).toContain("if btrim(coalesce(p_body, v_before.body, '')) = '' then");
  });

  it('never rewrites question text beyond what the checker sent', () => {
    // Fix still keeps the stored body when p_body is null.
    expect(sql).toContain('set body = coalesce(p_body, body),');
    // Split still cuts exactly what the client saw.
    expect(sql).toContain('v_first := left(p_body_before, p_split_at);');
    expect(sql).toContain('v_second := substring(p_body_before from p_split_at + 1);');
  });

  it('counts "today" from midnight in Kolkata', () => {
    expect(sql.match(/now\(\) at time zone 'Asia\/Kolkata'/g)?.length).toBe(2);
  });

  it('writes no data outside the new prefs table (the re-routing SQL is comments only)', () => {
    expect(sql).not.toMatch(/update public\.audit_questions aq\s+set review_bucket/);
    expect(sql).not.toMatch(/set review_bucket = 'admin'/);
    expect(raw).toMatch(/--\s+update public\.audit_questions aq/);
  });
});
