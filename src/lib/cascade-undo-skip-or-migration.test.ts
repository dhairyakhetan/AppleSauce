import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* 20261008170000_cascade_undo_skip_or.sql cannot run in CI. Its load-bearing
   lines are pinned here: every reader that must leave out undone rows, the one
   skip rule, the OR link reaching the library, an unknown class going to any
   verifier, and the grants (anon never, internal functions to nobody). */

const FILE = 'supabase/migrations/20261008170000_cascade_undo_skip_or.sql';
const raw = readFileSync(FILE, 'utf8');
const sql = raw
  .replace(/\r\n/g, '\n')
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

const section = (from: string, to?: string) => {
  const a = sql.indexOf(from);
  expect(a, from).toBeGreaterThan(-1);
  const b = to ? sql.indexOf(to, a + from.length) : sql.length;
  expect(b, to ?? 'end').toBeGreaterThan(a);
  return sql.slice(a, b);
};

describe('cascade migration: undone rows stop counting', () => {
  it('moves every remaining counter onto the counted views, reads only', () => {
    for (const f of [
      'admin_checker_list()',
      'admin_approval_queue()',
      'ai_backfill_confidence()',
      'admin_paper_progress()',
      'hod_escalations()',
      'verifier_return_idle()',
    ]) {
      expect(sql, f).toContain(`'public.${f}'`);
    }
    // only from / join move, so the insert in verifier_return_idle keeps its table
    expect(sql).toContain('(\\m(?:from|join)\\s+)(?:public\\.)?audit_review_log\\M');
    expect(sql).toContain('(\\m(?:from|join)\\s+)(?:public\\.)?content_checks\\M');
    expect(sql).toContain("insert\\s+into\\s+public\\.audit_review_log\\M");
    expect(sql).toContain("raise exception 'patch did not apply: % reads neither table', f;");
    expect(sql).toContain("raise exception 'patch did not apply: % still reads a raw table', f;");
  });

  it('the day log counts only standing rows but lists every row, marked', () => {
    const day = section('create or replace function public.admin_checker_day_log', 'create or replace function public.checker_settle_current');
    expect(day).toContain('count(*) filter (where not cd.undone) as n');
    expect((day.match(/and not cd\.undone\)/g) ?? []).length).toBe(7);
    expect(day).toContain("'undone', t.undone");
    // the event list is built from every row, not the standing ones
    expect(day).toContain('select cd.* from coded cd order by cd.at desc, cd.id desc limit 5000');
    expect(day).not.toContain('where not cd.undone\n');
  });

  it('the history readers that return JSON say whether an event was undone', () => {
    const he = section('create or replace function public.history_events', 'drop function if exists public.hod_action_history');
    expect(he).toContain("'undone', e.undone");
    expect(he).toContain('l.undone_at');
    expect(he).toContain('k.undone_at');
    expect(sql).toContain("''undone'', k.undone_at is not null,");
  });

  it('hod_action_history gains an undone column and keeps its name and arguments', () => {
    expect(sql).toContain('drop function if exists public.hod_action_history(uuid, text, integer, timestamptz);');
    expect(sql).toContain('question_number text, note text, undone boolean)');
    expect(sql).toContain('(l.undone_at is not null)');
  });
});

describe('cascade migration: one skip rule', () => {
  const settle = section('create or replace function public.checker_settle_current', 'create temp table _cascade_patch');
  it('uses the verifier_next_in_paper rule with no day window', () => {
    expect(settle).toContain('s.skipped_at >= v_a.assigned_at');
    expect(settle).not.toContain('24 hours');
    expect(settle).not.toMatch(/interval '/);
  });

  it('keeps a paper open when only skipped questions are left', () => {
    expect(settle).toContain('if v_left_skipped > 0 then');
    expect(settle).toContain('continue;');
    // closing happens only after that test, and never says "skipped"
    expect(settle.indexOf('if v_left_skipped > 0 then')).toBeLessThan(settle.indexOf("set status = case when v_left_at_all = 0 then 'done'"));
    expect(settle).not.toContain('only skipped questions were left');
  });
});

describe('cascade migration: the OR link reaches the library', () => {
  it('carries both fields in every publish path that inserts a question', () => {
    expect(sql).toContain("'public.apply_live_copy_paper_to_live(uuid)'");
    expect(sql).toContain("'public.english_rescue_publish_question(uuid)'");
    expect(sql).toContain("'public.english_rescue_publish_split_half(uuid)'");
    expect(sql).toContain("'public.apply_new_ocr_fixes_to_live(uuid)'");
    expect(sql).toContain('v_q.answer_key, null, null, null, null, v_q.alternative_group, v_q.alternative_label);');
    expect(sql).toContain('v_parent.chapter, null, null, null, null, v_q.alternative_group, v_q.alternative_label);');
    expect(sql).toContain('v_options, v_q.instructions, v_q.alternative_group, v_q.alternative_label);');
    expect(sql).toContain('v_parent.chapter, v_parent.qtype, null, null, null, v_q.alternative_group, v_q.alternative_label);');
  });

  it('never blanks a link the library already holds', () => {
    expect(sql).toContain("nullif(btrim(coalesce(v_q.alternative_group, '''')), '''') is not null");
    expect(sql).toContain("nullif(btrim(coalesce(v_q.alternative_label, '''')), '''') is not null");
  });

  it('counts every anchor and refuses to half-apply', () => {
    expect(sql).toContain('if n <> p.expected then');
    expect(sql).toContain("raise exception 'patch did not apply: % anchor occurs % times, expected %: %'");
    expect(sql).toContain("raise exception 'patch did not apply: apply_live_copy_paper_to_live must carry the link in both inserts'");
  });
});

describe('cascade migration: an unknown class goes to any verifier', () => {
  it('no longer forces the paper to Class 12 and treats null as eligible', () => {
    expect(sql).toContain("'public.class_grade(ap.class) as grade,'");
    expect(sql).toContain('(dp.grade is null or dp.grade <= d.grade)');
    expect(sql).toContain('(p.grade is null or p.grade <= d.grade)');
    expect(sql).toContain("raise exception 'patch did not apply: distribute_unassigned_papers'");
  });

  it('a verifier with no grade still counts as 12', () => {
    expect(sql).toContain("position('coalesce(vp.grade, 12)' in src) = 0");
  });
});

describe('cascade migration: access', () => {
  it('revokes from public, anon and authenticated, then grants the browser functions to authenticated only', () => {
    expect(sql).toContain("execute format('revoke all on function %s from public, anon, authenticated', f);");
    expect(sql).toContain("execute format('grant execute on function %s to authenticated', f);");
    expect(sql).not.toMatch(/grant execute[^;]*to anon/i);
    expect(sql).not.toMatch(/grant execute[^;]*to public/i);
  });

  it('keeps the internal functions closed to the browser roles and checks it', () => {
    for (const f of [
      'ai_backfill_confidence()',
      'checker_settle_current(uuid)',
      'apply_live_copy_paper_to_live(uuid)',
      'apply_new_ocr_fixes_to_live(uuid)',
      'english_rescue_publish_question(uuid)',
      'english_rescue_publish_split_half(uuid)',
      'history_events(uuid, uuid)',
    ]) {
      expect(sql, f).toContain(`'public.${f}'`);
    }
    expect(sql).toContain("raise exception 'anon can execute %', f;");
    expect(sql).toContain("raise exception 'authenticated can execute the internal function %', f;");
  });

  it('uses no em or en dash', () => {
    expect(raw).not.toMatch(/[–—]/);
  });
});
