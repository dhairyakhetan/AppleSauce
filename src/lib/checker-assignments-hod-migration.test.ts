import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* 20261007100000_checker_assignments_and_hod.sql (per-checker papers and the
   HOD), 20261007110000_paper_page_pictures.sql and 20261007120000_ai_trust_levels.sql
   were applied live and cannot run in CI. Their load-bearing lines are pinned
   here: CLAUDE.md's grant trap, the role check inside every function, the
   escalated branch of checker_authorize_question, and the tables staying closed. */

const read = (f: string) =>
  readFileSync(`supabase/migrations/${f}`, 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

const sql = read('20261007100000_checker_assignments_and_hod.sql');
const pages = read('20261007110000_paper_page_pictures.sql');
const trust = read('20261007120000_ai_trust_levels.sql');

const CLIENT_FUNCTIONS = [
  'is_hod()',
  'admin_add_hod(text)',
  'admin_remove_hod(uuid)',
  'admin_list_hods()',
  'checker_next_question()',
  'checker_my_assignment()',
  'checker_return_paper(text)',
  'checker_pass_locked(uuid, integer)',
  'checker_fix_locked(uuid, integer, text, text, numeric, boolean, text)',
  'hod_escalations()',
  'hod_send_back(uuid, text)',
  'hod_set_aside(uuid, text)',
  'hod_team()',
  'hod_assignments()',
  'hod_unassigned_papers(integer)',
  'hod_assign_paper(uuid, uuid)',
  'hod_unassign(bigint)',
];

describe('checker assignments and HOD migration', () => {
  it('revokes every client function from public, anon and authenticated by name, then grants authenticated only', () => {
    for (const f of CLIENT_FUNCTIONS) expect(sql, f).toContain(`'public.${f}'`);
    expect(sql).toContain("execute format('revoke all on function %s from public, anon, authenticated', f);");
    expect(sql).toContain("execute format('grant execute on function %s to authenticated', f);");
    expect(sql).not.toMatch(/grant execute[^;]*to anon/i);
  });

  it('internal helpers are revoked from every client role and never granted back', () => {
    for (const h of [
      'public.checker_kind_for_caller()',
      'public.checker_question_servable(public.audit_questions)',
      'public.checker_settle_current(uuid)',
      'public.checker_authorize_question(uuid)',
    ]) {
      expect(sql, h).toContain(`'${h}'`);
    }
    expect(sql).not.toMatch(/grant execute on function public\.checker_authorize_question/);
  });

  it('the new tables are closed to every client role with row level security on', () => {
    for (const t of ['paper_hods', 'checker_assignments']) {
      expect(sql).toContain(`alter table public.${t} enable row level security;`);
      expect(sql).toContain(`revoke all on public.${t} from public, anon, authenticated;`);
    }
  });

  it('every hod_* and admin_*_hod function checks the caller inside', () => {
    const bodies = sql.split(/create (?:or replace )?function /).slice(1);
    for (const b of bodies) {
      const name = b.slice(0, b.indexOf('(')).replace('public.', '');
      if (/^hod_/.test(name)) expect(b, name).toContain('public.is_hod()');
      if (/^admin_(add|remove|list)_hod$/.test(name)) expect(b, name).toContain('public.is_admin()');
      if (name !== 'checker_kind_for_caller' && name !== 'is_hod') expect(b, name).toMatch(/security definer|language sql stable/);
    }
  });

  it('checker_authorize_question has an escalated branch that only an HOD may use', () => {
    const fn = sql.slice(sql.indexOf('function public.checker_authorize_question'));
    expect(fn).toContain("if v_q.review_bucket = 'escalated' then");
    expect(fn).toContain('if not public.is_hod() then');
    expect(fn).toContain("raise exception 'This question was sent to the HOD' using errcode = '42501'");
    // A checker still needs the lease on a question routed to them.
    expect(fn).toContain("if v_q.review_bucket <> 'kid' then");
    expect(fn).toContain('v_q.locked_by = auth.uid()');
  });

  it('an HOD verdict is recorded as hod, and the pass and fix keep the version lock', () => {
    expect(sql).toContain("'student', 'admin', 'hod'");
    expect(sql).toContain('public.checker_kind_for_caller()');
    expect(sql.match(/using errcode = '40001'/g)?.length).toBe(2);
  });

  it('a paper has at most one holder and a checker at most one current paper', () => {
    expect(sql).toContain("where status in ('queued', 'assigned')");
    expect(sql).toContain("where status = 'assigned'");
    expect(sql).toContain('checker_assignments_one_holder');
    expect(sql).toContain('checker_assignments_one_current');
  });

  it('set aside needs a reason and set-aside questions are not served', () => {
    expect(sql).toContain("raise exception 'Say why it is being set aside' using errcode = '22023'");
    expect(sql).toContain('p_q.set_aside_at is null');
  });
});

describe('paper page pictures migration', () => {
  it('is closed to anon and open to authenticated, with the role check inside', () => {
    expect(pages).toContain('revoke all on function public.paper_page_pictures(uuid) from public, anon, authenticated;');
    expect(pages).toContain('grant execute on function public.paper_page_pictures(uuid) to authenticated;');
    expect(pages).toContain('security definer');
    expect(pages).toContain('public.is_hod()');
    expect(pages).toContain('a.status in (\'assigned\', \'queued\')');
  });

  it('lets an HOD read the audit-figures bucket', () => {
    expect(pages).toContain('public.is_admin() or public.is_paper_checker() or public.is_hod()');
  });
});

describe('AI trust migration', () => {
  it('the meter is for an HOD and the switch is admin only, both closed to anon', () => {
    expect(trust).toContain("'public.ai_trust_meter()', 'public.admin_set_ai_trust(text, text, boolean)'");
    const meter = trust.slice(trust.indexOf('function public.ai_trust_meter'));
    expect(meter.slice(0, 700)).toContain('public.is_hod()');
    const sw = trust.slice(trust.indexOf('function public.admin_set_ai_trust'));
    expect(sw.slice(0, 700)).toContain('public.is_admin()');
    expect(sw).toContain("'Not earned yet");
  });
});

describe('verifier paper lists migration', () => {
  const v = read('20261007130000_verifier_paper_lists.sql');

  it('revokes every client function from public, anon and authenticated by name, then grants authenticated only', () => {
    for (const f of [
      'verifier_my_papers()',
      'verifier_paper_questions(uuid)',
      'verifier_next_in_paper(uuid)',
      'verifier_my_profile()',
      'verifier_request_subjects(text[])',
      'hod_verifier_profiles()',
      'hod_set_verifier_profile(uuid, text, integer, text, text, date)',
      'hod_set_preferred_subjects(uuid, text[])',
      'hod_action_history(uuid, text, integer, timestamptz)',
      'hod_team()',
      'hod_assign_paper(uuid, uuid)',
    ]) {
      expect(v, f).toContain(`'public.${f}'`);
    }
    expect(v).toContain("execute format('revoke all on function %s from public, anon, authenticated', f);");
    expect(v).toContain("execute format('grant execute on function %s to authenticated', f);");
    expect(v).not.toMatch(/grant execute[^;]*to anon/i);
  });

  it('the grade rule helpers are internal: revoked from every client role, never granted back', () => {
    for (const h of ['verifier_can_take(uuid, uuid)', 'class_grade(text)', 'board_family(text)', 'subject_key(text)', 'verifier_close_finished(uuid)']) {
      expect(v, h).toContain(`'public.${h}'`);
    }
    expect(v).not.toMatch(/grant execute on function public\.verifier_can_take/);
  });

  it('only the service role may run the automatic hand-out by name, besides a verifier or HOD', () => {
    expect(v).toContain('grant execute on function public.distribute_unassigned_papers() to service_role');
    const d = v.slice(v.indexOf('function public.distribute_unassigned_papers'));
    expect(d.slice(0, 700)).toContain("auth.role() = 'service_role'");
  });

  it('checks the caller inside every client function', () => {
    const body = (name: string) => v.slice(v.indexOf(`function public.${name}`));
    for (const hodOnly of ['hod_set_verifier_profile', 'hod_set_preferred_subjects', 'hod_verifier_profiles', 'hod_assign_paper', 'hod_team', 'hod_action_history']) {
      expect(body(hodOnly).slice(0, 1600), hodOnly).toContain('public.is_hod()');
    }
    for (const verifierOnly of ['verifier_request_subjects', 'verifier_my_profile', 'verifier_my_papers', 'verifier_next_in_paper']) {
      expect(body(verifierOnly).slice(0, 900), verifierOnly).toContain('public.is_paper_checker()');
    }
  });

  it('a verifier cannot be given a paper above their grade, and an expired or empty profile gets nothing', () => {
    const can = v.slice(v.indexOf('function public.verifier_can_take'));
    expect(can.slice(0, 1200)).toContain('public.class_grade(ap.class) > vp.grade');
    expect(can.slice(0, 1200)).toContain('vp.valid_until < current_date');
    expect(can.slice(0, 1200)).toContain('vp.grade is null');
  });

  it('the profiles table is closed to every client role', () => {
    expect(v).toContain('alter table public.verifier_profiles enable row level security;');
    expect(v).toContain('revoke all on public.verifier_profiles from public, anon, authenticated;');
  });

  it('logs the three new actions with a meaning each', () => {
    for (const a of ['hod_set_verifier_profile', 'hod_set_preferred_subjects', 'verifier_request_subjects']) {
      expect(v).toContain(`('${a}',`);
    }
  });
});
