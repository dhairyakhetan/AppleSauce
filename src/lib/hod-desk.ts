import type { HodEscalation } from '@/lib/hod-api';

/* Small pure rules behind the HOD desk, kept out of the components so they can
   be tested without a browser. */

// ------------------------------------------------------- escalated: Fix

export interface EscalationDraft {
  body: string;
  number: string;
  marks: string;
}

export interface EscalationFixPatch {
  body: string | null;
  display_number: string | null;
  marks: number | null;
}

/** Either the words to refuse with, or what to send. (`'error' in r` narrows it; strictNullChecks is off here.) */
export type EscalationFixResult = { error: string } | { patch: EscalationFixPatch };

export function marksTextInvalid(marks: string): boolean {
  return marks.trim() !== '' && !(Number.isFinite(Number(marks)) && Number(marks) >= 0);
}

/**
 * What "Save and settle" sends. The words go out only when the reviewer really
 * changed them, and then exactly as typed: nothing here strips, trims or
 * re-cases question text (CLAUDE.md, standing constraint). Untouched words are
 * sent as null, which the server reads as "keep the stored body".
 *
 * The server also reads a null number or marks as "keep", so a box emptied over
 * a stored value cannot clear it; that is refused here in words instead of
 * reporting a fix that changed nothing. A box that was already empty stays fine.
 */
export function buildEscalationFix(e: Pick<HodEscalation, 'body' | 'display_number' | 'marks'>, draft: EscalationDraft): EscalationFixResult {
  if (marksTextInvalid(draft.marks)) return { error: 'Marks must be a number, like 2 or 0.5.' };
  const number = draft.number.trim();
  const marks = draft.marks.trim();
  if (number === '' && (e.display_number ?? '').trim() !== '') {
    return { error: 'The question number cannot be left empty here. Type the number, or press Cancel to keep it as it was.' };
  }
  if (marks === '' && e.marks != null) {
    return { error: 'Marks cannot be left empty here. Type the marks, or press Cancel to keep them as they were.' };
  }
  return {
    patch: {
      body: draft.body !== e.body ? draft.body : null,
      display_number: number === '' ? null : number,
      marks: marks === '' ? null : Number(marks),
    },
  };
}

// ------------------------------------------------------- verifiers: subjects

/**
 * Saving the subject box settles a pending request, and the server then forgets
 * what was asked for. True when the typed list leaves out something the verifier
 * asked for, so the HOD is told before it is dropped.
 */
export function requestWouldBeDropped(requested: string[], typed: string[]): string[] {
  const have = new Set(typed.map((s) => s.trim().toLowerCase()));
  return requested.filter((s) => !have.has(s.trim().toLowerCase()));
}

// ------------------------------------------------------- assignments: free papers

/** How many unheld papers the list shows; one more is asked for to know there are others. */
export const UNASSIGNED_SHOWN = 200;

export function capUnassigned<T>(rows: T[], shown = UNASSIGNED_SHOWN): { shown: T[]; more: boolean } {
  return { shown: rows.slice(0, shown), more: rows.length > shown };
}

// ------------------------------------------------------- history

export type HistoryView = 'loading' | 'error' | 'empty' | 'rows';

/**
 * A failed "Load older" keeps the rows already on screen (TanStack Query v5 keeps
 * the data when a later page errors), so the error replaces the list only when
 * there is no list to keep.
 */
export function historyView(s: { isLoading: boolean; isError: boolean; rowCount: number }): HistoryView {
  if (s.isLoading) return 'loading';
  if (s.rowCount > 0) return 'rows';
  return s.isError ? 'error' : 'empty';
}
