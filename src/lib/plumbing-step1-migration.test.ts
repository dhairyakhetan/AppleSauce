import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* 20260929100000_plumbing_step1.sql cannot be run in CI (no database), so
   its load-bearing lines are pinned here: CLAUDE.md's grant trap on every
   replaced/new function, that English is never served to the kid checker,
   that a checker's recent paper-skip is deprioritised (not the skipped
   question itself), that the English rescue split-half trigger re-checks
   its parent's tag before publishing, and that the proposed data move at
   the end stays commented out. */

const raw = readFileSync('supabase/migrations/20260929100000_plumbing_step1.sql', 'utf8').replace(/\r\n/g, '\n'); // a Windows checkout has CRLF
const sql = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

const AUTHENTICATED_ONLY_FUNCTIONS = [
  'admin_paper_queue()',
  'checker_next_question()',
  'admin_add_checker(text)',
  'admin_remove_checker(uuid)',
  'admin_list_checker_accounts()',
];

describe('plumbing step 1 migration', () => {
  it('revokes every replaced/new caller-facing function from public, anon AND authenticated, then grants authenticated only', () => {
    for (const f of AUTHENTICATED_ONLY_FUNCTIONS) {
      expect(sql, f).toContain(`revoke all on function public.${f} from public, anon, authenticated;`);
      expect(sql, f).toContain(`grant execute on function public.${f} to authenticated;`);
      expect(sql, f).not.toContain(`grant execute on function public.${f} to anon`);
    }
  });

  it('revokes the trigger dispatcher from every role and grants nothing (trigger-invoked only)', () => {
    expect(sql).toContain(
      'revoke all on function public.trg_english_rescue_publish() from public, anon, authenticated;',
    );
    expect(sql).not.toMatch(/grant execute on function public\.trg_english_rescue_publish\(\)/);
  });

  it('every replaced/new function is security definer with a fixed search_path and an auth gate', () => {
    const bodies = sql.split(/create (?:or replace )?function /).slice(1);
    // admin_paper_queue, checker_next_question, trg_english_rescue_publish,
    // admin_add_checker, admin_remove_checker, admin_list_checker_accounts.
    expect(bodies.length).toBe(6);
    for (const b of bodies) {
      expect(b).toContain('security definer');
      expect(b).toContain("set search_path to 'public'");
    }
    // The two admin-gated and two checker-gated functions each check the
    // caller; the trigger dispatcher is SECURITY DEFINER but has no
    // caller to gate (it never runs on anyone's direct request).
    const gated = bodies.filter((b) => !b.startsWith('public.trg_english_rescue_publish'));
    for (const b of gated) {
      expect(b).toMatch(/is_admin\(\)|is_paper_checker\(\)/);
    }
  });

  it('does not drop or recreate the existing admin_list_checkers(): paper-review.tsx and checker-api.ts still depend on its shape', () => {
    expect(sql).not.toContain('drop function if exists public.admin_list_checkers()');
    expect(sql).not.toContain('drop function public.admin_list_checkers()');
    expect(sql).not.toMatch(/create (?:or replace )?function public\.admin_list_checkers\(\)/);
  });

  it('adds the new checker-listing RPC under its own name, admin_list_checker_accounts(), with the full grant pattern', () => {
    expect(sql).toContain('create or replace function public.admin_list_checker_accounts()');
    expect(sql).toContain(
      'revoke all on function public.admin_list_checker_accounts() from public, anon, authenticated;',
    );
    expect(sql).toContain('grant execute on function public.admin_list_checker_accounts() to authenticated;');
  });

  it('admin_add_checker looks up by email and refuses a missing account', () => {
    expect(sql).toContain('create or replace function public.admin_add_checker(p_email text)');
    expect(sql).toContain('returns uuid');
    expect(sql).toContain('where lower(email) = lower(p_email)');
    expect(sql).toMatch(/raise exception 'No account with the email %; they must sign up first'/);
  });

  it('checker_next_question never serves an English row', () => {
    expect(sql).toContain(
      "coalesce(ap.subject, '') ilike 'English%'\n                 or coalesce(aq.source ->> 'pipeline', '') = 'english_w14'",
    );
  });

  it('checker_next_question deprioritises a paper this checker skipped in the last 30 minutes, without touching the skipped question', () => {
    expect(sql).toContain("s2.skipped_at > now() - interval '30 minutes'");
    expect(sql).toContain('skipped_papers');
    // The 24h "don't re-serve what I skipped" exclusion (unchanged from the
    // hygiene migration) still targets the QUESTION id, not the paper.
    expect(sql).toContain("s.skipped_at > now() - interval '24 hours'");
  });

  it('checker_next_question re-checks eligibility in the claiming UPDATE, not just lock state', () => {
    expect(sql).toContain(
      "where public.audit_questions.id = v_id\n      and (locked_until is null or locked_until < now() or locked_by = v_uid)\n      and review_bucket = 'kid' and not question_passed\n      and btrim(coalesce(body, '')) <> ''",
    );
  });

  it('checker_next_question keeps every existing ordering key', () => {
    expect(sql).toContain('c.locked_by = v_uid and c.locked_until > now()');
    expect(sql).toContain("c.source ->> 'rescue_decision' = 'ai_doubt'");
    expect(sql).toContain("c.p_source = 'live_copy'");
    expect(sql).toContain('coalesce(poc.open_count, 0)');
    expect(sql).toContain("c.p_year ~ '^\\d+$'");
  });

  it('the English rescue split-half trigger dispatcher re-checks the parent tag itself', () => {
    expect(sql).toContain('select * into v_parent from public.audit_questions where id = new.split_from_id;');
    expect(sql).toContain("coalesce(v_parent.source ->> 'pipeline', '') = 'english_w14'");
    expect(sql).toContain("coalesce(v_parent.source ->> 'role', '') = 'rescue'");
  });

  it('creates the five supporting indexes', () => {
    for (const idx of [
      'idx_audit_questions_open_by_paper',
      'idx_audit_questions_kid_ready',
      'idx_audit_questions_escalated_open',
      'idx_audit_papers_live_copy_created',
      'idx_audit_question_skips_user_recent',
    ]) {
      expect(sql).toContain(`create index if not exists ${idx}`);
    }
  });

  it('the proposed English data move at the end is commented out, not executed', () => {
    const commentBlockStart = raw.indexOf('-- English kid-queue rows');
    expect(commentBlockStart).toBeGreaterThan(-1);
    const tail = raw.slice(commentBlockStart);
    const codeLines = tail
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .filter((line) => !line.trim().startsWith('--'));
    expect(codeLines).toEqual([]);
  });

  it('never alters bank_papers, bank_questions or teacher tables', () => {
    expect(sql).not.toMatch(/update\s+public\.bank_papers/i);
    expect(sql).not.toMatch(/update\s+public\.bank_questions/i);
    expect(sql).not.toMatch(/alter table\s+public\.(bank_papers|bank_questions)/i);
    expect(sql).not.toMatch(/teacher_applications|teacher_comments|teacher_recommendations/i);
  });
});
