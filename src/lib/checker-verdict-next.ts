/**
 * The pure half of "give the verdict and get the next question in ONE call"
 * (verifier_verdict_and_next / verifier_pass_and_next, 20261012970000).
 *
 * No network and no Supabase import here, so it is unit-tested on its own;
 * checker-api.ts wraps it around the RPC.
 *
 * Question text is never touched: `next.body`, `options`, `raw_ocr` and every
 * context row come through exactly as the server sent them.
 */

import type { ContextRow } from '@/lib/checker-context';
import type { CheckerQuestion } from '@/lib/checker-api';
import { checkerSaveRoute, TYPO_NEEDS_VERSION } from '@/lib/checker-save';

export type VerdictAction = 'pass' | 'fix' | 'skip' | 'ask_help';

export interface VerdictAndNextInput {
  action: VerdictAction;
  /** The question just answered. */
  questionId: string;
  /** The paper being checked; the next question is claimed from it. */
  paperId: string;
  /** The version the checker saw (CheckerQuestion.version). Required for pass and fix. */
  version?: number | null;
  /** fix: what to change. */
  patch?: { body?: string | null; display_number?: string | null; marks?: number | null };
  /** fix: the printed paper itself has a typo and the checker corrected it. */
  printedTypo?: boolean;
  typoNote?: string | null;
  /** ask_help: why. */
  reason?: string | null;
  /** Also serve the questions the checker skipped (the "go through skipped" mode). */
  includeSkipped?: boolean;
}

/** The next question exactly as verifier_next_in_paper returns it, plus its context rows. */
export type NextQuestionWithContext = CheckerQuestion & {
  /** checker_question_context rows for this question; [] when it is not part of a larger one. */
  context: ContextRow[];
};

export interface VerdictAndNext {
  verdict_ok: true;
  verdict: VerdictAction;
  /** The version a pass or fix ended on; null for skip and ask_help. */
  verdict_version: number | null;
  /** The next question of the same paper, already leased to the caller; null when none is left. */
  next: NextQuestionWithContext | null;
  /** The paper `next` belongs to; null when `next` is null. */
  next_paper_id: string | null;
}

const ACTIONS: readonly VerdictAction[] = ['pass', 'fix', 'skip', 'ask_help'];

/**
 * The RPC parameters for verifier_verdict_and_next. Throws (before any network
 * call) for the one combination the server cannot take: a printed-typo fix with
 * no version, the same refusal checkerFixQuestion gives.
 */
export function verdictAndNextArgs(input: VerdictAndNextInput): Record<string, unknown> {
  if (!ACTIONS.includes(input.action)) throw new Error(`Unknown verdict: ${String(input.action)}`);
  if (input.action === 'fix' && checkerSaveRoute(input.version, Boolean(input.printedTypo)) === 'refuse') {
    throw new Error(TYPO_NEEDS_VERSION);
  }
  return {
    p_action: input.action,
    p_question_id: input.questionId,
    p_paper_id: input.paperId,
    p_expected_version: input.version ?? null,
    p_body: input.patch?.body ?? null,
    p_display_number: input.patch?.display_number ?? null,
    p_marks: input.patch?.marks ?? null,
    p_printed_typo: Boolean(input.printedTypo),
    p_typo_note: input.typoNote?.trim() || null,
    p_reason: input.reason ?? null,
    p_include_skipped: Boolean(input.includeSkipped),
  };
}

/** Reads what the RPC returned. Throws when the server did not say the verdict was saved. */
export function normaliseVerdictAndNext(data: unknown): VerdictAndNext {
  const raw = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;
  if (!raw || typeof raw !== 'object' || raw.verdict_ok !== true) {
    throw new Error('The answer could not be confirmed. Try again.');
  }
  const nextRaw = raw.next;
  let next: NextQuestionWithContext | null = null;
  if (nextRaw && typeof nextRaw === 'object' && typeof (nextRaw as { id?: unknown }).id === 'string') {
    const n = nextRaw as CheckerQuestion & { context?: unknown };
    next = { ...n, context: Array.isArray(n.context) ? (n.context as ContextRow[]) : [] };
  }
  const version = raw.verdict_version;
  return {
    verdict_ok: true,
    verdict: raw.verdict as VerdictAction,
    verdict_version: typeof version === 'number' ? version : null,
    next,
    next_paper_id: next && typeof raw.next_paper_id === 'string' ? raw.next_paper_id : null,
  };
}
