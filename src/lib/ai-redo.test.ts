import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { createGoLiveFake, GL } from '@/dummy/hod-golive-fake';
import { verdictWasSaved } from '@/lib/checker-advance';
import { sendVerdict } from '@/lib/checker-outbox';
import { verdictAndNextArgs } from '@/lib/checker-verdict-next';
import { normaliseNeedsQuestion, whyItNeedsYou } from '@/lib/hod-publish';
import { papersAfterVerdict, type MyPaper } from '@/lib/verifier-papers';

/* "Send back to the AI" (owner, 18 Nov 2026): a student asks, an HOD says yes or no, and only a yes marks the
   question "needs AI review" with the reason kept. These tests pin the screens' side of it and, because the
   migration cannot run in CI (no database), the load-bearing lines of the SQL file too. */

const raw = readFileSync('supabase/migrations/20261118100000_ai_redo_requests.sql', 'utf8');
const sql = raw
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

function body(fn: string): string {
  const start = sql.indexOf(`create or replace function public.${fn}(`);
  expect(start).toBeGreaterThan(-1);
  const next = sql.indexOf('create or replace function', start + 10);
  return sql.slice(start, next === -1 ? sql.length : next);
}

describe('the student side: the verdict word', () => {
  it('ask_ai_redo is a verdict the one-call API accepts, and carries the reason', () => {
    const args = verdictAndNextArgs({ action: 'ask_ai_redo', questionId: 'q1', paperId: 'p1', reason: 'The sentence is cut off' });
    expect(args.p_action).toBe('ask_ai_redo');
    expect(args.p_reason).toBe('The sentence is cut off');
  });

  it('the offline queue sends the typed reason for ask_ai_redo and no reason for a pass', async () => {
    const verdictAndNext = vi.fn(async () => ({ verdict_ok: true as const, verdict: 'pass', verdict_version: null, next: null, next_paper_id: null }));
    const api = { verdictAndNext } as never;
    await sendVerdict(api, { questionId: 'q1', paperId: 'p1', kind: 'ask_ai_redo', payload: { reason: 'Marks are wrong' } });
    await sendVerdict(api, { questionId: 'q2', paperId: 'p1', kind: 'pass', payload: { version: 1 } });
    const calls = verdictAndNext.mock.calls as unknown as Array<[{ action: string; reason?: string }]>;
    expect(calls[0][0]).toMatchObject({ action: 'ask_ai_redo', reason: 'Marks are wrong' });
    expect(calls[1][0].reason).toBeUndefined();
  });

  it('a replayed ask_ai_redo counts as saved only when the question is with the HOD', () => {
    const entry = { kind: 'ask_ai_redo' as const, payload: {} };
    expect(verdictWasSaved(entry, { state: 'with_hod', version: 3 } as never)).toBe(true);
    expect(verdictWasSaved(entry, { state: 'to_verify', version: 3 } as never)).toBe(false);
  });

  it('the paper card counts it as handed to the HOD', () => {
    const rows = [{ paper_id: 'p1', remaining: 5, skipped: 0, with_hod: 0, done: 0, paper_passed: 0 }] as unknown as MyPaper[];
    const out = papersAfterVerdict(rows, 'p1', 'ask_ai_redo')!;
    expect(out[0].with_hod).toBe(1);
    expect(out[0].remaining).toBe(4);
    expect(out[0].done).toBe(0);
  });
});

describe('the HOD side: reading and wording', () => {
  const base = { id: 'q1', paper_id: 'p1', review_bucket: 'escalated', escalated_by_name: 'Asha', reason: 'old reason' };

  it('keeps a known AI redo state and drops anything else', () => {
    expect(normaliseNeedsQuestion({ ...base, ai_redo_state: 'requested', ai_redo_reason: 'Cut off' })!.ai_redo_state).toBe('requested');
    expect(normaliseNeedsQuestion({ ...base, ai_redo_state: 'approved' })!.ai_redo_state).toBe('approved');
    expect(normaliseNeedsQuestion({ ...base, ai_redo_state: 'nonsense' })!.ai_redo_state).toBeNull();
    expect(normaliseNeedsQuestion(base)!.ai_redo_state).toBeNull();
  });

  it('says in plain words what is being asked, and keeps the student reason', () => {
    const pick = { review_bucket: 'escalated' as const, escalated_by_name: 'Asha', reason: 'r', ai_review_reason: null };
    expect(whyItNeedsYou({ ...pick, ai_redo_state: 'requested', ai_redo_reason: 'Cut off' })).toBe('Asha wants the AI to read this question again: Cut off');
    expect(whyItNeedsYou({ ...pick, ai_redo_state: 'approved', ai_redo_reason: 'Cut off' })).toBe('Marked "needs AI review". Asha said: Cut off');
    expect(whyItNeedsYou({ ...pick, ai_redo_state: 'redone', ai_redo_reason: null })).toMatch(/read this question again/);
    expect(whyItNeedsYou({ ...pick, ai_redo_state: null, ai_redo_reason: null })).toBe('Asha asked you: r');
  });

  it('uses no em or en dashes in the new wording', () => {
    const pick = { review_bucket: 'escalated' as const, escalated_by_name: 'A', reason: 'r', ai_review_reason: null };
    for (const s of ['requested', 'approved', 'redone'] as const) {
      expect(whyItNeedsYou({ ...pick, ai_redo_state: s, ai_redo_reason: 'x' })).not.toMatch(/[–—]/);
    }
  });
});

describe('the demo HOD desk follows the same rules', () => {
  it('refuses a yes or no when nobody asked for an AI redo', async () => {
    const fake = createGoLiveFake(() => undefined, (id) => id);
    const [q] = await fake.api.needsYouQuestions(GL.maths);
    expect(q.review_bucket).toBe('escalated');
    expect(q.ai_redo_state).toBeNull();
    await expect(fake.api.aiRedoDecide(q.id, true, '')).rejects.toThrow(/No AI redo request/);
  });
});

describe('the screens', () => {
  const verify = readFileSync('src/components/checker/VerifyScreen.tsx', 'utf8');
  const needs = readFileSync('src/components/hod/NeedsYouTab.tsx', 'utf8');

  it('the student sheet has the button, needs a reason, and says the HOD decides first', () => {
    expect(verify).toContain('Send back to the AI');
    expect(verify).toContain("submitVerdict('ask_ai_redo'");
    expect(verify).toContain('MIN_AI_REDO_REASON = 5');
    expect(verify).toMatch(/If they agree, the AI will look at it again/);
  });

  it('the HOD card asks yes or no and calls the new function', () => {
    expect(needs).toContain('Yes, it needs AI review');
    expect(needs).toContain('No, keep it with me');
    expect(needs).toContain('api.aiRedoDecide(q.id, approve');
  });
});

describe('20261118100000_ai_redo_requests.sql', () => {
  it('adds the seven columns and a rule on the state word', () => {
    for (const c of ['ai_redo_state', 'ai_redo_reason', 'ai_redo_by', 'ai_redo_at', 'ai_redo_decided_by', 'ai_redo_decided_at', 'ai_redo_note']) {
      expect(sql).toMatch(new RegExp(`add column if not exists ${c}\\b`));
    }
    expect(sql).toMatch(/ai_redo_state in \('requested',\s*'approved',\s*'redone'\)/);
  });

  it('the student function uses the same lease check as Ask for help, needs a reason, and sends the question to the HOD', () => {
    const b = body('checker_ask_for_ai_redo');
    expect(b).toContain('checker_authorize_question(p_question_id)');
    expect(b).toMatch(/< 5/);
    expect(b).toContain("'escalated'");
    expect(b).toContain("ai_redo_state = 'requested'");
    expect(b).toContain("'checker_ask_ai_redo'");
  });

  it('only an HOD or admin can decide, a live Maths copy is refused, and only a waiting request can be decided', () => {
    const b = body('hod_ai_redo_decide');
    expect(b).toMatch(/not public\.is_hod\(\)/);
    expect(b).toContain("'42501'");
    expect(b).toContain('live_copy');
    expect(b).toContain("'55000'");
    expect(b).toMatch(/ai_redo_state is distinct from 'requested'|ai_redo_state <> 'requested'/);
    expect(b).toContain("'hod_ai_redo_approve'");
    expect(b).toContain("'hod_ai_redo_decline'");
  });

  it('a decision never touches the question words and never passes the question', () => {
    const b = body('hod_ai_redo_decide');
    expect(b).not.toMatch(/set[^;]*\bbody\s*=/i);
    expect(b).not.toMatch(/state\s*=\s*'(done|passed)'/);
  });

  it('Ask for help and Send back clear the mark, so an old mark never shows on a new request', () => {
    expect(body('checker_ask_for_help')).toMatch(/ai_redo_state\s*=\s*null/);
    expect(body('hod_send_back')).toMatch(/ai_redo_state\s*=\s*null/);
  });

  it('the one-call verdict function accepts the new action and routes it to the new function', () => {
    const b = body('verifier_verdict_and_next');
    expect(b).toContain("'ask_ai_redo'");
    expect(b).toMatch(/checker_ask_for_ai_redo\(p_question_id, p_reason\)/);
  });

  it('the HOD list returns the mark and finds the reason of the new kind of request', () => {
    const b = body('hod_needs_you_questions');
    expect(b).toMatch(/'ai_redo_state',\s*q\.ai_redo_state/);
    expect(b).toMatch(/'ai_redo_reason'/);
    expect(b).toContain("'checker_ask_ai_redo'");
  });

  it('every new or replaced function is closed to visitors by name and opened to signed-in people only', () => {
    for (const fn of ['checker_ask_for_ai_redo', 'hod_ai_redo_decide', 'checker_ask_for_help', 'hod_send_back', 'hod_needs_you_questions', 'verifier_verdict_and_next']) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\)\\s+from public, anon, authenticated;`));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s+to authenticated;`));
    }
    expect(sql).not.toMatch(/grant [^;]* to (anon|public)\b/);
  });

  it('adds the three plain-words history lines', () => {
    for (const a of ['checker_ask_ai_redo', 'hod_ai_redo_approve', 'hod_ai_redo_decline']) expect(sql).toContain(`'${a}'`);
  });
});
