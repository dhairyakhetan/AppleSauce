import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import { supabase } from '@/integrations/supabase/client';
import { realHodApi } from '@/lib/hod-api';
import { createFakeHodApi } from '@/dummy/hod-fake-api';
import { GL } from '@/dummy/hod-golive-fake';
import { ACTION_LABELS } from '@/lib/history-labels';
import {
  CHECKS,
  OVERRIDE_MIN_REASON,
  OVERRIDE_NOT_ON_WORDS,
  canPublishAnywayNow,
  canPublishNow,
  normaliseOverrideMarks,
  overrideErrorWords,
  overrideMarkDetail,
  overrideOffered,
  overrideProblemsText,
  overrideReasonProblem,
  overrideWhyOff,
} from '@/lib/hod-publish';

/* "Publish anyway" (owner, 14 Nov 2026). The migration cannot run in CI (no database), so its load-bearing lines are
   pinned as source text; the screen rules are pure functions; the fake desk must obey the same rules as the server. */

const raw = readFileSync('supabase/migrations/20261114200000_publish_override.sql', 'utf8');
const sql = raw.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

function body(fn: string): string {
  const start = sql.indexOf(`create or replace function public.${fn}(`);
  expect(start).toBeGreaterThan(-1);
  const next = sql.indexOf('create or replace function', start + 10);
  return sql.slice(start, next === -1 ? sql.length : next);
}

const checks = (failing: string[]) => CHECKS.map((c) => ({ key: c.key, label: c.label, ok: !failing.includes(c.key), detail: failing.includes(c.key) ? 'Not yet.' : '' }));

describe('the database change', () => {
  it('has a paste file with the same text as the migration, in the papers folder', () => {
    let paste = '';
    try {
      paste = readFileSync('C:/Users/kanis/Desktop/Shikshaq Papers/PASTE_IN_SUPABASE_SQL_EDITOR_PUBLISH_OVERRIDE_20261114.sql', 'utf8');
    } catch {
      return; // the papers folder only exists on the owner's laptop; CI skips this
    }
    expect(paste).toBe(raw);
  });

  it('is a new function, so every old caller keeps working, and never drops or replaces hod_approve_paper', () => {
    expect(sql).toContain('create or replace function public.hod_publish_anyway(');
    expect(sql).not.toMatch(/drop function/i);
    expect(sql).not.toContain('function public.hod_approve_paper');
  });

  it('is a definer function with a fixed search path, and refuses anyone who is not an HOD with 42501 Not authorized', () => {
    for (const fn of ['hod_publish_anyway', 'hod_override_marks']) {
      const b = body(fn);
      expect(b).toContain('security definer');
      expect(b).toContain('set search_path = public, pg_temp');
      expect(b).toContain('if not public.is_hod() then');
      expect(b).toContain("raise exception 'Not authorized' using errcode = '42501'");
    }
  });

  it('revokes from public, anon and authenticated, then grants to authenticated only', () => {
    expect(sql).toContain('revoke all on function public.hod_publish_anyway(uuid, text, text, boolean) from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.hod_publish_anyway(uuid, text, text, boolean) to authenticated;');
    expect(sql).toContain('revoke all on function public.hod_override_marks() from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.hod_override_marks() to authenticated;');
    expect(sql).not.toMatch(/grant execute[^;]*to (anon|public)/i);
  });

  it('needs a reason of at least 10 characters before anything else is read', () => {
    const b = body('hod_publish_anyway');
    expect(b).toContain('char_length(v_reason) < 10');
    expect(b).toContain("errcode = '22023'");
    expect(b.indexOf('char_length(v_reason) < 10')).toBeLessThan(b.indexOf('select * into v_p'));
  });

  it('keeps the frozen Maths copy refusal, the waiting rule, the left-out confirmation and the shared publish path', () => {
    const b = body('hod_publish_anyway');
    expect(b).toContain("v_p.source = 'live_copy'");
    expect(b).toContain("v_p.approval_state is distinct from 'awaiting'");
    expect(b).toContain("hint = 'left_out'");
    expect(b).toContain('not coalesce(p_confirm_left_out, false)');
    expect(b).toContain('public.approval_publish_paper(p_audit_paper_id, v_note)');
  });

  it('still refuses what a live paper cannot exist without: nothing passed, or no school, class, subject or board', () => {
    const b = body('hod_publish_anyway');
    expect(b).toContain('Publish anyway cannot skip this: no question is passed yet');
    expect(b).toContain('the live paper needs a school, class, subject and board');
  });

  it('saves the reason and the skipped checks in the paper history, only when a check really failed', () => {
    const b = body('hod_publish_anyway');
    expect(b).toContain("insert into public.audit_review_log (actor_user_id, paper_id, question_id, action, before, after, note)");
    expect(b).toContain("'hod_publish_override'");
    expect(b).toContain("'reason', v_reason");
    expect(b).toContain("'overridden', v_keys");
    expect(b).toMatch(/if jsonb_array_length\(v_keys\) > 0 then\s+select string_agg/);
  });

  it('switches the override on for this one call only (transaction-local) and off again', () => {
    const b = body('hod_publish_anyway');
    expect(b).toContain("perform set_config('shikshaq.publish_override', 'on', true);");
    expect(b).toContain("perform set_config('shikshaq.publish_override', '', true);");
    expect(b.indexOf("'on', true")).toBeLessThan(b.indexOf('approval_publish_paper'));
    expect(b.indexOf("'', true")).toBeGreaterThan(b.indexOf('approval_publish_paper'));
  });

  it('edits the shared publish function in exactly two guards, and stops if its text is not what was expected', () => {
    expect(sql).toContain("v_new := replace(v_new, 'if v_open > 0 then', 'if v_open > 0 and not v_override then');");
    expect(sql).toContain("v_new := replace(v_new, 'if v_unstaged > 0 then', 'if v_unstaged > 0 and not v_override then');");
    expect(sql).toContain("raise exception 'approval_publish_paper is not in the shape expected; nothing was changed';");
    expect(sql).toContain("current_setting('shikshaq.publish_override', true), '') = 'on'");
    expect(sql).toContain("if v_def like '%shikshaq.publish_override%' then");
  });

  it('adds the plain history line and ends with five ok checks including anon cannot run it', () => {
    expect(sql).toContain("('hod_publish_override', 'admin',");
    expect(raw).toContain('a signed-out visitor cannot run it');
    expect(raw).toContain("has_function_privilege('anon', 'public.hod_publish_anyway(uuid, text, text, boolean)', 'execute')");
    expect((raw.split('-- CHECK:')[1].match(/then 'ok'/g) ?? []).length).toBe(5);
  });

  it('has a plain-English header with rollback notes and no em or en dashes', () => {
    expect(raw).toContain('ROLLBACK');
    expect(raw).toContain('WHAT STAYS A HARD STOP');
    expect(raw).not.toMatch(/[–—]/);
  });
});

describe('the screen rules', () => {
  it('needs 10 characters, and says how many more', () => {
    expect(OVERRIDE_MIN_REASON).toBe(10);
    expect(overrideReasonProblem('')).toMatch(/at least 10 characters/);
    expect(overrideReasonProblem('too short')).toBe('1 more character needed.');
    expect(overrideReasonProblem('   abc   ')).toBe('7 more characters needed.');
    expect(overrideReasonProblem('ten chars!!')).toBeNull();
    expect(overrideReasonProblem('x'.repeat(501))).toMatch(/too long/);
  });

  it('is offered only for a waiting paper with a failed check, never beside a green list', () => {
    expect(overrideOffered(checks(['pictures_present']), true)).toBe(true);
    expect(overrideOffered(checks([]), true)).toBe(false);
    expect(overrideOffered(checks(['pictures_present']), false)).toBe(false);
  });

  it('switches on only with the tick, a long enough reason and the left-out tick when something is left out', () => {
    const base = { checks: checks(['header_complete']), waiting: true, ticked: true, reason: 'Needed for the exam week', leftOut: 0, confirmedLeftOut: false };
    expect(canPublishAnywayNow(base)).toBe(true);
    expect(canPublishAnywayNow({ ...base, ticked: false })).toBe(false);
    expect(canPublishAnywayNow({ ...base, reason: 'short' })).toBe(false);
    expect(canPublishAnywayNow({ ...base, leftOut: 2 })).toBe(false);
    expect(canPublishAnywayNow({ ...base, leftOut: 2, confirmedLeftOut: true })).toBe(true);
    expect(canPublishAnywayNow({ ...base, waiting: false })).toBe(false);
    expect(canPublishAnywayNow({ ...base, checks: checks([]) })).toBe(false);
  });

  it('never changes the normal Publish: a failed check still switches it off', () => {
    expect(canPublishNow(checks(['header_complete']), 0, false, true)).toBe(false);
    expect(canPublishNow(checks([]), 0, false, true)).toBe(true);
  });

  it('says in plain words what is still needed', () => {
    expect(overrideWhyOff({ ticked: false, reason: '', leftOut: 0, confirmedLeftOut: false })).toBe('Tick the box to say you know about the problem.');
    expect(overrideWhyOff({ ticked: true, reason: 'abc', leftOut: 0, confirmedLeftOut: false })).toBe('7 more characters needed.');
    expect(overrideWhyOff({ ticked: true, reason: 'a good enough reason', leftOut: 1, confirmedLeftOut: false })).toMatch(/left out/);
    expect(overrideWhyOff({ ticked: true, reason: 'a good enough reason', leftOut: 0, confirmedLeftOut: false })).toBe('');
  });

  it('lists the failed checks for the confirm box', () => {
    expect(overrideProblemsText([{ label: 'Pictures are in place' }])).toBe('The check that failed: Pictures are in place.');
    expect(overrideProblemsText([{ label: 'A' }, { label: 'B' }])).toBe('The checks that failed: A; B.');
    expect(overrideProblemsText([])).toBe('');
  });

  it('says plainly that it is not switched on yet, and only for a missing function', () => {
    expect(overrideErrorWords({ code: 'PGRST202', message: 'Could not find the function' })).toBe(OVERRIDE_NOT_ON_WORDS);
    expect(overrideErrorWords({ code: '42883', message: 'function does not exist' })).toBe(OVERRIDE_NOT_ON_WORDS);
    expect(OVERRIDE_NOT_ON_WORDS).toMatch(/not switched on yet\. Nothing was published and nothing was changed\./);
    expect(overrideErrorWords({ code: '55000', message: 'This paper is not waiting to go live.' })).toBe(
      'Not published. The paper is still waiting for you. This paper is not waiting to go live.',
    );
  });

  it('reads the marker rows and describes them in words', () => {
    const rows = normaliseOverrideMarks([
      { audit_paper_id: 'p1', live_bank_paper_id: 'abc123', at: '2026-11-14T10:00:00Z', by_name: 'Asha', reason: 'Exam is tomorrow', skipped: ['Pictures are in place', 3] },
      { audit_paper_id: '' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].skipped).toEqual(['Pictures are in place']);
    expect(overrideMarkDetail(rows[0])).toBe('Checks skipped: Pictures are in place. Why: Exam is tomorrow');
  });

  it('has no em or en dashes in any new copy', () => {
    const src = readFileSync('src/lib/hod-publish.ts', 'utf8');
    const start = src.indexOf('Publish anyway (owner, 14 Nov 2026)');
    expect(src.slice(start)).not.toMatch(/[–—]/);
    expect(readFileSync('src/components/hod/PublishFlow.tsx', 'utf8')).not.toMatch(/[–—]/);
  });
});

describe('the history line', () => {
  it('has a label in people\'s words', () => {
    expect(ACTION_LABELS.hod_publish_override({ q: '', on: '', changes: null, verdict: '', conf: '', toVersion: '' })).toBe(
      'published a paper even though a check had failed, and said why',
    );
  });
});

describe('the real api', () => {
  const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

  it('sends the reason, the note and (only when true) the left-out confirmation', async () => {
    rpc.mockResolvedValueOnce({ data: { live_bank_paper_id: 'abc123', question_count: 12, overridden: ['pictures_present', 7] }, error: null });
    const out = await realHodApi.publishAnyway('p1', '  Exam is tomorrow  ', ' a note ', true);
    expect(rpc).toHaveBeenLastCalledWith('hod_publish_anyway', { p_audit_paper_id: 'p1', p_reason: 'Exam is tomorrow', p_note: 'a note', p_confirm_left_out: true });
    expect(out).toEqual({ live_bank_paper_id: 'abc123', question_count: 12, overridden: ['pictures_present'] });
    rpc.mockResolvedValueOnce({ data: { live_bank_paper_id: 'abc123', question_count: 1 }, error: null });
    await realHodApi.publishAnyway('p1', 'Exam is tomorrow');
    expect(rpc).toHaveBeenLastCalledWith('hod_publish_anyway', { p_audit_paper_id: 'p1', p_reason: 'Exam is tomorrow', p_note: null });
  });

  it('before the database file is pasted: publishing throws the missing-function error (nothing is sent anywhere else) and the marker read is null', async () => {
    const missing = { code: 'PGRST202', message: 'Could not find the function public.hod_publish_anyway' };
    rpc.mockClear();
    rpc.mockResolvedValueOnce({ data: null, error: missing });
    await expect(realHodApi.publishAnyway('p1', 'Exam is tomorrow')).rejects.toMatchObject({ code: 'PGRST202' });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe('hod_publish_anyway');
    expect(overrideErrorWords(missing)).toBe(OVERRIDE_NOT_ON_WORDS);
    rpc.mockResolvedValueOnce({ data: null, error: missing });
    expect(await realHodApi.overrideMarks()).toBeNull();
  });

  it('reads the markers when the function is there', async () => {
    rpc.mockResolvedValueOnce({ data: [{ audit_paper_id: 'p1', live_bank_paper_id: 'abc123', at: '2026-11-14T10:00:00Z', by_name: 'Asha', reason: 'Exam is tomorrow', skipped: ['Pictures are in place'] }], error: null });
    const rows = await realHodApi.overrideMarks();
    expect(rows).toHaveLength(1);
    expect(rpc).toHaveBeenLastCalledWith('hod_override_marks', {});
  });

  it('leaves the normal publish call exactly as it was', () => {
    const src = readFileSync('src/lib/hod-api.ts', 'utf8');
    expect(src).toContain("const out = obj(await call('hod_approve_paper', args));");
    expect(src).toContain("if (confirmLeftOut === true) args.p_confirm_left_out = true;");
  });
});

describe('the dummy desk obeys the same rules', () => {
  it('refuses a short reason, then still asks about left-out questions, then publishes and keeps a marker', async () => {
    const api = createFakeHodApi();
    await expect(api.publishAnyway(GL.econ2, 'short')).rejects.toThrow('Say why you are publishing with this problem (at least 10 characters).');
    await expect(api.publishAnyway(GL.econ2, 'The exam is tomorrow')).rejects.toMatchObject({ code: 'P0001', hint: 'left_out' });
    const out = await api.publishAnyway(GL.econ2, '  The exam is tomorrow  ', 'rushed', true);
    expect(out.overridden).toEqual(['pictures_present', 'header_complete', 'scanner_junk_gone']);
    expect(out.question_count).toBe(3);
    const marks = (await api.overrideMarks()) ?? [];
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ audit_paper_id: GL.econ2, reason: 'The exam is tomorrow', by_name: 'You' });
    expect(marks[0].skipped).toHaveLength(3);
    expect((await api.livePapers()).some((l) => l.audit_paper_id === GL.econ2 && l.is_published)).toBe(true);
    await expect(api.publishAnyway(GL.econ2, 'The exam is tomorrow', undefined, true)).rejects.toThrow('This paper is not waiting to go live.');
  });

  it('the normal publish still refuses the same paper', async () => {
    const api = createFakeHodApi();
    await expect(api.approvePaper(GL.econ2, '', true)).rejects.toThrow(/This paper cannot go live yet\./);
    expect(await api.overrideMarks()).toEqual([]);
  });

  it('a paper that passes every check publishes with no marker and no override', async () => {
    const api = createFakeHodApi();
    const out = await api.publishAnyway(GL.chem, 'Nothing was wrong with it');
    expect(out.overridden).toEqual([]);
    expect(await api.overrideMarks()).toEqual([]);
  });
});
