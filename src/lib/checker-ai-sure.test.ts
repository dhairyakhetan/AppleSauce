import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createFakeCheckerApi } from '@/dummy/checker-fake-api';

/* 20261019110000_checker_question_ai_sure.sql cannot run in CI, so its load-bearing lines are pinned here.

   Rehearsed 19 October 2026 in a rolled-back transaction against the live database: a question with a stored
   score of 0.70 gave 70, one with no score gave null, 0.925 gave 93; a verifier who is not an admin and does not hold
   the lease was refused 42501 ("not currently assigned to you"); anon was refused 42501; has_function_privilege gave
   anon false, authenticated true, public false; provolatile = 's'. Admins pass through checker_authorize_question's
   existing admin allowance, exactly as they do for checker_question_context. */

const sql = readFileSync('supabase/migrations/20261019110000_checker_question_ai_sure.sql', 'utf8')
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('checker_question_ai_sure migration', () => {
  it('is a STABLE security definer function with a pinned search path', () => {
    expect(sql).toContain('create or replace function public.checker_question_ai_sure(p_question_id uuid)');
    expect(sql).toMatch(/\bstable\b/);
    expect(sql).toContain('security definer');
    expect(sql).toContain('set search_path = public, pg_temp');
  });

  it('is gated like the question context: the caller must hold the lease of that exact question', () => {
    expect(sql).toContain('public.checker_authorize_question(p_question_id)');
  });

  it('returns a whole percent and nothing else: no label, decision, model or check rows', () => {
    expect(sql).toContain('returns integer');
    expect(sql).toContain('round(v_q.ai_confidence_score * 100)');
    expect(sql).not.toMatch(/ai_confidence\b(?!_score)/);
    expect(sql).not.toContain('ai_decision');
    expect(sql).not.toContain('content_checks');
  });

  it('writes nothing', () => {
    expect(sql).not.toMatch(/\b(update|insert|delete)\b/i);
  });

  it('is closed to public, anon AND authenticated, then granted to authenticated only', () => {
    expect(sql).toContain('revoke all on function public.checker_question_ai_sure(uuid) from public, anon, authenticated;');
    expect(sql).toContain('grant execute on function public.checker_question_ai_sure(uuid) to authenticated;');
    expect(sql).not.toMatch(/grant execute[^;]*\bto (anon|public)\b/);
  });
});

describe('questionAiSure in the fake (dummy mode)', () => {
  it('gives example percentages for some questions and null for the rest, always 0 to 100', async () => {
    const api = createFakeCheckerApi();
    const [paper] = await api.myPapers();
    const rows = await api.paperQuestions(paper.paper_id);
    const values = await Promise.all(rows.map((r) => api.questionAiSure(r.id)));
    const numbers = values.filter((v): v is number => v != null);
    expect(numbers.length).toBeGreaterThan(0);
    expect(values.some((v) => v == null)).toBe(true);
    for (const n of numbers) {
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(100);
    }
  });
});
