/**
 * What the verify screen believes after an answer, as plain functions so the
 * rules are tested without a browser (nothing here touches React or Supabase).
 *
 *  1. Undo follows what the server took, not the buttons pressed. A refused
 *     verdict is taken off the list, and Undo stays off until a new answer is
 *     made, so it can never take back an answer the student did not just make.
 *     After a refresh the list is empty but the paper still shows how many are
 *     done, and the server allows Undo for 30 minutes, so that count lights it.
 *  2. Skipping the last open question. The papers list still says "skipped 0"
 *     until it is read again, so for that moment the screen must not say the
 *     paper is finished.
 *  3. Typed work that a refused verdict, or an answer from another tab, would
 *     otherwise take off the screen. It is shown again, for copying.
 *  4. Another tab of the same person answered the question this tab still shows.
 */

import type { VerdictKind, VerdictPayload } from '@/lib/checker-outbox';

/* ---------------------------------------------------------------- Undo */

export interface AnsweredEntry {
  questionId: string;
  kind: string;
}

export const recordAnswered = (list: readonly AnsweredEntry[], questionId: string, kind: string): AnsweredEntry[] => [
  ...list,
  { questionId, kind },
];

/** The refused (or otherwise not saved) answer for this question leaves the list. */
export const forgetAnswered = (list: readonly AnsweredEntry[], questionId: string): AnsweredEntry[] =>
  list.filter((a) => a.questionId !== questionId);

/**
 * Is Undo available? `held` is true after a refused verdict, until the next
 * answer. Otherwise: something answered in this visit, or a paper that already
 * has done questions (a refresh or Back empties the visit's list; the server
 * decides what can really be undone and says so in a plain sentence).
 */
export function canUndoNow(answered: readonly AnsweredEntry[], doneOnPaper: number | null | undefined, held: boolean): boolean {
  if (held) return false;
  // The server undoes the person's most recent step, and cannot undo a split, the OR separator or a send-back (audit
  // CK-08, 27 Nov 2026): while one of those is the last thing done, Undo is off instead of offering a button that refuses.
  if (lastStepCannotBeUndone(answered)) return false;
  return answered.length > 0 || (doneOnPaper ?? 0) > 0;
}

/** Steps verifier_undo_last cannot take back ("Splitting a question cannot be undone here" and the like). */
const NOT_UNDOABLE_KINDS: ReadonlySet<string> = new Set(['split', 'or_separator', 'ask_ai_redo']);

/** True when the newest answer of this visit is one the server cannot undo. */
export function lastStepCannotBeUndone(answered: readonly AnsweredEntry[]): boolean {
  const last = answered[answered.length - 1];
  return last !== undefined && NOT_UNDOABLE_KINDS.has(last.kind);
}

export const UNDO_TITLE_NONE = 'Nothing to undo yet';
export const UNDO_TITLE_HELD = 'Nothing of yours to undo right now. Your last answer was not saved.';
export const UNDO_TITLE_READY = 'Take back your last answer';

export const UNDO_TITLE_STEP = 'Your last step (a split, an OR, or sending a question back) cannot be taken back here. Ask your HOD if it was a mistake.';

export function undoTitle(can: boolean, held: boolean, stepBlocked = false): string {
  if (can) return UNDO_TITLE_READY;
  if (stepBlocked) return UNDO_TITLE_STEP;
  return held ? UNDO_TITLE_HELD : UNDO_TITLE_NONE;
}

/* ------------------------------------------------- Skipping the last one */

export interface SkippedLeftInput {
  /** The student is already going through the skipped ones. */
  includeSkipped: boolean;
  /** The papers list's own numbers for this paper. */
  skippedCount: number;
  remaining: number | null;
  /** When the last open question was just skipped and the server took it (ms), else null. */
  skippedLastAt: number | null;
  /** When the papers list was last read (ms), 0 if never. */
  listReadAt: number;
}

/**
 * Whether the "Done for now, you skipped N" screen is the true one.
 * show=false means nothing is known that contradicts "Paper finished".
 * count=null means "some, number not known yet": the list that says how many
 * has not been read since the skip, so no number is guessed.
 */
export function skippedLeftState(i: SkippedLeftInput): { show: boolean; count: number | null } {
  if (i.includeSkipped) return { show: false, count: null };
  if (i.skippedLastAt !== null) {
    const fresh = i.listReadAt > i.skippedLastAt && i.skippedCount > 0;
    return { show: true, count: fresh ? i.skippedCount : null };
  }
  if (i.skippedCount > 0 && i.remaining !== null && i.remaining <= i.skippedCount) {
    return { show: true, count: i.skippedCount };
  }
  return { show: false, count: null };
}

/** The line under "Done for now" when the number is not known yet. */
export const SKIPPED_SOME_NOTE = 'What is left on this paper is what you skipped. It stays here for later.';

/* ------------------------------------------------------ Typed work kept */

/** The words a refused fix carried, or null when it carried none (a marks-only fix, a pass, a skip). */
export function typedWordsOfVerdict(kind: VerdictKind, payload: VerdictPayload): string | null {
  if (kind !== 'fix') return null;
  const body = payload.patch?.body;
  return typeof body === 'string' && body.trim() !== '' ? body : null;
}

/** The words typed on the open question, or null when they are the stored ones (nothing to keep). */
export function typedWordsOnScreen(storedBody: string | null | undefined, draftBody: string): string | null {
  return draftBody.trim() !== '' && draftBody !== (storedBody ?? '') ? draftBody : null;
}

export const KEPT_WORDS_TITLE = 'What you typed was not saved';
export const KEPT_WORDS_NOTE =
  'That question was answered or taken while you were typing. Copy anything you still need, then carry on with the question on screen.';

/* ------------------------------------------- Answered in another tab */

/** The actions that mean "this question has left my hands" (the review log's names). A split keeps the question, so it is not here. */
const ANSWER_ACTIONS = new Set([
  'checker_pass',
  'checker_fix',
  'checker_printed_typo',
  'checker_ask_help',
  'checker_ask_ai_redo',
]);

/**
 * True when an activity event may mean the SAME person answered the question
 * this tab has open, from another tab or device. The broadcast cannot say which
 * tab, so this only says "go and look": the screen reads the paper's list
 * (answeredElsewhere) before it moves anyone.
 */
export function mayBeMyOtherTabAnswering(
  event: { action: string; questionId: string | null; actorUserId: string | null },
  openQuestionId: string | null | undefined,
  myUserId: string | null | undefined,
): boolean {
  return Boolean(
    openQuestionId &&
      myUserId &&
      event.questionId === openQuestionId &&
      event.actorUserId === myUserId &&
      ANSWER_ACTIONS.has(event.action),
  );
}

/** The paper's list shows the question as no longer open for me (done, or with the HOD). */
export function answeredElsewhere(row: { state: string } | null | undefined): boolean {
  return row?.state === 'done' || row?.state === 'with_hod';
}

export const ANSWERED_ELSEWHERE_NOTE = 'You already answered that question in another tab or on another device, so here is the next one.';
