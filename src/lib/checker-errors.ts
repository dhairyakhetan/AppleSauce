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
      message: 'This question was open too long, or someone else took it, so it was not saved. Here is the next one.',
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
