import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createFakeCheckerApi } from '@/dummy/checker-fake-api';
import { reopenErrorMessage } from '@/lib/checker-errors';

/* "Edit" on a question already marked Done. The database function
   (20261019100000_verifier_reopen_question.sql) cannot run in CI, so its
   load-bearing lines are pinned here, and the fake that copies it is exercised.

   Rehearsed 19 October 2026 in a rolled-back transaction against the live
   database (one execute_sql call ending in RAISE EXCEPTION): the holder reopened
   a Done question (1 row back, question_passed false, status flagged, leased);
   a second reopen was refused ("not marked Done"); the ordinary Pass then
   worked and verifier_undo_last still worked after it; a user who does not hold
   the paper was refused 42501; has_function_privilege gave anon false,
   authenticated true, public false. */

const raw = readFileSync('supabase/migrations/20261019100000_verifier_reopen_question.sql', 'utf8');
const sql = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('verifier_reopen_question migration', () => {
  it('is a security definer function with a pinned search path', () => {
    expect(sql).toContain('create or replace function public.verifier_reopen_question(p_question_id uuid)');
    expect(sql).toContain('security definer');
    expect(sql).toContain('set search_path = public, pg_temp');
  });

  it('checks the caller is a checker and holds the paper, and refuses with 42501', () => {
    expect(sql).toContain('not public.is_paper_checker()');
    expect(sql).toContain("a.status in ('queued', 'assigned', 'done')");
    expect(sql).toContain('a.user_id = v_uid');
    expect(sql.match(/errcode = '42501'/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("only reopens a Done, verifier-routed question that is the caller's or nobody's", () => {
    expect(sql).toContain('not v_q.question_passed');
    expect(sql).toContain("v_q.review_bucket <> 'kid'");
    expect(sql).toContain('v_q.set_aside_at is not null');
    expect(sql).toContain('v_q.checked_by_user <> v_uid');
    expect(sql).toContain("v_paper.approval_state in ('awaiting', 'approved')");
  });

  it('never touches the words: no body, display_number or marks in any SET', () => {
    const sets = sql.match(/\bset [^;]*?where/gis) ?? [];
    expect(sets.length).toBeGreaterThan(0);
    for (const s of sets) {
      expect(s).not.toMatch(/\bbody\s*=/);
      expect(s).not.toMatch(/\bdisplay_number\s*=/);
      expect(s).not.toMatch(/\bmarks\s*=/);
    }
  });

  it('writes its history row already undone, so counters and Undo skip it', () => {
    expect(sql).toContain("'verifier_reopen'");
    expect(sql).toContain('undone_at, undone_by');
    expect(sql).toContain('insert into public.log_action_catalog');
  });

  it('is closed to public, anon AND authenticated, then granted to authenticated only', () => {
    expect(sql).toContain('revoke all on function public.verifier_reopen_question(uuid) from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.verifier_reopen_question(uuid) to authenticated;');
    expect(sql).not.toMatch(/grant execute[^;]*\bto (anon|public)\b/);
  });
});

describe('reopen in the fake (dummy mode)', () => {
  async function start() {
    const api = createFakeCheckerApi();
    const [paper] = await api.myPapers();
    return { api, paper };
  }

  it('a Done question comes back as the next one, with the same words, and Done drops by one', async () => {
    const { api, paper } = await start();
    const q = (await api.nextInPaper(paper.paper_id))!;
    await api.passQuestion(q.id, q.version);
    expect((await api.myPapers())[0].done).toBe(1);

    const back = await api.reopenQuestion(q.id);
    expect(back.id).toBe(q.id);
    expect(back.body).toBe(q.body);
    expect((await api.myPapers())[0].done).toBe(0);
    const states = await api.paperQuestions(paper.paper_id);
    expect(states.find((x) => x.id === q.id)?.state).toBe('to_verify');
    expect((await api.nextInPaper(paper.paper_id))?.id).toBe(q.id);
  });

  it('can be fixed and saved again through the ordinary Fix it path', async () => {
    const { api, paper } = await start();
    const q = (await api.nextInPaper(paper.paper_id))!;
    await api.passQuestion(q.id, q.version);
    const back = await api.reopenQuestion(q.id);
    await api.fixQuestion(q.id, { body: `${back.body} (fixed)` }, { version: back.version });
    const states = await api.paperQuestions(paper.paper_id);
    const row = states.find((x) => x.id === q.id)!;
    expect(row.state).toBe('done');
    expect(row.body).toBe(`${q.body} (fixed)`);
  });

  it('refuses a question that is not Done (22023) and one that is not on a held paper (42501)', async () => {
    const { api, paper } = await start();
    const q = (await api.nextInPaper(paper.paper_id))!;
    await expect(api.reopenQuestion(q.id)).rejects.toMatchObject({ code: '22023' });
    await expect(api.reopenQuestion('00000000-0000-0000-0000-000000000000')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('reopenErrorMessage', () => {
  it('shows a 22023 refusal as the sentence it already is', () => {
    expect(reopenErrorMessage({ code: '22023', message: 'That question is with the HOD or set aside, so it cannot be reopened here.' })).toBe(
      'That question is with the HOD or set aside, so it cannot be reopened here.',
    );
  });
  it('gives plain lines for not-yours and for everything else, with no dashes', () => {
    const a = reopenErrorMessage({ code: '42501', message: 'That question is not on a paper you hold' });
    const b = reopenErrorMessage(new Error('Failed to fetch'));
    expect(a).toMatch(/not on a paper you hold/);
    expect(b).toMatch(/internet/);
    expect(a + b).not.toMatch(/[–—]/);
  });
});
