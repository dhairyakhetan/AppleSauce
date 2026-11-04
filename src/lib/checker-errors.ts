/**
 * What a paper checker is told when a save fails, and whether the page
 * should move on to the next question.
 *
 * Every failure used to read "Could not save that. Check your internet and
 * try again." That was wrong for the commonest real failure: the question's
 * 10-minute lease ran out while a student read a long passage, the server
 * refused with 42501 "not currently assigned to you", and "try again" failed
 * the same way forever. Pure, so it is tested without a login.
 */

export interface CheckerErrorAdvice {
  message: string;
  /** Move on: this question can no longer be saved from this screen. */
  moveOn: boolean;
}

function parts(err: unknown): { code: string; text: string } {
  if (!err || typeof err !== 'object') return { code: '', text: String(err ?? '') };
  const e = err as { code?: unknown; message?: unknown; details?: unknown };
  return {
    code: typeof e.code === 'string' ? e.code : '',
    text: [e.message, e.details].filter((v) => typeof v === 'string').join(' '),
  };
}

export function checkerErrorAdvice(err: unknown): CheckerErrorAdvice {
  const { code, text } = parts(err);
  if (/not currently assigned/i.test(text) || /not routed to the paper checker/i.test(text)) {
    return {
      message: 'This question was open too long, or someone else took it, so it was not saved. Here is the next one, or this one again.',
      moveOn: true,
    };
  }
  if (/paper is not assigned to you/i.test(text)) {
    return {
      message: 'This paper is no longer assigned to you, so that answer was not saved. Ask your HOD to give it back, or pick another paper.',
      moveOn: true,
    };
  }
  // Every other refusal the server raises for a question (sent to the HOD,
  // question gone, paper not open for checking): retrying cannot change it, and
  // before this it was retried every 8 s while the screen sat on a skeleton.
  if (/sent to the HOD|question not found|not eligible for checking/i.test(text)) {
    return {
      message: 'This question can no longer be checked from your screen (it moved on), so it was not saved. Here is the next one.',
      moveOn: true,
    };
  }
  if (code === '40001' || /stale question text|unapplied split/i.test(text)) {
    return {
      // After a stale save the lease is still this checker's, so the server
      // usually hands back the SAME question as it is now; "the next one"
      // alone read as if the question had been lost.
      message:
        'Someone else changed this question while you had it open, so nothing was saved. Here it is as it is now, or the next one.',
      moveOn: true,
    };
  }
  if (/typo corrections are not switched on/i.test(text)) {
    return {
      message: 'Typo corrections are not switched on yet. Fix only reading mistakes for now, or press Ask the HOD.',
      moveOn: false,
    };
  }
  if (/printed typo fix must change the words/i.test(text)) {
    return { message: 'Change the words to correct the typo, or untick the typo box.', moveOn: false };
  }
  if (/has no words|empty question/i.test(text)) {
    return { message: "This question has no words, so it cannot be marked as right. Press Ask the HOD.", moveOn: false };
  }
  if (/split point out of range/i.test(text)) {
    return { message: 'Tap inside the words, between the two questions, then press Split here.', moveOn: false };
  }
  if (code === '42501' || /not authorized/i.test(text)) {
    return {
      message: 'Your account cannot check papers right now. Sign in again, or ask an admin.',
      moveOn: false,
    };
  }
  return { message: 'Could not save that. Check your internet and try again.', moveOn: false };
}

/** The message when the next question could not be fetched at all. Before,
 *  a failed fetch fell through to "All done for now", which told a checker
 *  the queue was empty when it was not. */
export const LOAD_FAILED_TITLE = 'Could not load the next question';
export const LOAD_FAILED_NOTE = 'Check your internet, then try again.';

export type NextLoadProblem = 'none' | 'paper_gone' | 'no_access' | 'failed';

/** What a failed read of the next question means for the screen. `held` is the
 *  last answer the screen has: undefined = none yet, null = "Paper finished".
 *
 *  A paper that closed behind the verifier (they finished it, or it went back
 *  to the pool) answers 42501 "This paper is not assigned to you". That is not
 *  a sign-in problem, and the live channel asks for the next question again on
 *  any activity, so right after the last answer of a paper the finished screen
 *  was replaced by "Sign in again" (Nov 2026). Once the screen already says the
 *  paper is finished, that refusal changes nothing. */
export function nextLoadProblem(err: unknown, held: unknown): NextLoadProblem {
  if (err === null || err === undefined) return 'none';
  const { code, text } = parts(err);
  if (/paper is not assigned to you/i.test(text)) return held === null ? 'none' : 'paper_gone';
  if (code === '42501' || /not authorized/i.test(text)) return 'no_access';
  return 'failed';
}

/** The paper is no longer on the verifier's list (finished or returned), so its next question cannot be read. */
export const PAPER_GONE_TITLE = 'This paper is no longer on your list';
export const PAPER_GONE_NOTE = 'You may have finished it, or it went back to the pool. You are still signed in. Pick another paper from your list.';

/** Shown after a successful Undo (verifier_undo_last). */
export const UNDONE_NOTE = 'Undone. Here is that question again.';

/**
 * What the verifier reads when Undo is refused or fails. The server's refusals
 * (errcode 22023) are already plain sentences ("Your last answer was more than
 * 30 minutes ago, ..."), so they are shown as they are; anything else gets a
 * generic line.
 */
export function undoErrorMessage(err: unknown): string {
  const { code, text } = parts(err);
  if (code === '22023' && text.trim() !== '') return text.trim();
  if (code === '42501' || /not authorized/i.test(text)) {
    return 'Your account cannot check papers right now. Sign in again, or ask an admin.';
  }
  return 'Could not undo that. Check your internet and try again.';
}

/**
 * What the verifier reads when "Ask your HOD for subjects" fails
 * (verifier_request_subjects). A subject the library has no papers in is refused
 * with errcode 22023 and a plain sentence ("No papers in X. Subjects with papers:
 * ..."), so it is shown as it is; before 2 November 2026 every failure read the
 * generic line and nobody could tell what to type instead.
 */
export function requestSubjectsErrorMessage(err: unknown): string {
  const { code, text } = parts(err);
  if (code === '22023' && text.trim() !== '') return text.trim();
  if (code === '42501' || /not authorized/i.test(text)) {
    return 'Your account cannot check papers right now. Sign in again, or ask an admin.';
  }
  return 'Could not send that. Try again in a moment.';
}

/**
 * The line shown when "Edit" on a Done question is refused (verifier_reopen_question).
 * Same shape as undoErrorMessage: a 22023 refusal is already a plain sentence
 * ("That question is with the HOD ...", "This paper has already gone for
 * approval ..."), so it is shown as it is.
 */
export function reopenErrorMessage(err: unknown): string {
  const { code, text } = parts(err);
  if (code === '22023' && text.trim() !== '') return text.trim();
  if (code === '42501' || /not authorized|not on a paper you hold/i.test(text)) {
    return 'That question is not on a paper you hold, so it cannot be edited here.';
  }
  return 'Could not open that question to edit. Check your internet and try again.';
}
