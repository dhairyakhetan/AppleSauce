import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* 20261002090000_checker_versions_and_activity.sql cannot run in CI (no
   database; it was rehearsed against live inside a rolled-back transaction).
   Its load-bearing lines are pinned here: CLAUDE.md's grant trap, the version
   lock, answer_key never leaving the server, and no names or emails in the
   activity feed. */

// CRLF-safe: a Windows checkout with autocrlf would otherwise break the
// multi-line expectations below.
const raw = readFileSync('supabase/migrations/20261002090000_checker_versions_and_activity.sql', 'utf8').replace(
  /\r\n/g,
  '\n',
);
const sql = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

const FUNCTIONS = [
  'checker_next_question()',
  'checker_fix_locked(uuid, integer, text, text, numeric, boolean, text)',
  'checker_pass_locked(uuid, integer)',
  'admin_activity_feed(integer, timestamptz, text)',
  'admin_version_history(text, text)',
];

describe('checker versions and activity migration', () => {
  it('revokes every function from public, anon AND authenticated by name, then grants authenticated only', () => {
    for (const f of FUNCTIONS) {
      expect(sql, f).toContain(`revoke all on function public.${f} from public, anon, authenticated;`);
      expect(sql, f).toContain(`grant execute on function public.${f} to authenticated;`);
      expect(sql, f).not.toContain(`grant execute on function public.${f} to anon`);
    }
  });

  it('every function is security definer with a fixed search_path and checks the caller', () => {
    const bodies = sql.split(/create (?:or replace )?function /).slice(1);
    expect(bodies.length).toBe(FUNCTIONS.length);
    for (const b of bodies) {
      expect(b).toContain('security definer');
      expect(b).toContain("set search_path to 'public', 'pg_temp'");
      expect(b).toMatch(/is_paper_checker\(\)|checker_authorize_question\(|is_admin\(\)/);
    }
  });

  it('refuses a stale save with 40001 and writes content only through apply_fix_locked', () => {
    expect(sql.match(/using errcode = '40001'/g)?.length).toBe(2);
    expect(sql.match(/for update;/g)?.length).toBe(2);
    expect(sql).toContain("v_new := public.apply_fix_locked(\n      'audit_questions'");
    // The status update after the fix never touches content columns.
    expect(sql).not.toMatch(/set body\s*=/);
  });

  it('a printed typo fix must change the words and is logged as its own action and verdict', () => {
    expect(sql).toContain("raise exception 'A printed typo fix must change the words'");
    expect(sql).toContain("'checker_printed_typo'");
    expect(sql).toContain("'printed_typo'");
  });

  it('never returns answer_key or names, and masks emails in free text', () => {
    expect(sql).toContain("v.snapshot - 'answer_key'");
    expect(sql).not.toMatch(/full_name|auth\.users|raw_user_meta_data|\bemail\b\s*(,|from)/i);
    expect(sql.match(/v_email, '\[email\]', 'g'\)/g)?.length).toBe(3);
  });

  it('checker_next_question keeps the live filters and adds only the version', () => {
    expect(sql).toContain('drop function if exists public.checker_next_question();');
    expect(sql).toContain('source jsonb, subject text, school text, cls text, exam text, year text, version integer)');
    expect(sql).toContain("and btrim(coalesce(aq.body, '')) <> ''");
    expect(sql).toContain("case when c.p_year ~ '^\\d+$' then c.p_year::int else 0 end desc,");
    expect(sql).toContain('ap.subject, ap.school, ap.class, ap.exam_type, ap.year,\n           aq.version');
  });

  it('is one transaction with a lock timeout', () => {
    expect(sql.trim().startsWith('begin;')).toBe(true);
    expect(sql.trim().endsWith('commit;')).toBe(true);
    expect(sql).toContain("set local lock_timeout = '5s';");
  });
});
