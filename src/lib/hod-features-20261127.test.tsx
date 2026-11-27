import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...a: unknown[]) => {
      const out = rpc(...a) as Promise<unknown>;
      // timedRpc calls .abortSignal() on the builder; a plain promise stands in for it.
      return Object.assign(out, { abortSignal: () => out });
    },
    from: vi.fn(),
    storage: { from: vi.fn() },
    auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() },
  },
}));

import { createGoLiveFake, GL } from '@/dummy/hod-golive-fake';
import { ReasonBox, UndoStrip } from '@/components/hod/HodReason';
import { SendBackToChecking } from '@/components/hod/SendBackToChecking';
import { SendPaperToAi } from '@/components/hod/SendPaperToAi';
import { AI_REDO_KEY, SendToAiTab } from '@/components/hod/SendToAiTab';
import { realHodApi, type HodApi } from '@/lib/hod-api';
import { aiRedoStepWords, normaliseAiRedoList, normaliseNeedsQuestion, whyItNeedsYou, type HodAiRedoItem } from '@/lib/hod-publish';
import { hodRefreshPlan } from '@/lib/hod-refresh';
import {
  canSendToAi,
  normalisePaperAiCounts,
  paperSendConfirm,
  paperSendCount,
  paperSentLine,
  reasonCounter,
  reasonProblem,
  REASON_MAX,
  REASON_MIN,
  SEND_BACK_NOT_ON_WORDS,
  SEND_TO_AI_NOT_ON_WORDS,
  sendBackConfirm,
  sendFailureWords,
  sendToAiBadgeLabel,
} from '@/lib/hod-send-to-ai';
import { resetGivenBy, verifierMyPapers } from '@/lib/checker-api';
import { resetPapersExtra } from '@/lib/checker-api';
import { GIVEN_BY_HOD, givenByLabel } from '@/lib/checker-progress';
import { normaliseGivenBy, normaliseMyPapers, withGivenBy } from '@/lib/verifier-papers';
import {
  EMPTY_GUARDIAN_FORM,
  GRADE_OPTIONS,
  guardianFormFromRow,
  guardianProblems,
  guardianProfileUpdate,
  saveGuardianProfile,
} from '@/lib/guardian-profile';

/* HOD features, 27 Nov 2026 (owner decisions): Send to AI (one question, and a whole paper) with Undo and a count; Send
   back to checking from Ready; guardians can edit their profile; "Given by <first name>" on a checker's paper. The SQL
   cannot run in CI (no database), so its load-bearing lines are pinned from the migration file, and every screen keeps
   working on the OLD database shape (before the owner pastes the file). */

const MIGRATION = 'supabase/migrations/20261127140000_hod_features.sql';
const PASTE = 'C:/Users/kanis/Desktop/Shikshaq Papers/PASTE_IN_SUPABASE_SQL_EDITOR_20261127_L_hod_features.sql';
const rawSql = readFileSync(MIGRATION, 'utf8');
const sql = rawSql
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');
const read = (p: string) => readFileSync(p, 'utf8');

function body(fn: string): string {
  const start = sql.indexOf(`create or replace function public.${fn}(`);
  expect(start, fn).toBeGreaterThan(-1);
  const next = sql.indexOf('create or replace function', start + 10);
  return sql.slice(start, next === -1 ? sql.length : next);
}

const NEW_FUNCTIONS = [
  'hod_send_to_ai(uuid, text)',
  'hod_undo_send_to_ai(uuid)',
  'hod_paper_ai_counts(uuid)',
  'hod_send_paper_to_ai(uuid, text, boolean)',
  'hod_undo_send_paper_to_ai(uuid)',
  'hod_ai_redo_count()',
  'hod_send_paper_back_to_checking(uuid, text)',
  'verifier_my_papers_given_by()',
];

describe('the migration', () => {
  it('is one file in a transaction, safe to run twice, with a read-only all-true check at the end', () => {
    expect(sql).toMatch(/^\s*begin;/m);
    expect(sql).toMatch(/^commit;/m);
    expect(sql).not.toMatch(/create function/i);
    expect(sql).toContain('create table if not exists public.ai_redo_paper_requests');
    expect(sql).toContain('create index if not exists');
    expect(sql).toContain('on conflict (action) do nothing');
    const check = sql.slice(sql.lastIndexOf('commit;'));
    expect(check).toMatch(/\bselect\b/);
    // Read only: after the commit there is nothing but a select.
    expect(check).not.toMatch(/\b(insert|update|delete|alter|drop|create|revoke|grant)\b/i);
    // "all-true columns": every column is a yes/no test.
    const columns = check.split(/\n/).filter((l) => /\bas [a-z_]+,?$/.test(l.trim()));
    expect(columns.length).toBeGreaterThanOrEqual(10);
    expect(check).toContain('as signed_in_people_can_call');
    expect(check).toContain('as a_signed_out_visitor_cannot');
  });

  it('every new function checks its role inside, runs as the owner of the data, and is closed to anon', () => {
    for (const fn of NEW_FUNCTIONS) {
      expect(sql, fn).toContain(`revoke all on function public.${fn} from public, anon, authenticated;`);
      expect(sql, fn).toContain(`grant execute on function public.${fn} to authenticated;`);
      const name = fn.slice(0, fn.indexOf('('));
      const b = body(name);
      expect(b, name).toContain('security definer');
      expect(b, name).toContain("set search_path to 'public', 'pg_temp'");
      expect(b, name).toMatch(name === 'verifier_my_papers_given_by' ? /is_paper_checker\(\)/ : /public\.is_hod\(\)/);
    }
    expect(sql).toContain('revoke all on table public.ai_redo_paper_requests from public, anon, authenticated;');
    expect(sql).toContain('alter table public.ai_redo_paper_requests enable row level security;');
  });

  it('never touches the functions another job is rewriting, and never alters question text', () => {
    for (const fn of ['hod_unassigned_papers', 'distribute_unassigned_papers', 'hod_assign_paper', 'checker_question_servable', 'paper_pictures_complete', 'checker_has_picture']) {
      expect(sql, fn).not.toMatch(new RegExp(`create or replace function public\\.${fn}\\(`));
    }
    // No statement sets the words of a question (body, options, instructions, marks, display number).
    expect(sql).not.toMatch(/\bset\s+body\b|,\s*body\s*=|\bbody\s*=\s*(?!null)/);
    expect(sql).not.toMatch(/\boptions\s*=|\binstructions\s*=|\bmarks\s*=|\bdisplay_number\s*=/);
  });

  it('Send to AI needs a reason of 5 to 500 characters and records the HOD', () => {
    const b = body('hod_send_to_ai');
    expect(b).toContain('char_length(v_reason) < 5');
    expect(b).toContain('char_length(v_reason) > 500');
    expect(b).toContain("ai_redo_state = 'approved'");
    expect(b).toContain('ai_redo_by = auth.uid()');
    expect(b).toContain('ai_redo_decided_by = auth.uid()');
    expect(b).toContain("'hod_send_to_ai'");
    expect(b).toContain('v_reason');
    // Refuses: live Maths copy, already-live question, not waiting for the HOD, student request waiting, already sent.
    expect(b).toContain("v_source = 'live_copy'");
    expect(b).toContain('v_q.live_bank_question_id is not null');
    expect(b).toContain("v_q.review_bucket not in ('escalated', 'admin')");
    expect(b).toContain("v_q.ai_redo_state = 'requested'");
    expect(b).toContain("v_q.ai_redo_state = 'approved'");
  });

  it('Undo is real: it restores the old marks, only for the person who sent it, only before the AI has started', () => {
    const b = body('hod_undo_send_to_ai');
    expect(b).toContain("l.action = 'hod_send_to_ai' and l.undone_at is null");
    expect(b).toContain('actor_user_id is distinct from auth.uid()');
    expect(b).toContain("interval '5 minutes'");
    expect(b).toContain("l.action like 'ai\\_redo\\_%'");
    expect(b).toContain("v_q.ai_redo_state is distinct from 'approved'");
    expect(b).toContain("ai_redo_state = v_log.before ->> 'ai_redo_state'");
    expect(b).toContain('set undone_at = now(), undone_by = auth.uid()');
  });

  it('a whole-paper send is ONE request, the reason reaches every question marked as a paper-wide problem, and Undo is all or nothing', () => {
    const b = body('hod_send_paper_to_ai');
    expect(b).toContain("v_prefix constant text := 'The HOD says this problem runs through the whole paper: '");
    expect(b).toContain('ai_redo_reason = v_prefix || v_reason');
    expect(b).toContain('insert into public.ai_redo_paper_requests');
    expect(b).toContain("'hod_send_paper_to_ai'");
    expect(b).toContain("'hod_send_to_ai_with_paper'");
    // Default: only what waits on the HOD. The students' questions only with the box.
    expect(b).toContain("q.review_bucket in ('escalated', 'admin') or (coalesce(p_include_other, false) and q.review_bucket = 'kid')");
    expect(b).toContain("q.live_bank_question_id is null");
    expect(b).toContain("q.ai_redo_state is distinct from 'requested' and q.ai_redo_state is distinct from 'approved'");
    expect(b).toContain("v_p.source = 'live_copy'");
    const u = body('hod_undo_send_paper_to_ai');
    expect(u).toContain('The AI has already picked up some of these questions, so the request cannot be taken back.');
    expect(u).toContain('v_req.requested_by is distinct from auth.uid()');
    expect(u).toContain("interval '5 minutes'");
    expect(u).toContain("review_bucket = coalesce(r.before ->> 'review_bucket', review_bucket)");
  });

  it('the AI re-read job still finds these questions: same mark, and the reason is in ai_redo_reason', () => {
    // pipeline/auditor/ai_check/ai_redo.py lists ai_redo_state = 'approved' and reads ai_redo_reason as "the reason".
    expect(body('hod_send_to_ai')).toContain("ai_redo_state = 'approved', ai_redo_reason = v_reason");
    expect(body('hod_send_paper_to_ai')).toContain("ai_redo_state = 'approved', ai_redo_reason = v_prefix || v_reason");
  });

  it('Send back to checking only works on a waiting, non-live pipeline paper and logs every question', () => {
    const b = body('hod_send_paper_back_to_checking');
    expect(b).toContain("v_p.source is distinct from 'new_ocr'");
    expect(b).toContain('v_p.live_bank_paper_id is not null or v_p.approval_kind = \'retro\' or v_p.approval_state = \'approved\'');
    expect(b).toContain("v_p.approval_state is distinct from 'awaiting'");
    expect(b).toContain('char_length(v_reason) < 5');
    expect(b).toContain('question_passed = false');
    expect(b).toContain("review_bucket = 'kid'");
    expect(b).toContain('q.set_aside_at is null');
    expect(b).toContain("set approval_state = null, approval_kind = null, queued_at = null");
    expect(b).toContain("'hod_reopen_for_checking'");
    expect(b).toContain("'hod_send_paper_back_to_checking'");
    expect(b).toContain('v_reason');
    // It never writes to the live tables.
    expect(b).not.toMatch(/bank_papers|bank_questions/);
  });

  it('the checker read returns a first name only, for the checker own papers only', () => {
    const b = body('verifier_my_papers_given_by');
    expect(b).toContain("split_part(btrim(coalesce(p.full_name, '')), ' ', 1)");
    expect(b).toContain('a.user_id = v_uid');
    expect(b).toContain('a.assigned_by is not null');
    expect(b).toContain("position('@' in");
    expect(sql).not.toMatch(/create or replace function public\.verifier_my_papers\(/);
  });

  it('the two lists each learn who sent a question, with the latest text otherwise', () => {
    expect(body('hod_ai_redo_list')).toContain("'asked_by_hod'");
    expect(body('hod_needs_you_questions')).toContain("'ai_redo_by_hod'");
    // The live-Maths-copy rule of 20261119400000 is kept.
    expect(body('hod_needs_you_questions')).toContain("(v_source <> 'live_copy' or q.review_bucket = 'escalated')");
    expect(body('hod_ai_redo_list')).toContain("'paper_source', ap.source");
  });

  it('adds a plain-words line for every new history action', () => {
    for (const a of ['hod_send_to_ai', 'hod_undo_send_to_ai', 'hod_send_to_ai_with_paper', 'hod_send_paper_to_ai', 'hod_undo_send_paper_to_ai', 'hod_reopen_for_checking', 'hod_send_paper_back_to_checking']) {
      expect(sql).toContain(`'${a}'`);
    }
  });

  it('the paste file in the papers folder is the same file', () => {
    let paste = '';
    try {
      paste = read(PASTE);
    } catch {
      return; // CI has no papers folder: the check runs on the owner's machine.
    }
    expect(paste.replace(/\r\n/g, '\n')).toBe(rawSql.replace(/\r\n/g, '\n'));
  });
});

describe('the reason box rules', () => {
  it('needs a real reason, 5 to 500 characters, counted trimmed', () => {
    expect(reasonProblem('')).toMatch(/Write a reason/);
    expect(reasonProblem('   ')).toMatch(/Write a reason/);
    expect(reasonProblem('abcd')).toContain(`at least ${REASON_MIN}`);
    expect(reasonProblem('abcde')).toBeNull();
    expect(reasonProblem('x'.repeat(REASON_MAX))).toBeNull();
    expect(reasonProblem('x'.repeat(REASON_MAX + 1))).toContain(`${REASON_MAX} characters at most`);
    expect(reasonCounter('  hello  ')).toBe(`5 / ${REASON_MAX}`);
  });

  it('the box draws a required textarea with a hard limit and a counter', () => {
    const html = renderToStaticMarkup(createElement(ReasonBox, { id: 'r', label: 'Why? (required)', value: 'ab', onChange: () => {} }));
    expect(html).toContain('maxLength="500"');
    expect(html).toContain('required');
    expect(html).toContain('2 / 500');
    expect(html).toContain('Say a little more');
    const empty = renderToStaticMarkup(createElement(ReasonBox, { id: 'r', label: 'Why?', value: '', onChange: () => {} }));
    expect(empty).toContain('0 / 500');
    expect(empty).toContain('Required.');
  });

  it('the Undo line shows the seconds left', () => {
    const html = renderToStaticMarkup(createElement(UndoStrip, { text: 'Question 4 sent to the AI.', left: 7, busy: false, onUndo: () => {} }));
    expect(html).toContain('Question 4 sent to the AI.');
    expect(html).toContain('Undo (7s)');
  });
});

describe('the words', () => {
  it('a whole-paper confirm says how many questions go', () => {
    const c = { needs_you: 3, other: 2, skipped: 1 };
    expect(paperSendCount(c, false)).toBe(3);
    expect(paperSendCount(c, true)).toBe(5);
    const a = paperSendConfirm(c, false);
    expect(a.title).toBe('Send 3 questions to the AI?');
    expect(a.confirmLabel).toBe('Send 3 to the AI');
    expect(a.description).toContain('3 questions go to the AI');
    expect(a.description).toContain('1 already in the AI flow stays as it is');
    expect(a.description).toContain('undo');
    const b = paperSendConfirm(c, true);
    expect(b.title).toBe('Send 5 questions to the AI?');
    expect(b.description).toContain('2 of them are with the student checkers');
    expect(paperSendConfirm({ needs_you: 1, other: 0, skipped: 0 }, false).title).toBe('Send 1 question to the AI?');
  });

  it('the send-back confirm says how many go back and that nothing is handed out by itself', () => {
    const w = sendBackConfirm(12);
    expect(w.description).toContain('12 passed questions go back to the student checkers');
    expect(w.description).toContain('Auto assign all');
    expect(sendBackConfirm(1).description).toContain('1 passed question goes back');
  });

  it('the lines after a send', () => {
    expect(paperSentLine(5, 0)).toBe('5 questions sent to the AI.');
    expect(paperSentLine(1, 0)).toBe('1 question sent to the AI.');
    expect(paperSentLine(5, 2)).toContain('2 were taken from the student checkers');
    expect(sendToAiBadgeLabel(1)).toContain('1 question waiting');
    expect(sendToAiBadgeLabel(4)).toContain('4 questions waiting');
  });

  it('a database without the new file gets a plain "not switched on" sentence, never a raw error', () => {
    const missing = { code: 'PGRST202', message: 'Could not find the function public.hod_send_to_ai(p_question_id, p_reason) in the schema cache' };
    expect(sendFailureWords(missing)).toBe(SEND_TO_AI_NOT_ON_WORDS);
    expect(sendFailureWords(missing, SEND_BACK_NOT_ON_WORDS)).toBe(SEND_BACK_NOT_ON_WORDS);
    expect(sendFailureWords({ code: '55000', message: 'This question is already waiting for the AI.' })).toBe('This question is already waiting for the AI.');
    expect(sendFailureWords({ code: '42501', message: 'Only HODs and admins can use this.' })).toMatch(/not set up for the HOD desk/);
  });

  it('counts come back as plain numbers', () => {
    expect(normalisePaperAiCounts({ needs_you: 2, other: '3', skipped: null })).toEqual({ needs_you: 2, other: 3, skipped: 0 });
    expect(normalisePaperAiCounts(null)).toEqual({ needs_you: 0, other: 0, skipped: 0 });
  });

  it('the Send to AI button shows only on a card that is not in the AI flow and not on the live site', () => {
    expect(canSendToAi({ live_bank_question_id: null, ai_redo_state: null })).toBe(true);
    expect(canSendToAi({ live_bank_question_id: null, ai_redo_state: 'redone' })).toBe(true);
    expect(canSendToAi({ live_bank_question_id: null, ai_redo_state: 'requested' })).toBe(false);
    expect(canSendToAi({ live_bank_question_id: null, ai_redo_state: 'approved' })).toBe(false);
    expect(canSendToAi({ live_bank_question_id: 'MQ-1', ai_redo_state: null })).toBe(false);
  });
});

describe('the calls', () => {
  beforeEach(() => rpc.mockReset());

  it('send, undo, paper send, paper undo, count and send back call the right functions with the right arguments', async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === 'hod_send_paper_to_ai') return Promise.resolve({ data: { request_id: 'req1', sent: 4, moved_from_students: 1 }, error: null });
      if (fn === 'hod_paper_ai_counts') return Promise.resolve({ data: { needs_you: 4, other: 1, skipped: 0 }, error: null });
      if (fn === 'hod_ai_redo_count') return Promise.resolve({ data: 7, error: null });
      if (fn === 'hod_send_paper_back_to_checking') return Promise.resolve({ data: { paper_id: 'p1', reopened: 9 }, error: null });
      return Promise.resolve({ data: { ok: true }, error: null });
    });
    await realHodApi.sendToAi('q1', '  The table is missing  ');
    expect(rpc).toHaveBeenLastCalledWith('hod_send_to_ai', { p_question_id: 'q1', p_reason: 'The table is missing' });
    await realHodApi.undoSendToAi('q1');
    expect(rpc).toHaveBeenLastCalledWith('hod_undo_send_to_ai', { p_question_id: 'q1' });
    expect(await realHodApi.sendPaperToAi('p1', 'Every table is broken', true)).toEqual({ request_id: 'req1', sent: 4, moved_from_students: 1 });
    expect(rpc).toHaveBeenLastCalledWith('hod_send_paper_to_ai', { p_audit_paper_id: 'p1', p_reason: 'Every table is broken', p_include_other: true });
    await realHodApi.undoSendPaperToAi('req1');
    expect(rpc).toHaveBeenLastCalledWith('hod_undo_send_paper_to_ai', { p_request_id: 'req1' });
    expect(await realHodApi.paperAiCounts('p1')).toEqual({ needs_you: 4, other: 1, skipped: 0 });
    expect(await realHodApi.aiRedoCount()).toBe(7);
    expect(await realHodApi.sendPaperBackToChecking('p1', 'Pictures are on the wrong questions')).toBe(9);
    expect(rpc).toHaveBeenLastCalledWith('hod_send_paper_back_to_checking', { p_audit_paper_id: 'p1', p_reason: 'Pictures are on the wrong questions' });
  });

  it('before the paste: the numbers say "not there yet" instead of failing, and the actions throw the missing-function error', async () => {
    const missing = { code: 'PGRST202', message: 'Could not find the function public.x in the schema cache' };
    rpc.mockResolvedValue({ data: null, error: missing });
    expect(await realHodApi.paperAiCounts('p1')).toBeNull();
    expect(await realHodApi.aiRedoCount()).toBeNull();
    await expect(realHodApi.sendToAi('q1', 'something wrong')).rejects.toMatchObject({ code: 'PGRST202' });
    await expect(realHodApi.sendPaperBackToChecking('p1', 'something wrong')).rejects.toMatchObject({ code: 'PGRST202' });
  });

  it('a real failure of the count is thrown, not hidden as "not there yet"', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'nope' } });
    await expect(realHodApi.paperAiCounts('p1')).rejects.toMatchObject({ code: '42501' });
  });

  it('sending to the AI refreshes the Needs you list, the Send to AI list and its number', () => {
    const plan = hodRefreshPlan('t', 'send-to-ai');
    const keys = plan.now.map((k) => String(k[2]));
    expect(keys).toEqual(expect.arrayContaining(['needs-you', 'ai-redo', 'ai-redo-count']));
    expect(hodRefreshPlan('t', 'ai-redo').now.map((k) => String(k[2]))).toContain('ai-redo-count');
    const back = hodRefreshPlan('t', 'send-back-checking');
    expect(back.now.map((k) => String(k[2]))).toEqual(expect.arrayContaining(['ready', 'counts']));
    expect(back.later.map((k) => String(k[2]))).toContain('unassigned');
  });
});

describe('the demo desk follows the same rules', () => {
  const make = () => createGoLiveFake(() => undefined, (id) => id);

  it('sends one question, shows it as needs AI review from an HOD, and Undo puts it back', async () => {
    const fake = make();
    // One student request on the Physics paper is already waiting for the HOD's yes or no.
    const baseline = (await fake.api.aiRedoCount()) ?? 0;
    expect(baseline).toBe(1);
    const qs = await fake.api.needsYouQuestions(GL.maths);
    const q = qs.find((x) => x.review_bucket === 'admin')!;
    expect(q.ai_redo_state).toBeNull();
    await fake.api.sendToAi(q.id, 'The table is missing its rows');
    const after = (await fake.api.needsYouQuestions(GL.maths)).find((x) => x.id === q.id)!;
    expect(after.ai_redo_state).toBe('approved');
    expect(after.ai_redo_by_hod).toBe(true);
    expect(after.ai_redo_reason).toBe('The table is missing its rows');
    expect(await fake.api.aiRedoCount()).toBe(baseline + 1);
    const list = await fake.api.aiRedoList();
    expect(list.find((x) => x.id === q.id)).toMatchObject({ state: 'approved', asked_by_hod: true, reason: 'The table is missing its rows' });
    await expect(fake.api.sendToAi(q.id, 'again please')).rejects.toThrow(/already waiting for the AI/);

    await fake.api.undoSendToAi(q.id);
    const undone = (await fake.api.needsYouQuestions(GL.maths)).find((x) => x.id === q.id)!;
    expect(undone.ai_redo_state).toBeNull();
    expect(undone.ai_redo_by_hod).toBe(false);
    expect(await fake.api.aiRedoCount()).toBe(baseline);
    await expect(fake.api.undoSendToAi(q.id)).rejects.toThrow(/nothing of yours to undo/);
  });

  it('refuses a short reason, a long reason and a question a student already asked about', async () => {
    const fake = make();
    const [q] = await fake.api.needsYouQuestions(GL.maths);
    await expect(fake.api.sendToAi(q.id, 'no')).rejects.toThrow(/at least 5/);
    await expect(fake.api.sendToAi(q.id, 'x'.repeat(501))).rejects.toThrow(/too long/);
    const asked = (await fake.api.needsYouQuestions(GL.physics)).find((x) => x.ai_redo_state === 'requested')!;
    await expect(fake.api.sendToAi(asked.id, 'something is wrong')).rejects.toThrow(/student already asked/);
  });

  it('a whole-paper send takes the questions waiting on the HOD by default, with one reason, and Undo takes them all back', async () => {
    const fake = make();
    const before = await fake.api.paperAiCounts(GL.maths);
    expect(before).toEqual({ needs_you: 2, other: 0, skipped: 0 });
    const out = await fake.api.sendPaperToAi(GL.maths, 'Every table lost its rows', false);
    expect(out.sent).toBe(2);
    expect(out.moved_from_students).toBe(0);
    const qs = await fake.api.needsYouQuestions(GL.maths);
    expect(qs.every((x) => x.ai_redo_state === 'approved' && x.ai_redo_by_hod)).toBe(true);
    expect(qs.every((x) => (x.ai_redo_reason ?? '').startsWith('The HOD says this problem runs through the whole paper: Every table lost its rows'))).toBe(true);
    expect(await fake.api.aiRedoCount()).toBe(3);
    // Nothing left to send now.
    await expect(fake.api.sendPaperToAi(GL.maths, 'Every table lost its rows', false)).rejects.toThrow(/no question on this paper/);

    await fake.api.undoSendPaperToAi(out.request_id);
    const back = await fake.api.needsYouQuestions(GL.maths);
    expect(back.every((x) => x.ai_redo_state === null)).toBe(true);
    expect(await fake.api.aiRedoCount()).toBe(1);
  });

  it('with the box ticked, the paper other open questions (still with the students) come to the HOD and go too; Undo sends them back to the students', async () => {
    const fake = make();
    const counts = await fake.api.paperAiCounts(GL.commerce);
    expect(counts).toEqual({ needs_you: 0, other: 1, skipped: 0 });
    // Not ticked: nothing to send.
    await expect(fake.api.sendPaperToAi(GL.commerce, 'Numbering is wrong', false)).rejects.toThrow(/no question on this paper/);
    const out = await fake.api.sendPaperToAi(GL.commerce, 'Numbering is wrong', true);
    expect(out).toMatchObject({ sent: 1, moved_from_students: 1 });
    expect((await fake.api.needsYouQuestions(GL.commerce)).length).toBe(1);
    await fake.api.undoSendPaperToAi(out.request_id);
    expect((await fake.api.needsYouQuestions(GL.commerce)).length).toBe(0);
  });

  it('skips questions already in the AI flow and says so', async () => {
    const fake = make();
    const c = await fake.api.paperAiCounts(GL.physics);
    expect(c).toEqual({ needs_you: 0, other: 0, skipped: 1 });
  });

  it('Send back to checking: the paper leaves Ready, its passed questions go back to the students, nothing is handed out', async () => {
    const fake = make();
    const ready = await fake.api.readyPapers();
    expect(ready.map((p) => p.audit_paper_id)).toContain(GL.chem);
    const passed = ready.find((p) => p.audit_paper_id === GL.chem)!.passed_count;
    await expect(fake.api.sendPaperBackToChecking(GL.chem, 'no')).rejects.toThrow(/at least 5/);
    const n = await fake.api.sendPaperBackToChecking(GL.chem, 'The pictures sit on the wrong questions');
    expect(n).toBe(passed);
    expect((await fake.api.readyPapers()).map((p) => p.audit_paper_id)).not.toContain(GL.chem);
    const trail = (await fake.api.paperTrail()).find((t) => t.audit_paper_id === GL.chem)!;
    expect(trail.stage).toBe('checking');
    await expect(fake.api.sendPaperBackToChecking(GL.chem, 'The pictures sit on the wrong questions')).rejects.toThrow(/not on the Ready list/);
  });
});

describe('the screens', () => {
  const needs = read('src/components/hod/NeedsYouTab.tsx');
  const ready = read('src/components/hod/ReadyTab.tsx');
  const flow = read('src/components/hod/PublishFlow.tsx');
  const hod = read('src/pages/Hod.tsx');

  it('Needs you has Send to AI on each card, with the reason box, and Undo after', () => {
    expect(needs).toContain('Send to AI');
    expect(needs).toContain('api.sendToAi(q.id, aiReason)');
    expect(needs).toContain('api.undoSendToAi(q.id)');
    expect(needs).toContain('<UndoStrip');
    expect(needs).toContain('canSendToAi(q)');
    expect(needs).toContain('reasonProblem(aiReason) !== null');
    expect(needs).toContain('<SendPaperToAi api={api} scope={scope} paperId={paperId} />');
  });

  it('Ready has Send back to checking on each row and in the paper preview, never on a live paper', () => {
    expect(ready).toContain('<SendBackToChecking');
    expect(ready).toContain("p.kind === 'retro' ? null");
    expect(flow).toContain('<SendBackToChecking');
    expect(flow).toContain('waiting && !alreadyLive');
  });

  it('the Send to AI tab has a count on its tab and a count in its heading', () => {
    expect(hod).toContain("api.aiRedoCount()");
    expect(hod).toContain("t.key === 'send-to-ai' ? aiWaiting : badge");
    expect(hod).toContain('sendToAiBadgeLabel(aiWaiting)');
    expect(read('src/components/hod/SendToAiTab.tsx')).toContain('data-testid="ai-redo-count"');
  });

  it('the new pieces draw closed, with the right button words', () => {
    const api = {} as unknown as HodApi;
    const qc = new QueryClient();
    const wrap = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(QueryClientProvider, { client: qc }, createElement(MemoryRouter, null, el)));
    const paper = wrap(createElement(SendPaperToAi, { api, scope: 't', paperId: 'p1' }));
    expect(paper).toContain('Send whole paper to AI');
    expect(paper).not.toContain('send-paper-panel');
    const back = wrap(createElement(SendBackToChecking, { api, scope: 't', paperId: 'p1', title: 'Beccon X Maths', passedCount: 12 }));
    expect(back).toContain('Send back to checking');
    expect(back).not.toContain('send-back-panel');
  });

  it('a question an HOD sent says so, on the card and on the Send to AI tab', () => {
    const card = normaliseNeedsQuestion({
      id: 'q1', paper_id: 'p', ord: 1, kind: 'question', body: '[table not readable]', review_bucket: 'admin',
      ai_redo_state: 'approved', ai_redo_reason: 'Table is missing', ai_redo_by_hod: true,
    });
    expect(card.ai_redo_by_hod).toBe(true);
    expect(whyItNeedsYou(card)).toBe('An HOD sent this to the AI to be read again: Table is missing');
    // Before the paste the key is not there: the old words.
    const old = normaliseNeedsQuestion({ id: 'q2', paper_id: 'p', ord: 1, kind: 'question', body: 'x', review_bucket: 'escalated', ai_redo_state: 'approved', ai_redo_reason: 'Cut off' });
    expect(old.ai_redo_by_hod).toBe(false);
    expect(whyItNeedsYou(old)).toContain('Marked "needs AI review"');

    const items: HodAiRedoItem[] = normaliseAiRedoList([
      {
        id: 'q1', paper_id: 'p', paper_title: 'Beccon X Maths', ord: 1, body: '[table not readable]', ai_redo_state: 'approved', ai_redo_reason: 'Table is missing',
        asked_by_name: 'Meena', asked_by_hod: true, asked_at: '2026-11-27T08:00:00Z', trail: [{ at: '2026-11-27T08:00:00Z', action: 'hod_send_to_ai', who: 'Meena', note: 'Table is missing' }],
      },
    ]);
    expect(items[0].asked_by_hod).toBe(true);
    const qc = new QueryClient();
    qc.setQueryData(AI_REDO_KEY('t'), items);
    const html = renderToStaticMarkup(
      createElement(QueryClientProvider, { client: qc }, createElement(MemoryRouter, null, createElement(SendToAiTab, { api: { aiRedoList: async () => items } as unknown as HodApi, scope: 't' }))),
    );
    expect(html).toContain('An HOD said: Table is missing');
    expect(html).toContain('1 question is waiting');
    expect(html).not.toContain('Yes, it needs AI review');
    expect(aiRedoStepWords('hod_send_to_ai')).toBe('An HOD sent it to the AI');
  });
});

describe('Given by <first name> on a checker paper', () => {
  beforeEach(() => {
    rpc.mockReset();
    resetPapersExtra();
    resetGivenBy();
  });

  it('says the first name, or "an HOD" when there is none, or the old words when the server does not say', () => {
    expect(givenByLabel({ given_by_hod: false })).toBeNull();
    expect(givenByLabel({ given_by_hod: true, given_by_name: 'Meena' })).toBe('Given by Meena');
    expect(givenByLabel({ given_by_hod: true, given_by_name: null })).toBe('Given by an HOD');
    expect(givenByLabel({ given_by_hod: true, given_by_name: '  ' })).toBe('Given by an HOD');
    expect(givenByLabel({ given_by_hod: true })).toBe(GIVEN_BY_HOD);
    expect(GIVEN_BY_HOD).toBe('Given by your HOD');
  });

  it('keeps only the first name, even if the server sent more', () => {
    const m = normaliseGivenBy([
      { assignment_id: 3, first_name: 'Meena Roy' },
      { assignment_id: 4, first_name: null },
      { assignment_id: 'x', first_name: 'Nobody' },
    ]);
    expect(m.get(3)).toBe('Meena');
    expect(m.get(4)).toBeNull();
    expect(m.size).toBe(2);
    const rows = withGivenBy(normaliseMyPapers([{ paper_id: 'p1', assignment_id: 3, given_by_hod: true }, { paper_id: 'p2', assignment_id: 9, given_by_hod: true }]), m);
    expect(rows[0].given_by_name).toBe('Meena');
    expect(rows[1].given_by_name).toBeUndefined();
  });

  it('the list carries the name when the database file is pasted', async () => {
    rpc.mockImplementation((fn: string) =>
      Promise.resolve(
        fn === 'verifier_my_papers'
          ? { data: [{ paper_id: 'p1', assignment_id: 5, given_by_hod: true, remaining: 2 }], error: null }
          : fn === 'verifier_my_papers_given_by'
            ? { data: [{ assignment_id: 5, first_name: 'Meena' }], error: null }
            : { data: [], error: null },
      ),
    );
    const [p] = await verifierMyPapers();
    expect(givenByLabel(p)).toBe('Given by Meena');
  });

  it('before the paste the list still loads with the old wording, and the missing function is asked about once', async () => {
    rpc.mockImplementation((fn: string) =>
      Promise.resolve(
        fn === 'verifier_my_papers'
          ? { data: [{ paper_id: 'p1', assignment_id: 5, given_by_hod: true, remaining: 2 }], error: null }
          : fn === 'verifier_my_papers_given_by'
            ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.verifier_my_papers_given_by' } }
            : { data: [], error: null },
      ),
    );
    const [p] = await verifierMyPapers();
    expect(givenByLabel(p)).toBe('Given by your HOD');
    await verifierMyPapers();
    expect(rpc.mock.calls.filter((c) => c[0] === 'verifier_my_papers_given_by')).toHaveLength(1);
  });

  it('a failing name read never fails the list', async () => {
    rpc.mockImplementation((fn: string) =>
      fn === 'verifier_my_papers_given_by'
        ? Promise.reject(new Error('Failed to fetch'))
        : Promise.resolve({ data: fn === 'verifier_my_papers' ? [{ paper_id: 'p1', assignment_id: 5, given_by_hod: true }] : [], error: null }),
    );
    const [p] = await verifierMyPapers();
    expect(givenByLabel(p)).toBe('Given by your HOD');
  });

  it('the checker list draws the label from the paper', () => {
    const src = read('src/pages/Checker.tsx');
    expect(src).toContain('givenByLabel(p)');
    expect(src).not.toContain('{GIVEN_BY_HOD}');
  });
});

describe('guardians can edit their profile (audit B7)', () => {
  it('the form needs a name and a class; a phone is optional but exactly ten digits', () => {
    expect(guardianProblems(EMPTY_GUARDIAN_FORM)).toEqual({ full_name: 'Enter your name', student_grade: "Select your child's class" });
    expect(guardianProblems({ full_name: 'Rina Das', phone: '', student_grade: '9' })).toEqual({});
    expect(guardianProblems({ full_name: 'Rina Das', phone: '12345', student_grade: '9' }).phone).toMatch(/10 digits/);
    expect(guardianProblems({ full_name: 'x'.repeat(81), phone: '', student_grade: '9' }).full_name).toMatch(/80/);
  });

  it('writes the guardian columns and no student column', () => {
    const u = guardianProfileUpdate({ full_name: ' Rina Das ', phone: '', student_grade: '9' }, '2026-11-27T10:00:00Z');
    expect(u).toEqual({ full_name: 'Rina Das', phone: null, student_grade: '9', updated_at: '2026-11-27T10:00:00Z' });
    for (const studentColumn of ['grade', 'school_college', 'date_of_birth', 'school_board', 'guardian_email', 'address']) {
      expect(Object.keys(u)).not.toContain(studentColumn);
    }
    expect(guardianFormFromRow({ full_name: null, phone: null, student_grade: '10' })).toEqual({ full_name: '', phone: '', student_grade: '10' });
    expect(GRADE_OPTIONS).toContain('10');
  });

  function fakeClient(existingSubjects: string[], failOn?: string) {
    const calls: string[] = [];
    const client = {
      from: (table: string) => ({
        update: (v: Record<string, unknown>) => {
          calls.push(`update ${table} ${Object.keys(v).sort().join(',')}`);
          return { eq: async () => ({ error: failOn === 'update' ? { message: 'x' } : null }) };
        },
        select: () => ({
          eq: async (col: string) => {
            calls.push(`select ${table} by ${col}`);
            return { data: existingSubjects.map((subject_id) => ({ subject_id })), error: null };
          },
        }),
        insert: async (rows: unknown[]) => {
          calls.push(`insert ${table} ${JSON.stringify(rows)}`);
          return { error: failOn === 'insert' ? { message: 'x' } : null };
        },
        delete: () => ({
          eq: () => ({
            in: async (_c: string, ids: string[]) => {
              calls.push(`delete ${table} ${ids.join(',')}`);
              return { error: null };
            },
          }),
        }),
      }),
      auth: {
        updateUser: async (v: unknown) => {
          calls.push(`updateUser ${JSON.stringify(v)}`);
          return { error: failOn === 'auth' ? { message: 'x' } : null };
        },
      },
    };
    return { client: client as unknown as Parameters<typeof saveGuardianProfile>[0], calls };
  }

  it("saves the child's class in student_grade and the subjects in guardian_student_subjects, adding before removing", async () => {
    const { client, calls } = fakeClient(['s1', 's2']);
    const out = await saveGuardianProfile(client, 'u1', { full_name: 'Rina Das', phone: '9876543210', student_grade: '9' }, ['s2', 's3'], { nameChanged: true, nowIso: 'T' });
    expect(out.nameSyncFailed).toBe(false);
    expect(calls[0]).toBe('update profiles full_name,phone,student_grade,updated_at');
    expect(calls).toContain('select guardian_student_subjects by guardian_id');
    const add = calls.findIndex((c) => c.startsWith('insert guardian_student_subjects'));
    const remove = calls.findIndex((c) => c.startsWith('delete guardian_student_subjects'));
    expect(add).toBeGreaterThan(-1);
    expect(remove).toBeGreaterThan(add);
    expect(calls[add]).toContain('"guardian_id":"u1","subject_id":"s3"');
    expect(calls[remove]).toBe('delete guardian_student_subjects s1');
    expect(calls.some((c) => c.includes('student_subjects') && !c.includes('guardian_student_subjects'))).toBe(false);
    expect(calls.at(-1)).toContain('updateUser {"data":{"full_name":"Rina Das"}}');
  });

  it('leaves the sign-in name alone when it did not change, and reports (not throws) when that part fails', async () => {
    const a = fakeClient([]);
    await saveGuardianProfile(a.client, 'u1', { full_name: 'Rina', phone: '', student_grade: '9' }, [], { nameChanged: false });
    expect(a.calls.some((c) => c.startsWith('updateUser'))).toBe(false);
    const b = fakeClient([], 'auth');
    expect((await saveGuardianProfile(b.client, 'u1', { full_name: 'Rina', phone: '', student_grade: '9' }, [], { nameChanged: true })).nameSyncFailed).toBe(true);
  });

  it('throws when the profile or the subjects cannot be saved, so the screen says it failed', async () => {
    await expect(saveGuardianProfile(fakeClient([], 'update').client, 'u1', { full_name: 'R', phone: '', student_grade: '9' }, [])).rejects.toBeTruthy();
    await expect(saveGuardianProfile(fakeClient([], 'insert').client, 'u1', { full_name: 'R', phone: '', student_grade: '9' }, ['s1'])).rejects.toBeTruthy();
  });

  it('the Account page offers Edit profile to guardians and opens the guardian sheet for them', () => {
    const src = read('src/pages/Account.tsx');
    expect(src).toContain("(profile?.role === 'student' || profile?.role === 'guardian')");
    expect(src).toContain('<GuardianProfileSheet userId={user.id}');
    expect(src).toContain("profile?.role !== 'guardian'");
    const sheet = read('src/components/account/GuardianProfileSheet.tsx');
    expect(sheet).toContain("from('guardian_student_subjects')");
    expect(sheet).toContain('student_grade');
    expect(sheet).not.toContain("from('student_subjects')");
  });
});
