/**
 * What a checker has typed on one question, and what pressing a button does
 * with it. Pure (no React, no network) so the rules are tested without a
 * login and without a browser.
 *
 * Two jobs, both born from the 2026-10-11 release QA:
 *
 *  1. planAnswer(): the ONE place that decides "Looks right" versus "save a
 *     fix", and what a fix sends. A fix whose words were not touched sends
 *     body null (the stored words stay byte for byte), so changing only the
 *     marks or the number can never rewrite the question. The repeated
 *     leading number is stripped only from words the checker really edited.
 *     Drafts carry the question they belong to; a plan for drafts that belong
 *     to another question is refused, so the previous question's words can
 *     never be sent with this question's id.
 *
 *  2. A draft autosave in sessionStorage, per question, so typed work
 *     survives a refresh, the two Back buttons and a lease that ran out.
 *     Every storage call is wrapped: private mode and blocked storage just
 *     mean no autosave.
 */

import { stripLeadingNumberPrefix } from '@/lib/checker-body';

export interface DraftQuestion {
  id: string;
  version?: number | null;
  body: string | null;
  display_number: string | null;
  marks: number | null;
}

export interface Drafts {
  body: string;
  number: string;
  marks: string;
  printedTypo: boolean;
  typoNote: string;
}

/** The marks box shows a number as text, empty when there are none. */
export function marksText(marks: number | null | undefined): string {
  return marks != null ? String(marks) : '';
}

/** What the boxes hold when a question first opens. `lost` is the computer's
 *  reading of a question whose words were lost (shown for the checker to confirm). */
export function draftsFromQuestion(q: DraftQuestion, lost: string | null = null): Drafts {
  return {
    body: lost ?? q.body ?? '',
    number: q.display_number ?? '',
    marks: marksText(q.marks),
    printedTypo: false,
    typoNote: '',
  };
}

/** True when two sets of boxes hold the same things. */
export function sameDrafts(a: Drafts, b: Drafts): boolean {
  return (
    a.body === b.body &&
    a.number === b.number &&
    a.marks === b.marks &&
    a.printedTypo === b.printedTypo &&
    a.typoNote === b.typoNote
  );
}

/** True when the boxes differ from the stored question. */
export function isEdited(q: DraftQuestion, d: Pick<Drafts, 'body' | 'number' | 'marks'>): boolean {
  return d.body !== (q.body ?? '') || d.number !== (q.display_number ?? '') || d.marks !== marksText(q.marks);
}

export type AnswerPlan =
  | { kind: 'pass' }
  | {
      kind: 'fix';
      patch: { body: string | null; display_number: string | null; marks: number | null };
      printedTypo: boolean;
      /** Whether the words themselves are part of this save. */
      bodyChanged: boolean;
      /** The number prefix removed from edited words, when there was one. */
      strippedPrefix: string | null;
    }
  | { kind: 'refuse'; why: 'wrong-question' };

export interface PlanInput {
  question: DraftQuestion;
  drafts: Drafts;
  /** Which question the drafts were made for (`draftOwnerKey`). */
  draftsFor: string;
  /** 'fix' = the Fix it screen is open, so Looks right means "save". */
  mode: 'check' | 'fix' | 'split';
  /** The computer's reading of a lost-text question, when there is one. */
  lost?: string | null;
}

/** Identifies the question (and fetch) a set of drafts belongs to. */
export function draftOwnerKey(q: DraftQuestion | null | undefined, fetchedAt: number): string {
  return q ? `${q.id}|${q.version ?? ''}|${fetchedAt}` : '';
}

/**
 * What to send for "Looks right" / "Save, now it matches". Either a plain
 * pass, or a fix. For a fix, `body` is null unless the words were edited
 * (compared with what is stored), so a marks-only or number-only save leaves
 * the question's text exactly as it was.
 */
export function planAnswer(input: PlanInput, ownerNow: string): AnswerPlan {
  const { question, drafts, draftsFor, mode } = input;
  if (draftsFor !== ownerNow) return { kind: 'refuse', why: 'wrong-question' };
  if (mode !== 'fix' && !isEdited(question, drafts)) return { kind: 'pass' };

  const savedNumber = drafts.number.trim() || null;
  const stored = question.body ?? '';
  const touched = drafts.body !== stored;
  let body: string | null = null;
  let strippedPrefix: string | null = null;
  if (touched) {
    // Owner: "the number lives in the number box only". Only a leading
    // number prefix is ever removed, and only from words the checker edited.
    const { stripped, removed } = stripLeadingNumberPrefix(drafts.body, savedNumber);
    strippedPrefix = removed;
    body = stripped !== stored ? stripped : null;
  }
  return {
    kind: 'fix',
    patch: {
      body,
      display_number: savedNumber,
      marks: drafts.marks.trim() === '' ? null : Number(drafts.marks),
    },
    printedTypo: mode === 'fix' && drafts.printedTypo,
    bodyChanged: body !== null,
    strippedPrefix,
  };
}

/* ------------------------------------------------------------------------ */
/* Autosave                                                                  */
/* ------------------------------------------------------------------------ */

const DRAFT_PREFIX = 'shikshaq.checker.draft.';

interface StoredDraft {
  v: number | null;
  body: string;
  number: string;
  marks: string;
  printedTypo: boolean;
  typoNote: string;
}

function storageKey(scope: string, questionId: string): string {
  return `${DRAFT_PREFIX}${scope}.${questionId}`;
}

function store(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function saveDraft(scope: string, q: DraftQuestion, d: Drafts, storage: Storage | null = store()): void {
  if (!storage) return;
  try {
    const value: StoredDraft = {
      v: q.version ?? null,
      body: d.body,
      number: d.number,
      marks: d.marks,
      printedTypo: d.printedTypo,
      typoNote: d.typoNote,
    };
    storage.setItem(storageKey(scope, q.id), JSON.stringify(value));
  } catch {
    /* full or blocked: the draft just is not kept */
  }
}

export function clearDraft(scope: string, questionId: string, storage: Storage | null = store()): void {
  if (!storage) return;
  try {
    storage.removeItem(storageKey(scope, questionId));
  } catch {
    /* nothing to do */
  }
}

export interface RestoredDraft {
  drafts: Drafts;
  /** False when the question changed after the draft was typed: the words
   *  are shown for copying, never put back into the editor. */
  current: boolean;
}

/** The draft kept for this question, or null. Never throws. */
export function loadDraft(
  scope: string,
  q: DraftQuestion,
  lost: string | null = null,
  storage: Storage | null = store(),
): RestoredDraft | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(storageKey(scope, q.id));
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<StoredDraft> | null;
    if (!s || typeof s !== 'object' || typeof s.body !== 'string') return null;
    const drafts: Drafts = {
      body: s.body,
      number: typeof s.number === 'string' ? s.number : '',
      marks: typeof s.marks === 'string' ? s.marks : '',
      printedTypo: Boolean(s.printedTypo),
      typoNote: typeof s.typoNote === 'string' ? s.typoNote : '',
    };
    // Same version = the draft still sits on the question it was typed on.
    const current = (s.v ?? null) === (q.version ?? null);
    // Nothing the checker typed beyond what the question opens with.
    if (sameDrafts(drafts, draftsFromQuestion(q, lost))) return null;
    return { drafts, current };
  } catch {
    return null;
  }
}
