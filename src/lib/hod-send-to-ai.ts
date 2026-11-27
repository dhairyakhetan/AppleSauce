import { isNotSwitchedOn } from '@/lib/paper-asks';
import { errorWords } from '@/lib/hod-publish';

/* HOD "Send to AI", "Send whole paper to AI" and "Send back to checking" (owner, 27 Nov 2026). Pure helpers: the
   reason rules, the words, and how many questions a whole-paper send would take. The calls are in hod-api.ts; the
   database side is supabase/migrations/20261127140000_hod_features.sql. */

/** A reason must say something, and is kept short. The same limits are checked again on the server (22023). */
export const REASON_MIN = 5;
export const REASON_MAX = 500;

/** How long Undo stays on screen after a send. The server accepts an undo for up to 5 minutes, but only while the AI has not picked the question up. */
export const UNDO_SECONDS = 10;

/** null when the reason is fine, else the plain sentence that says what is missing. */
export function reasonProblem(text: string): string | null {
  const t = text.trim();
  if (t.length === 0) return 'Write a reason first.';
  if (t.length < REASON_MIN) return `Say a little more (at least ${REASON_MIN} characters).`;
  if (t.length > REASON_MAX) return `That is too long (${REASON_MAX} characters at most).`;
  return null;
}

/** "12 / 500", the counter under the box. Counts what will be saved (trimmed). */
export function reasonCounter(text: string): string {
  return `${text.trim().length} / ${REASON_MAX}`;
}

/** What a whole-paper send would take, from the server's read-only count (hod_paper_ai_counts). */
export interface PaperAiCounts {
  /** Open questions waiting on the HOD that can go. */
  needs_you: number;
  /** Open questions still with the student checkers (only sent when the box is ticked). */
  other: number;
  /** Waiting on the HOD but already in the AI flow, so left as they are. */
  skipped: number;
}

export function normalisePaperAiCounts(raw: unknown): PaperAiCounts {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const n = (v: unknown) => {
    const x = Number(v);
    return Number.isFinite(x) && x > 0 ? Math.floor(x) : 0;
  };
  return { needs_you: n(o.needs_you), other: n(o.other), skipped: n(o.skipped) };
}

/** How many questions go: the ones waiting on the HOD, plus the ones with the students when the box is ticked. */
export function paperSendCount(c: PaperAiCounts, includeOther: boolean): number {
  return c.needs_you + (includeOther ? c.other : 0);
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The words in the confirm box. Says how many questions go, and that the reason goes with every one of them. */
export function paperSendConfirm(c: PaperAiCounts, includeOther: boolean): { title: string; description: string; confirmLabel: string } {
  const n = paperSendCount(c, includeOther);
  const withStudents = includeOther ? c.other : 0;
  const parts = [
    `${n} ${plural(n, 'question goes', 'questions go')} to the AI to be read again, each with your reason.`,
    withStudents > 0
      ? `${withStudents} of ${plural(withStudents, 'them is', 'them are')} with the student checkers now and ${plural(withStudents, 'comes', 'come')} to you first.`
      : null,
    c.skipped > 0 ? `${c.skipped} already in the AI flow ${plural(c.skipped, 'stays', 'stay')} as ${plural(c.skipped, 'it is', 'they are')}.` : null,
    `You can undo it for a few seconds after.`,
  ].filter((x): x is string => Boolean(x));
  return {
    title: `Send ${n} ${plural(n, 'question', 'questions')} to the AI?`,
    description: parts.join(' '),
    confirmLabel: `Send ${n} to the AI`,
  };
}

/** The words in the confirm box for Send back to checking. `passed` is the paper's passed count shown on the Ready row. */
export function sendBackConfirm(passed: number): { title: string; description: string; confirmLabel: string } {
  return {
    title: 'Send this paper back to checking?',
    description:
      `The paper leaves the Ready list. ${passed} ${plural(passed, 'passed question goes', 'passed questions go')} back to the student checkers, each with your reason in its history. ` +
      'Questions you left out stay left out. Nothing is handed out by itself: give the paper to a checker with Auto assign all.',
    confirmLabel: 'Send it back',
  };
}

export const SEND_TO_AI_NOT_ON_WORDS = 'Sending to the AI is not switched on yet. Nothing was changed. Tell the owner.';
export const SEND_BACK_NOT_ON_WORDS = 'Sending a paper back to checking is not switched on yet. Nothing was changed. Tell the owner.';

/** A refused or failed send, in plain words. A database that does not have the new file yet says so. */
export function sendFailureWords(err: unknown, notOn: string = SEND_TO_AI_NOT_ON_WORDS): string {
  if (isNotSwitchedOn(err)) return notOn;
  return errorWords(err);
}

/** The tab's number: "3 questions are waiting for the AI or for your yes or no". */
export function sendToAiBadgeLabel(n: number): string {
  return n === 1 ? '1 question waiting for the AI or for your yes or no' : `${n} questions waiting for the AI or for your yes or no`;
}

/** The line after a one-question send. */
export function sentLine(label: string): string {
  return `Question ${label} sent to the AI.`;
}

/** The line after a whole-paper send. */
export function paperSentLine(sent: number, movedFromStudents: number): string {
  const base = `${sent} ${plural(sent, 'question', 'questions')} sent to the AI.`;
  return movedFromStudents > 0 ? `${base} ${movedFromStudents} ${plural(movedFromStudents, 'was', 'were')} taken from the student checkers.` : base;
}

/** The "Send to AI" button shows on a card that is not already in the AI flow and is not on the live site. */
export function canSendToAi(q: { live_bank_question_id: string | null; ai_redo_state: string | null }): boolean {
  return !q.live_bank_question_id && q.ai_redo_state !== 'requested' && q.ai_redo_state !== 'approved';
}
