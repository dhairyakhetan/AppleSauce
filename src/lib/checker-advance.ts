/**
 * The rules for "one call saves the verdict AND brings the next question"
 * (verifier_verdict_and_next, 12 Oct 2026), as plain functions so they are
 * tested without a browser.
 *
 *  1. `decideAck`: a verdict has been taken and the server handed back the next
 *     question (or none). Show it, say the paper is finished, ignore it because
 *     the person has moved on, or ask for it the old way.
 *  2. `verdictWasSaved`: a REPLAY (a retry after a failed send) came back
 *     "stale" or "not assigned to you". That can mean the first send did reach
 *     the server and only the answer was lost. It is treated as saved only when
 *     a read of the question shows exactly what this verdict would have left.
 *  3. `nextForScreen`: the next question as the screen holds it, with the paper
 *     it belongs to filled in from `next_paper_id` when the row has none.
 *
 * Question text is never touched here: `next` is passed through as it came.
 */

import type { NextQuestionWithContext, VerdictAndNext } from '@/lib/checker-verdict-next';
import type { VerdictKind, VerdictPayload } from '@/lib/checker-outbox';
import type { PaperQuestion } from '@/lib/verifier-papers';

export type AckDecision =
  /** Put this question on screen (its context comes with it, no second fetch). */
  | { kind: 'show'; next: NextQuestionWithContext }
  /** Nothing is left on this paper: the "paper finished" screen. */
  | { kind: 'end' }
  /** The person has moved on (another paper, or a question is already open): do nothing with the answer. */
  | { kind: 'ignore' }
  /** The answer carried no next question (an older entry): ask the server the old way. */
  | { kind: 'fetch' };

export interface AckContext {
  /** The verdict the server took. */
  entry: { questionId: string; paperId: string };
  /** What the call returned; absent when the entry was acknowledged without one. */
  result: VerdictAndNext | null | undefined;
  /** The paper the screen is on right now. */
  screenPaperId: string;
  /** The question open on screen right now (not hidden, not answered), or null while waiting for one. */
  openQuestionId: string | null;
  /** Question ids that already have a verdict hidden or waiting in the outbox. */
  answeredIds: ReadonlySet<string>;
  /** Verdicts of this paper still waiting, not counting the one just taken. */
  otherPendingHere: number;
}

/**
 * What to do with the answer to a verdict. The returned `next` is applied only
 * when the screen is still waiting for it:
 *
 *  - another paper is on screen            -> ignore
 *  - a question is already open            -> ignore (a late retry must never pull
 *                                              the person off the question they are on)
 *  - `next` is a question that already has
 *    a verdict waiting                     -> ignore (that verdict's own answer follows)
 *  - nothing next, but more verdicts of
 *    this paper are still on their way     -> ignore (the last one decides the end)
 */
export function decideAck(c: AckContext): AckDecision {
  if (c.entry.paperId !== c.screenPaperId) return { kind: 'ignore' };
  if (c.openQuestionId !== null) return { kind: 'ignore' };
  if (!c.result) return { kind: 'fetch' };
  const next = c.result.next;
  if (next) {
    if (c.answeredIds.has(next.id)) return { kind: 'ignore' };
    return { kind: 'show', next: nextForScreen(c.result)! };
  }
  if (c.otherPendingHere > 0) return { kind: 'ignore' };
  return { kind: 'end' };
}

/** The next question for the screen: the row as sent, with `paper_id` set from `next_paper_id`, which names the paper the row belongs to (the paper-change strip reads it). */
export function nextForScreen(result: VerdictAndNext): NextQuestionWithContext | null {
  const n = result.next;
  if (!n) return null;
  const paperId = result.next_paper_id || n.paper_id;
  return paperId === n.paper_id ? n : { ...n, paper_id: paperId };
}

type SavedRow = Pick<PaperQuestion, 'state' | 'version' | 'body' | 'display_number' | 'marks'>;

/**
 * Does this row show what the verdict would have left? Used only for a replay
 * that the server refused as stale or not assigned: the first send may have
 * landed. False when it cannot be told, and then the refusal is shown as it is.
 *
 *  - pass      done, still at the version the checker saw
 *  - fix       done, a newer version, and every field the fix changed has the fixed value
 *  - ask_help  with the HOD
 *  - skip      cannot be told from a read, so never confirmed
 */
export function verdictWasSaved(entry: { kind: VerdictKind; payload: VerdictPayload }, row: SavedRow | null | undefined): boolean {
  if (!row) return false;
  const p = entry.payload;
  switch (entry.kind) {
    case 'pass':
      return row.state === 'done' && typeof p.version === 'number' && row.version === p.version;
    case 'fix': {
      if (row.state !== 'done' || typeof p.version !== 'number' || !(row.version > p.version)) return false;
      const patch = p.patch ?? {};
      if (patch.body != null && row.body !== patch.body) return false;
      if (patch.display_number != null && row.display_number !== patch.display_number) return false;
      if (patch.marks != null && row.marks !== patch.marks) return false;
      return true;
    }
    case 'ask_help':
      return row.state === 'with_hod';
    case 'skip':
      return false;
  }
}

/** True for the two refusals a replay can get when the first send actually landed. */
export function mayHaveLanded(err: unknown): boolean {
  const e = (err && typeof err === 'object' ? err : {}) as { code?: unknown; message?: unknown; details?: unknown };
  const text = [e.message, e.details].filter((v) => typeof v === 'string').join(' ');
  return e.code === '40001' || /stale question|not currently assigned/i.test(text);
}

const CHECKED = '__savedCheck';

/** Marks a refusal after a read of the question showed the verdict was NOT saved, so the screen can say so plainly. */
export function markNotSaved<T>(err: T): T {
  if (err && typeof err === 'object') {
    try {
      Object.defineProperty(err, CHECKED, { value: 'not_saved', enumerable: false, configurable: true });
    } catch {
      /* a frozen error object: the screen then uses the cautious wording */
    }
  }
  return err;
}

/** True when a read of the question confirmed this refusal means nothing was saved. */
export function isConfirmedNotSaved(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as Record<string, unknown>)[CHECKED] === 'not_saved');
}
