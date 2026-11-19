import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import { checkerErrorAdvice } from '@/lib/checker-errors';
import { isDefiniteRefusal } from '@/lib/checker-outbox';

/* 20261106100000_hold_stops_answers_and_later_corrected.sql cannot run in CI (no database), so its
   load-bearing lines are pinned here. Two rulings by the owner on 6 November 2026:
     - "Yes, stop it": a paper put on hold takes no more answers, even for a question already open.
     - "Yes, count it": a skip that someone else later settled counts as "later corrected". */

const raw = readFileSync('supabase/migrations/20261106100000_hold_stops_answers_and_later_corrected.sql', 'utf8');
const sql = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

const authorize = sql.slice(sql.indexOf('create or replace function public.checker_authorize_question'), sql.indexOf('create or replace function public.hod_team'));

describe('checker_authorize_question: hold stops answers', () => {
  it('refuses a held paper with the plain sentence, errcode 42501', () => {
    expect(authorize).toContain("'pdf_mismatch' = any (coalesce(ap.flag_reasons, '{}'::text[]))");
    expect(authorize).toContain("raise exception 'This paper was put on hold' using errcode = '42501';");
  });

  it('puts the hold check in the verifier branch, after the lease check, so an HOD is not blocked', () => {
    const elseStart = authorize.indexOf('  else\n');
    const lease = authorize.indexOf("'This question is not currently assigned to you'");
    const hold = authorize.indexOf("'This paper was put on hold'");
    const source = authorize.indexOf("'This paper is not eligible for checking'");
    expect(elseStart).toBeGreaterThan(-1);
    expect(lease).toBeGreaterThan(elseStart);
    expect(hold).toBeGreaterThan(lease);
    expect(hold).toBeLessThan(source);
    // the escalated (HOD) branch comes before the else, so the check is not in it
    expect(authorize.indexOf("review_bucket = 'escalated'")).toBeLessThan(elseStart);
  });

  it('keeps every older refusal', () => {
    for (const s of [
      "'Not authorized'",
      "'Question not found'",
      "'This question was sent to the HOD'",
      "'This question is not routed to the paper checker'",
      "'This question is not currently assigned to you'",
      "'This paper is not eligible for checking'",
    ]) {
      expect(authorize, s).toContain(s);
    }
  });

  it('stays a definer function with a pinned search path, closed to public, anon and authenticated', () => {
    expect(authorize).toContain('security definer');
    expect(authorize).toContain('set search_path = public, pg_temp');
    expect(sql).toContain('revoke all on function public.checker_authorize_question(uuid) from public, anon, authenticated;');
    expect(sql).not.toMatch(/grant\s+execute[^;]*checker_authorize_question/i);
  });

  it('does NOT re-run the serving rules at answer time (a picture job must not refuse a person mid-answer)', () => {
    expect(authorize).not.toContain('checker_question_servable');
    expect(authorize).not.toContain('checker_has_picture');
    expect(authorize).not.toContain('checker_reference_ok');
  });
});

describe('hod_team: later corrected counts a skip someone else settled', () => {
  const start = sql.indexOf('later as (');
  const block = sql.slice(start, sql.indexOf('held as (', start));

  it('counts a skipped question once', () => {
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain('count(distinct s.question_id)');
    expect(block).toContain("s.action = 'checker_skip'");
  });

  it('looks at the counted log for ANY actor, not only the same verifier', () => {
    expect(block).toContain('from public.audit_review_log_counted d');
    expect(block).toContain('d.question_id = s.question_id');
    expect(block).toContain('d.at > s.at');
    expect(block).not.toContain('d.uid = s.uid');
  });

  it('counts the verdicts a verifier gives and the things an admin or HOD does to settle it', () => {
    for (const a of [
      'checker_pass', 'checker_fix', 'checker_printed_typo', 'checker_split', 'checker_ask_help',
      'admin_pass', 'admin_edit', 'set_aside', 'moved_to_students',
    ]) {
      expect(block, a).toContain(`'${a}'`);
    }
    // a second skip never settles a skip
    expect(block.slice(block.indexOf('d.action in'))).not.toContain("'checker_skip'");
  });

  it('keeps the same return type, gate, ordering and grants as before', () => {
    expect(sql).toMatch(/escalated integer, skipped integer,\s+skipped_done integer, overturned integer, last_active timestamptz/);
    expect(sql).toContain('if not public.is_hod() then');
    expect(sql).toContain('set search_path = public, pg_temp');
    expect(sql).toContain('order by p.active desc, 11 desc, 2;');
    expect(sql).toContain('revoke all on function public.hod_team() from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.hod_team() to authenticated;');
    expect(sql).not.toMatch(/grant\s+execute[^;]*\bto\s+(anon|public)\b/i);
    // create or replace, not drop: the return type did not change, so nothing else is disturbed
    expect(sql).toContain('create or replace function public.hod_team()');
    expect(sql).not.toMatch(/drop function/i);
  });
});

describe('what the screen says when a held paper refuses an answer', () => {
  const held = { code: '42501', message: 'This paper was put on hold' };

  it('says the paper was put on hold and that earlier answers are kept, not "sign in again"', () => {
    const a = checkerErrorAdvice(held);
    expect(a.message).toMatch(/put on hold/i);
    expect(a.message).toMatch(/earlier answers/i);
    expect(a.message).not.toMatch(/sign in/i);
    expect(a.message).not.toMatch(/[–—]/);
    expect(a.moveOn).toBe(true);
  });

  it('is a definite refusal, so the outbox stops retrying instead of spinning every 8 seconds', () => {
    expect(isDefiniteRefusal(held)).toBe(true);
  });

  it('leaves the neighbouring refusals as they were', () => {
    expect(checkerErrorAdvice({ code: '42501', message: 'This question is not currently assigned to you' }).message).toMatch(/open too long/i);
    expect(checkerErrorAdvice({ code: '42501', message: 'Not authorized' }).message).toMatch(/sign in again/i);
  });
});
