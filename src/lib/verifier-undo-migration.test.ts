import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/* 20261008140000_verifier_undo_last.sql (the rewind button),
   20261008150000_verifier_or_alternatives.sql (OR between two questions) and
   20261008160000_verifier_skip_for_later.sql cannot run in CI. Their
   load-bearing lines are pinned here: the grant trap, the refusals, the 30
   minute window, the counters that must leave out undone rows, and every
   patch refusing to half-apply. */

const read = (f: string) =>
  readFileSync(`supabase/migrations/${f}`, 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

const undo = read('20261008140000_verifier_undo_last.sql');
const or = read('20261008150000_verifier_or_alternatives.sql');
const skip = read('20261008160000_verifier_skip_for_later.sql');

describe('verifier undo migration: access', () => {
  it('revokes the new function from public, anon and authenticated, then grants authenticated only', () => {
    expect(undo).toContain("'public.verifier_undo_last(uuid)'");
    expect(undo).toContain("execute format('revoke all on function %s from public, anon, authenticated', f);");
    expect(undo).toContain("execute format('grant execute on function %s to authenticated', f);");
    expect(undo).not.toMatch(/grant execute[^;]*to anon/i);
    expect(undo).not.toMatch(/grant execute[^;]*to public/i);
  });

  it('keeps the AI helper for the pipeline only and leaves the counted views closed to browser roles', () => {
    expect(undo).toContain('revoke all on function public.ai_trust_outcomes() from public, anon, authenticated');
    expect(undo).toContain('grant execute on function public.ai_trust_outcomes() to service_role');
    expect(undo).toContain('revoke all on public.audit_review_log_counted from public, anon, authenticated;');
    expect(undo).toContain('revoke all on public.content_checks_counted from public, anon, authenticated;');
    expect(undo).toContain('security_invoker = true');
  });

  it('checks the caller is a paper checker first', () => {
    const body = undo.slice(undo.indexOf('create or replace function public.verifier_undo_last'));
    expect(body.indexOf('is_paper_checker()')).toBeGreaterThan(0);
    expect(body.indexOf('is_paper_checker()')).toBeLessThan(body.indexOf('from public.checker_assignments a'));
  });
});

describe('verifier undo migration: what it refuses', () => {
  const body = undo.slice(undo.indexOf('create or replace function public.verifier_undo_last'));

  it('works only inside 30 minutes of the action', () => {
    expect(body).toContain("v_log.at < now() - interval '30 minutes'");
    expect(body).toContain('more than 30 minutes ago');
  });

  it('refuses with errcode 22023 and a sentence a verifier can read', () => {
    expect((body.match(/using errcode = '22023'/g) ?? []).length).toBeGreaterThanOrEqual(12);
    expect(body).toContain('Someone else has worked on that question since');
    expect(body).toContain('The HOD has already dealt with that question');
    expect(body).toContain('You no longer hold this paper');
    expect(body).toContain('has already gone for approval');
    expect(body).toContain('Splitting a question cannot be undone here');
  });

  it('refuses when anyone else acted on the question since, or an AI check was run on it', () => {
    expect(body).toContain('l2.question_id = v_q.id and l2.id > v_log.id');
    expect(body).toContain('k.created_at > v_log.at');
    expect(body).toContain('k.actor_user_id is distinct from v_uid');
  });

  it('refuses a paper that went for approval or was published', () => {
    expect(body).toContain("approval_state in ('awaiting', 'approved')");
    // paper_passed alone turns true on the very last answer, which is the one
    // most often undone; only a live_copy paper (pushed to the library at once)
    // refuses on it.
    expect(body).toMatch(/coalesce\(v_paper\.paper_passed, false\) and v_paper\.source = 'live_copy'/);
    expect(body).not.toMatch(/if coalesce\(v_paper\.paper_passed, false\)\s+or/);
  });

  it('locks the assignment, the log row and the question, and one undo at a time per person', () => {
    expect(body).toContain('pg_advisory_xact_lock(hashtext(\'verifier_undo_last\'), hashtext(v_uid::text))');
    expect((body.match(/for update;/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('lets a finished paper be reopened for the last answer', () => {
    expect(body).toContain("a.status in ('queued', 'assigned', 'done')");
    expect(body).toContain("set status = 'assigned', closed_at = null, closed_reason = null");
  });
});

describe('verifier undo migration: what each undo does', () => {
  const body = undo.slice(undo.indexOf('create or replace function public.verifier_undo_last'));

  it('a fix puts back the stored previous words, never rebuilt text', () => {
    expect(body).toContain('from public.content_versions cv');
    expect(body).toContain("(v_snap ->> 'body') is distinct from (v_before ->> 'body')");
    expect(body).toContain("set_config('shikshaq.op', 'revert', true)");
    expect(body).toContain('set body = v_body, display_number = v_num, marks = v_marks');
  });

  it('a pass or fix goes back to to-verify and leases the question to the caller', () => {
    expect(body).toContain('question_passed = false');
    expect(body).toContain('locked_by = v_uid');
  });

  it('asking the HOD is withdrawn only while the question is still escalated and untouched', () => {
    expect(body).toContain("v_q.review_bucket <> 'escalated'");
    expect(body).toContain('set review_bucket = v_bucket');
  });

  it('a skip removes the skip mark', () => {
    expect(body).toContain('delete from public.audit_question_skips');
  });

  it('keeps the original log row and writes a verifier_undo row', () => {
    expect(body).toContain('update public.audit_review_log set undone_at = now(), undone_by = v_uid where id = v_log.id;');
    expect(body).toContain("'verifier_undo'");
    expect(body).not.toMatch(/delete from public\.audit_review_log/);
    expect(body).toContain('update public.content_checks');
  });

  it('records the previous state in new pass and fix log rows, and refuses to half-apply', () => {
    expect(undo).toContain("raise exception 'patch did not apply: checker_pass_locked'");
    expect(undo).toContain("raise exception 'patch did not apply: checker_fix_locked'");
  });
});

describe('verifier undo migration: counters', () => {
  it('adds undone_at and undone_by to the log and the checks', () => {
    expect(undo).toContain('alter table public.audit_review_log');
    expect(undo).toContain('alter table public.content_checks');
    expect((undo.match(/add column if not exists undone_at timestamptz/g) ?? []).length).toBe(2);
  });

  it('patches every counter to read the counted views, and the verify block refuses otherwise', () => {
    for (const f of [
      'checker_checked_today_count()',
      'checker_my_stats()',
      'checker_leaderboard()',
      'verifier_my_papers()',
      'hod_team()',
      'admin_team_stats(timestamp with time zone, timestamp with time zone)',
      'admin_list_checker_accounts()',
      'admin_list_checkers()',
      'ai_trust_outcomes()',
    ]) {
      expect(undo, f).toContain(`'public.${f}'`);
    }
    expect(undo).toContain("'public.audit_review_log_counted'");
    expect(undo).toContain("'public.content_checks_counted'");
    expect(undo).toContain("raise exception 'patch did not apply: %', f;");
    expect(undo).toContain('undone_at is null');
  });

  it('adds the plain-words action to the history catalog', () => {
    expect(undo).toContain("('verifier_undo', 'checker'");
  });
});

describe('OR between two questions migration', () => {
  it('drops the separator and links the halves in the pipeline format', () => {
    expect(or).toContain('split_or_separator');
    expect(or).toContain("(?:OR|Or)");
    expect(or).toContain("jsonb_build_object('alternative_group', v_group, 'alternative_label', v_label)");
    expect(or).toContain("v_q.marks, v_q.chapter, coalesce(v_q.chapter_from_paper, false), v_group, 'or'");
    expect(or).toContain("v_q.number_path, v_q.display_number");
  });

  it('writes the first half through the version lock, not a raw update of the words', () => {
    expect(or).toContain("'audit_questions', p_question_id::text, v_q.version, v_changes, 'checker', 'checker'");
    expect(or).not.toMatch(/set body = v_first/);
  });

  it('does not treat a lower case or, or a longer word, as a separator', () => {
    expect(or).not.toMatch(/\(\?:OR\|Or\|or\)/);
    expect(or).toContain("is distinct from 'B'");
    expect(or).toContain('ORANGE is not a separator');
  });

  it('a row that is only OR is set aside with the reason and the neighbours are linked if not yet', () => {
    expect(or).toContain("v_reason constant text := 'This is just the OR between two questions'");
    expect(or).toContain('if v_prev_group is null then');
    expect(or).toContain('if v_next_group is null then');
    expect(or).toContain('set_aside_at = now()');
    expect(or).toContain("'verifier_or_separator'");
  });

  it('carries the link to the live library and refuses to half-apply', () => {
    expect(or).toContain("''alternative_group'', l.b_ag, l.alternative_group");
    expect(or).toContain("v_pl.field = ''alternative_label''");
    expect(or).toContain("raise exception 'patch did not apply: live_paper_plan'");
    expect(or).toContain("raise exception 'patch did not apply: _update_live_paper'");
  });

  it('revokes from public, anon and authenticated, then grants authenticated only', () => {
    expect(or).toContain("'public.checker_split_question(uuid, text, integer)'");
    expect(or).toContain("'public.verifier_or_separator(uuid)'");
    expect(or).toContain("execute format('revoke all on function %s from public, anon, authenticated', f);");
    expect(or).toContain("execute format('grant execute on function %s to authenticated', f);");
    expect(or).toContain('revoke all on function public.split_or_separator(text, text) from public, anon, authenticated');
    expect(or).not.toMatch(/grant execute[^;]*to anon/i);
  });

  it('uses no em or en dash in copy', () => {
    expect(readFileSync('supabase/migrations/20261008150000_verifier_or_alternatives.sql', 'utf8')).not.toMatch(/[–—]/);
    expect(readFileSync('supabase/migrations/20261008140000_verifier_undo_last.sql', 'utf8')).not.toMatch(/[–—]/);
    expect(readFileSync('supabase/migrations/20261008160000_verifier_skip_for_later.sql', 'utf8')).not.toMatch(/[–—]/);
  });
});

describe('skip for later migration', () => {
  it('serves skipped questions only on request and drops the one argument version', () => {
    expect(skip).toContain('p_include_skipped boolean default false');
    expect(skip).toContain('(coalesce(p_include_skipped, false) or sk.at is null)');
    expect(skip).toContain('drop function if exists public.verifier_next_in_paper(uuid);');
  });

  it('keeps skipped questions as work left and counts them', () => {
    expect(skip).toContain('as skipped');
    expect(skip).toContain('public.audit_review_log_counted');
    // the paper still closes only when nothing is left to answer
    expect(skip).not.toMatch(/update public\.checker_assignments/);
  });

  it('refuses nothing on the last question', () => {
    expect(skip).not.toMatch(/last question/i);
  });

  it('is revoked from the browser roles and granted to authenticated only', () => {
    expect(skip).toContain("'public.verifier_next_in_paper(uuid, boolean)'");
    expect(skip).toContain("'public.verifier_my_papers()'");
    expect(skip).toContain("execute format('revoke all on function %s from public, anon, authenticated', f);");
    expect(skip).toContain("execute format('grant execute on function %s to authenticated', f);");
    expect(skip).toContain("raise exception 'patch did not apply: verifier_next_in_paper'");
  });
});

describe('screen wiring', () => {
  const screen = readFileSync(resolve(__dirname, '../components/checker/VerifyScreen.tsx'), 'utf8');

  it('has an Undo last button, enabled only after an answer, with the U shortcut', () => {
    expect(screen).toContain('Undo last');
    expect(screen).toContain('disabled={submitting || answered.length === 0}');
    expect(screen).toContain("action === 'undo' && answered.length > 0");
    expect(screen).toContain('api.undoLast(paperId)');
  });

  it('shows Back to my papers in the header and no longer disables Skip on the last question', () => {
    expect(screen).toContain('Back to my papers');
    expect(screen).toContain('data-testid="back-to-my-papers"');
    expect(screen).not.toContain('lastOne');
    expect(screen).not.toContain('This is the last question left on this paper');
  });

  it('shows the done-for-now state when only skipped questions are left', () => {
    expect(screen).toContain('Go through skipped ones now');
    expect(screen).toContain('data-testid="only-skipped-left"');
  });

  it('offers Split on every question and the one-tap OR action', () => {
    expect(screen).toContain('const splitOffered = question ? !blank : false;');
    expect(screen).toContain('OR_ONLY_BUTTON');
    expect(screen).not.toContain('needsSplit(');
  });
});
