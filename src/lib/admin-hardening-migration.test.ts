import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Pins the shape of 20260930090000_admin_hardening.sql, the same way the
 * other migration tests do: no typecheck can see inside SQL, so these are
 * string assertions on what must never regress. The behaviour itself is
 * exercised by supabase/probes/20260930_admin_hardening_probe.sql.
 */
const MIGRATION = 'supabase/migrations/20260930090000_admin_hardening.sql';
const sql = readFileSync(MIGRATION, 'utf8')
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n');

describe('admin hardening migration', () => {
  it('has no CHECK constraint on audit_review_log.action', () => {
    expect(sql).not.toMatch(/alter table\s+public\.audit_review_log/i);
    expect(sql).not.toMatch(/add constraint/i);
  });

  it('keeps every touched function SECURITY DEFINER with a pinned search_path', () => {
    const creates = sql.match(/create (?:or replace )?function public\.admin_\w+/gi) ?? [];
    expect(creates.length).toBe(8);
    expect((sql.match(/security definer/gi) ?? []).length).toBe(8);
    expect((sql.match(/set search_path to 'public'/gi) ?? []).length).toBe(8);
  });

  it('revokes from public, anon and authenticated by name, then grants authenticated only', () => {
    const revokes = sql.match(/revoke all on function public\.admin_\w+\([^)]*\) from public, anon, authenticated;/gi) ?? [];
    expect(revokes.length).toBe(8);
    expect(sql).not.toMatch(/grant execute on function[^;]*\bto\s+(anon|public)\b/i);
  });

  it('locks the catalog away from every client role', () => {
    expect(sql).toMatch(/alter table public\.log_action_catalog enable row level security/i);
    for (const role of ['public', 'anon', 'authenticated']) {
      expect(sql).toMatch(new RegExp(`revoke all on table public\\.log_action_catalog from ${role};`, 'i'));
    }
  });

  it('closes direct writes and drops both ALL policies', () => {
    expect(sql).toMatch(/revoke insert, update, delete, truncate, references, trigger on public\.bank_papers from public, anon, authenticated/i);
    expect(sql).toMatch(/revoke insert, update, delete, truncate, references, trigger on public\.bank_questions from public, anon, authenticated/i);
    expect(sql).toMatch(/drop policy if exists "admins write papers"/i);
    expect(sql).toMatch(/drop policy if exists "admins write questions"/i);
    expect(sql).toMatch(/create policy "admins read all papers" on public\.bank_papers\s+for select/i);
  });

  it('validates with errcode 22023 and never trims or rewrites the body', () => {
    expect(sql).toMatch(/errcode = '22023'/);
    expect(sql).not.toMatch(/btrim\(\s*p_body|trim\(\s*p_body|lower\(\s*p_body|replace\(\s*p_body/i);
    expect(sql).toMatch(/values \(v_new_id, p_paper_id, p_after_ord \+ 1, p_body, p_marks/);
  });

  it('logs the admin for both rescue and reapply, using an action the revisions CHECK allows', () => {
    expect(sql).toMatch(/'admin_english_rescue_publish'/);
    expect(sql).toMatch(/'admin_reapply_paper_to_live'/);
    expect((sql.match(/null, auth\.uid\(\), p_audit_paper_id, null,/g) ?? []).length).toBe(2);
    // The summary revision rows use the existing 'live_apply', not a new name.
    expect((sql.match(/'bank_papers', v_paper\.live_bank_paper_id, 'live_apply'/g) ?? []).length).toBe(2);
  });

  it('adds no em or en dashes', () => {
    expect(readFileSync(MIGRATION, 'utf8')).not.toMatch(/[–—]/);
  });
});

describe('admin edits reach non-text columns', () => {
  it('casts every edited and undone value to the column type (42804 before)', () => {
    const casts = sql.match(/set %I = \$1::%s where id = \$2', (?:p_field|v_rev\.field), v_type\)/g) ?? [];
    expect(casts.length).toBe(4);
    expect(sql).not.toMatch(/set %I = \$1 where id = \$2'/);
  });

  it('parenthesises CASE inside IF conditions', () => {
    expect(sql).not.toMatch(/if p_value is not null and case/i);
  });
});
