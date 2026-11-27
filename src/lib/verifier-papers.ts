/**
 * The verifier's own screens: their papers, the questions inside a paper, and
 * their profile (20261007130000_verifier_paper_lists.sql). Pure shaping and
 * wording, so the screens and the tests share one set of rules.
 *
 * "Verifier" is the word in all copy for a team member who checks questions
 * (owner, 7 Oct 2026).
 */

import { format, parseISO } from 'date-fns';
import type { RawOption } from '@/lib/checker-options';
import { paperLabel, paperProgress, type PaperProgress } from '@/lib/checker-progress';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const count = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

// -------------------------------------------------------------------- papers

/** A verifier holds at most 10 unfinished papers at a time (an HOD can still assign more by hand).
 *  Since 26 Nov 2026 papers go out only when an HOD presses Auto assign all, so nothing "arrives as you finish".
 *  The 7 days are verifier_idle_days() (20261007140000): say so, or papers seem to change for no reason. */
export const PAPER_LIMIT_NOTE =
  'You get up to 10 papers at a time. Your HOD gives out more papers. A paper with nothing done on it for 7 days goes back to the pool.';

export interface MyPaper {
  assignment_id: number;
  paper_id: string;
  subject: string | null;
  school: string | null;
  cls: string | null;
  exam: string | null;
  year: string | null;
  given_by_hod: boolean;
  /**
   * The first name of the HOD who handed the paper out (verifier_my_papers_given_by, 20261127140000). undefined = the
   * server did not say (the database file is not pasted yet), so the old wording is used; null = it said, but there is no
   * name on file ("Given by an HOD").
   */
  given_by_name?: string | null;
  assigned_at: string | null;
  /** Questions on the paper that are the verifier's to settle. */
  total: number;
  done: number;
  remaining: number;
  /** Questions of this paper currently with the HOD. */
  with_hod: number;
  /** Of `remaining`, how many the verifier skipped. They stay on the paper for later. */
  skipped: number;
  /** Every question of the paper (set-aside ones left out). 0 when the server does not send it yet. */
  paper_total: number;
  /** Of `paper_total`, how many are passed, by anyone (the computer, other verifiers, this one). */
  paper_passed: number;
  /** Open questions of this paper that are only WAITING (the paper is on hold, or a picture is missing). 0 until the
   *  extras function (20261127100000) is applied. */
  held_back?: number;
  /** Days before the 7-day "nothing done" return takes this paper back; null = not counting down (or not known). */
  idle_days_left?: number | null;
}

/** A paper the 7-day return took back from this checker in the last few days (verifier_my_papers_extra). */
export interface ReturnedPaper {
  paper_id: string;
  subject: string | null;
  school: string | null;
  cls: string | null;
  year: string | null;
  returned_at: string | null;
}

/** The two kinds of row verifier_my_papers_extra gives: facts about the papers held, and papers taken back. */
export function normalisePapersExtra(raw: unknown): {
  held: Map<string, { held_back: number; idle_days_left: number | null }>;
  returned: ReturnedPaper[];
} {
  const held = new Map<string, { held_back: number; idle_days_left: number | null }>();
  const returned: ReturnedPaper[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    const r = obj(x);
    const paper = str(r.paper_id);
    if (!paper) continue;
    if (r.kind === 'returned') {
      returned.push({
        paper_id: paper,
        subject: str(r.subject),
        school: str(r.school),
        cls: str(r.cls),
        year: str(r.year),
        returned_at: str(r.returned_at),
      });
    } else {
      const idle = r.idle_days_left === null || r.idle_days_left === undefined ? null : Number(r.idle_days_left);
      held.set(paper, { held_back: count(r.held_back), idle_days_left: idle !== null && Number.isFinite(idle) ? Math.max(0, Math.floor(idle)) : null });
    }
  }
  return { held, returned };
}

/** assignment id -> the first name of the HOD who handed it out (null when that HOD has no name on file). */
export function normaliseGivenBy(raw: unknown): Map<number, string | null> {
  const out = new Map<number, string | null>();
  for (const x of Array.isArray(raw) ? raw : []) {
    const r = obj(x);
    const id = Number(r.assignment_id);
    if (!Number.isFinite(id)) continue;
    const name = str(r.first_name);
    out.set(id, name ? name.trim().split(/\s+/)[0] : null);
  }
  return out;
}

/** Add the HOD's first name to the papers it knows about. A paper it did not mention keeps no name field (old wording). */
export function withGivenBy(rows: MyPaper[], names: Map<number, string | null>): MyPaper[] {
  if (names.size === 0) return rows;
  return rows.map((p) => (names.has(p.assignment_id) ? { ...p, given_by_name: names.get(p.assignment_id) ?? null } : p));
}

/** Add what verifier_my_papers_extra said to the rows of verifier_my_papers. Rows it did not mention stay as they are. */
export function withPapersExtra(rows: MyPaper[], held: Map<string, { held_back: number; idle_days_left: number | null }>): MyPaper[] {
  if (held.size === 0) return rows;
  return rows.map((p) => {
    const e = held.get(p.paper_id);
    return e ? { ...p, held_back: e.held_back, idle_days_left: e.idle_days_left } : p;
  });
}

/** Said on a paper whose open questions are only waiting (not "Your part is done": they come back by themselves). */
export function heldBackNote(n: number): string {
  return n === 1
    ? '1 question is waiting: the paper is on hold, or its picture is still being added. It comes back to you by itself.'
    : `${n} questions are waiting: the paper is on hold, or their pictures are still being added. They come back to you by themselves.`;
}

/** Only worth saying when it is close: "Goes back to the pool in 2 days if nothing is done." Null otherwise. */
export const IDLE_WARNING_DAYS = 3;
export function idleNote(daysLeft: number | null | undefined): string | null {
  if (daysLeft === null || daysLeft === undefined || daysLeft > IDLE_WARNING_DAYS) return null;
  if (daysLeft <= 0) return 'This paper goes back to the pool today if nothing is done on it.';
  return `This paper goes back to the pool in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} if nothing is done on it.`;
}

/** The line that tells a checker a paper went back, so it does not just vanish. */
export function returnedNote(r: Pick<ReturnedPaper, 'subject' | 'cls' | 'school' | 'year'>): string {
  return `${paperLabel(r)} went back to the pool because nothing was done on it for 7 days. Your HOD can give it to you again.`;
}

/**
 * "29 of 30 done" for the checking screen's top bar: the same whole-paper count the card in My papers shows (audit CK-09,
 * 27 Nov 2026: the card said "29 of 30 done" while the bar said "0 of 1 done" for the same paper). Falls back to the
 * checker's own share when the server does not send the whole-paper counts.
 */
export function paperProgressOf(p: Pick<MyPaper, 'total' | 'done' | 'remaining'> & Partial<Pick<MyPaper, 'paper_total' | 'paper_passed'>>): PaperProgress {
  if ((p.paper_total ?? 0) > 0) {
    return paperProgress({ done_count: p.paper_passed ?? 0, remaining_count: p.remaining, total_count: p.paper_total });
  }
  return paperProgress({ done_count: p.done, remaining_count: p.remaining, total_count: p.total });
}

/** True when none of the checker's papers has a question left for them: only then can they say "I am free". */
export function hasNothingToCheck(papers: readonly Pick<MyPaper, 'remaining'>[]): boolean {
  return papers.every((p) => p.remaining === 0);
}

export function normaliseMyPapers(raw: unknown): MyPaper[] {
  const out: MyPaper[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    const r = obj(x);
    const paper = str(r.paper_id);
    if (!paper) continue;
    out.push({
      assignment_id: count(r.assignment_id),
      paper_id: paper,
      subject: str(r.subject),
      school: str(r.school),
      cls: str(r.cls),
      exam: str(r.exam),
      year: str(r.year),
      given_by_hod: r.given_by_hod === true || r.given_by_hod === 'true',
      assigned_at: str(r.assigned_at),
      total: count(r.total),
      done: count(r.done),
      remaining: count(r.remaining),
      with_hod: count(r.with_hod),
      skipped: count(r.skipped),
      paper_total: count(r.paper_total),
      paper_passed: count(r.paper_passed),
      held_back: count(r.held_back),
      idle_days_left: null,
    });
  }
  return out;
}

/**
 * The paper's row after one answer the server has just taken, worked out here so the checking screen does not read
 * the whole list of papers (verifier_my_papers) again after every answer. Pass and fix finish a question; a skip
 * keeps it on the paper, marked skipped; asking for help hands it to the HOD. The list is read for real when the
 * paper runs out of questions, on Undo and on coming back to My papers, so a small drift here never lasts.
 */
export function papersAfterVerdict(
  rows: MyPaper[] | undefined,
  paperId: string,
  kind: 'pass' | 'fix' | 'skip' | 'ask_help' | 'ask_ai_redo',
): MyPaper[] | undefined {
  if (!rows) return rows;
  return rows.map((p) => {
    if (p.paper_id !== paperId) return p;
    if (kind === 'skip') return { ...p, skipped: Math.min(p.skipped + 1, p.remaining) };
    const remaining = Math.max(0, p.remaining - 1);
    const next = { ...p, remaining, skipped: Math.min(p.skipped, remaining) };
    if (kind === 'ask_help' || kind === 'ask_ai_redo') return { ...next, with_hod: p.with_hod + 1 };
    return { ...next, done: p.done + 1, paper_passed: p.paper_passed + 1 };
  });
}

export interface PaperCardProgress {
  /** "4 of 12 done". */
  label: string;
  /** 0 to 100. */
  percent: number;
  /** Nothing is left for the verifier to do on this paper. */
  finished: boolean;
}

/**
 * "29 of 30 done" counts the WHOLE paper, whoever passed each question (owner, 8 Nov 2026: "if others
 * were passed it should show full"). Before, the card counted only this verifier's own share, so a
 * paper with 29 questions already passed by the computer read "0 of 1 done". `done` itself is left as
 * it was: the undo button and the Start / Keep verifying button read it. When the server does not send
 * the whole-paper counts (paper_total 0), the card falls back to the verifier's own share.
 */
export function paperCardProgress(
  p: Pick<MyPaper, 'total' | 'done' | 'remaining'> & Partial<Pick<MyPaper, 'paper_total' | 'paper_passed'>>,
): PaperCardProgress {
  const whole = (p.paper_total ?? 0) > 0;
  const total = whole
    ? Math.max(p.paper_total ?? 0, (p.paper_passed ?? 0) + p.remaining, 0)
    : Math.max(p.total, p.done + p.remaining, 0);
  const done = Math.min(whole ? (p.paper_passed ?? 0) : p.done, total);
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const finished = p.remaining === 0;
  // "Your part is done" above a bare "0 of 12 done" read as a contradiction (audit, 26 Nov 2026): when the
  // checker's part is over but the paper is not, the count says it is the whole paper's.
  const label = finished && whole && done < total ? `${done} of ${total} done on the whole paper` : `${done} of ${total} done`;
  return { label, percent, finished };
}

/**
 * The card's status line when the checker's part is over, nothing is with the HOD, and yet the paper is not all
 * passed (its other questions are for the HOD or an admin, never for a checker). The shared line would say "it waits
 * for approval", which is not true yet. Null: use the shared line (checkerCardLine).
 */
export function partDoneNote(
  p: Pick<MyPaper, 'remaining' | 'with_hod'> & Partial<Pick<MyPaper, 'paper_total' | 'paper_passed' | 'held_back'>>,
): string | null {
  // Questions that are only waiting are not "done": say what is going on instead (audit CK-01, 27 Nov 2026).
  if (p.remaining === 0 && (p.held_back ?? 0) > 0) return heldBackNote(p.held_back ?? 0);
  const total = p.paper_total ?? 0;
  if (p.remaining > 0 || p.with_hod > 0 || total === 0) return null;
  return (p.paper_passed ?? 0) < total ? 'Your part is done. Your HOD settles the rest of this paper.' : null;
}

/** How a subject family from verifier_subjects_with_papers reads on screen. */
const SUBJECT_FAMILY_LABELS: Record<string, string> = {
  mathematics: 'Mathematics',
  english: 'English',
  historyandcivics: 'History & Civics',
  economics: 'Economics',
};

export function subjectFamilyLabel(family: string): string {
  const key = family.trim().toLowerCase();
  if (SUBJECT_FAMILY_LABELS[key]) return SUBJECT_FAMILY_LABELS[key];
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * The line under "Which subjects would you like?": what the library has papers in. A subject with no
 * papers is refused by the server, so naming the ones that work saves a wasted try (tracker of 2 Nov,
 * "error when submitting preferred subjects"). Empty when the list is not known.
 */
export function subjectsHint(families: readonly string[] | null | undefined): string {
  const names = (families ?? []).map((f) => subjectFamilyLabel(f)).filter((n) => n !== '');
  if (names.length === 0) return '';
  return `Subjects with papers right now: ${names.join(', ')}.`;
}

/** "3 skipped" on a paper card: they stay on the paper for the verifier to come back to. */
export function skippedLabel(n: number): string {
  return `${n} skipped`;
}

/** What the verifier reads when only skipped questions are left on a paper. */
export function skippedNote(n: number): string {
  return n === 1
    ? 'You skipped 1 question on this paper. It stays here for later.'
    : `You skipped ${n} questions on this paper. They stay here for later.`;
}

/**
 * Unfinished papers first, finished ones last, and otherwise the order the papers were handed out.
 *
 * The order must not depend on how many questions are left. After every answer the list is
 * re-read and `remaining` changes, so sorting by it made the cards jump about under the
 * verifier's eyes ("the whole set of papers keeps changing", tracker of 2 Nov). A card now moves
 * only once: down to the finished group, when its last question is done. Ties on the hand-out
 * time fall back to the assignment id, which is how the server orders the list too.
 */
export function sortPapers(list: MyPaper[]): MyPaper[] {
  return [...list].sort((a, b) => {
    const fa = a.remaining === 0 ? 1 : 0;
    const fb = b.remaining === 0 ? 1 : 0;
    if (fa !== fb) return fa - fb;
    const byTime = (a.assigned_at ?? '').localeCompare(b.assigned_at ?? '');
    if (byTime !== 0) return byTime;
    return a.assignment_id - b.assignment_id;
  });
}

// ----------------------------------------------------------------- questions

export type PaperQuestionState = 'to_verify' | 'done' | 'with_hod' | 'set_aside' | 'not_for_verifiers';

export const QUESTION_STATE_LABEL: Record<PaperQuestionState, string> = {
  to_verify: 'To check',
  done: 'Done',
  with_hod: 'With the HOD',
  set_aside: 'Set aside',
  not_for_verifiers: 'Not for checkers',
};

export interface PaperQuestion {
  id: string;
  ord: number;
  display_number: string | null;
  number_path: string | null;
  /** Shown as stored, never cleaned. */
  body: string;
  options: RawOption[] | null;
  marks: number | null;
  instructions: string | null;
  page: number | null;
  page_path: string | null;
  snippet_path: string | null;
  state: PaperQuestionState;
  version: number;
}

const STATES = Object.keys(QUESTION_STATE_LABEL) as PaperQuestionState[];

export function normalisePaperQuestions(raw: unknown): PaperQuestion[] {
  const out: PaperQuestion[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    const r = obj(x);
    const id = str(r.id);
    if (!id) continue;
    const marks = r.marks === null || r.marks === undefined || r.marks === '' ? null : Number(r.marks);
    out.push({
      id,
      ord: Number(r.ord) || 0,
      display_number: str(r.display_number),
      number_path: str(r.number_path),
      body: typeof r.body === 'string' ? r.body : '',
      options: Array.isArray(r.options) ? (r.options as RawOption[]) : null,
      marks: marks !== null && Number.isFinite(marks) ? marks : null,
      instructions: str(r.instructions),
      page: r.page === null || r.page === undefined ? null : count(r.page) || null,
      page_path: str(r.page_path),
      snippet_path: str(r.snippet_path),
      state: STATES.includes(r.state as PaperQuestionState) ? (r.state as PaperQuestionState) : 'not_for_verifiers',
      version: count(r.version),
    });
  }
  return out;
}

/** The number shown for a question: the printed number, else its path, else its place in the list. */
export function questionLabel(q: Pick<PaperQuestion, 'display_number' | 'number_path' | 'ord'>, index: number): string {
  return q.display_number ?? q.number_path ?? String(index + 1);
}

export function stateCounts(list: Pick<PaperQuestion, 'state'>[]): Record<PaperQuestionState, number> {
  const out: Record<PaperQuestionState, number> = { to_verify: 0, done: 0, with_hod: 0, set_aside: 0, not_for_verifiers: 0 };
  for (const q of list) out[q.state] += 1;
  return out;
}

/** "5 to check, 4 done, 1 with the HOD", leaving out zeros. */
export function stateSummary(list: Pick<PaperQuestion, 'state'>[]): string {
  const c = stateCounts(list);
  const parts: string[] = [];
  if (c.to_verify) parts.push(`${c.to_verify} to check`);
  if (c.done) parts.push(`${c.done} done`);
  if (c.with_hod) parts.push(`${c.with_hod} with the HOD`);
  if (c.set_aside) parts.push(`${c.set_aside} set aside`);
  if (c.not_for_verifiers) parts.push(`${c.not_for_verifiers} not for checkers`);
  return parts.join(', ');
}

// ------------------------------------------------------------------- profile

export interface VerifierProfile {
  full_name: string | null;
  grade: number | null;
  school: string | null;
  board: string | null;
  /** YYYY-MM-DD. */
  valid_until: string | null;
  expired: boolean;
  preferred_subjects: string[];
  requested_subjects: string[];
}

export function normaliseProfile(raw: unknown): VerifierProfile | null {
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const grade = count(r.grade);
  return {
    full_name: str(r.full_name),
    grade: isVerifierGrade(grade) ? grade : null,
    school: str(r.school),
    board: str(r.board),
    valid_until: str(r.valid_until),
    expired: r.expired === true,
    preferred_subjects: strList(r.preferred_subjects),
    requested_subjects: strList(r.requested_subjects),
  };
}

/** Where a read stands: still loading, failed with nothing to show, or ready.
 *  A failed read must never be treated as "no rows" or "no details yet": the
 *  profile save is a full overwrite, and "Paper finished" must not appear
 *  while the list that says what is left has not arrived. */
export function loadGate(q: { isError: boolean; data?: unknown }): 'loading' | 'error' | 'ready' {
  // Ready only once there is an answer (null is an answer: "no row yet"). A
  // query that has neither data nor an error is still on its way, whatever
  // its fetch flags say, so the blank case can never be mistaken for a result.
  if (q.data !== undefined) return 'ready';
  return q.isError ? 'error' : 'loading';
}

/** The sign-in page's `redirect` target for the verifier screens: the page the
 *  verifier actually opened (a paper, or the verify screen), not just the list. */
export function checkerSignInPath(here: string): string {
  return here.startsWith('/checker') ? here : '/checker';
}

/** The same parameters without `reopen`, so a question that was reopened once is not reopened again by a refresh. */
export function withoutReopen(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete('reopen');
  return next;
}

export type ProfileStatus = 'ok' | 'missing' | 'expired';

export function profileStatus(p: Pick<VerifierProfile, 'grade' | 'expired'> | null): ProfileStatus {
  if (!p || p.grade === null) return 'missing';
  return p.expired ? 'expired' : 'ok';
}

/**
 * A verifier's grade is one plain integer, so "never a paper above the
 * verifier's grade" stays a number compare against public.class_grade (paper
 * classes are 1 to 12). Owner, 2026-10-08: the list runs from Under grade 6 to
 * Beyond UG.
 *   5        Under grade 6 (1 to 4 are older rows and read the same)
 *   6 to 12  Grade 6 to Grade 12
 *   13 to 16 UG 1st year to UG 4th year
 *   17       Beyond UG
 *   null     not given: no class limit
 * Keep in step with the check in 20261008130000_verifier_grade_range.sql.
 */
export const VERIFIER_GRADE_MIN = 1;
export const VERIFIER_GRADE_MAX = 17;
export const VERIFIER_GRADE_UNDER_6 = 5;

export function isVerifierGrade(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= VERIFIER_GRADE_MIN && n <= VERIFIER_GRADE_MAX;
}

export interface VerifierGradeOption {
  /** The integer stored, or null for "Not given". */
  value: number | null;
  label: string;
}

/** The grade dropdown, in order. One list for the verifier's own form and the HOD's. */
export const VERIFIER_GRADE_OPTIONS: readonly VerifierGradeOption[] = [
  { value: null, label: 'Not given' },
  { value: 5, label: 'Under grade 6' },
  { value: 6, label: 'Grade 6' },
  { value: 7, label: 'Grade 7' },
  { value: 8, label: 'Grade 8' },
  { value: 9, label: 'Grade 9' },
  { value: 10, label: 'Grade 10' },
  { value: 11, label: 'Grade 11' },
  { value: 12, label: 'Grade 12' },
  { value: 13, label: 'UG 1st year' },
  { value: 14, label: 'UG 2nd year' },
  { value: 15, label: 'UG 3rd year' },
  { value: 16, label: 'UG 4th year' },
  { value: 17, label: 'Beyond UG' },
];

/** "Grade 10", "Under grade 6", "UG 2nd year", "Beyond UG", or "Not set". */
export function formatGrade(grade: number | null): string {
  if (!isVerifierGrade(grade)) return 'Not set';
  if (grade < 6) return 'Under grade 6';
  if (grade <= 12) return `Grade ${grade}`;
  if (grade === 17) return 'Beyond UG';
  return `UG ${['1st', '2nd', '3rd', '4th'][grade - 13]} year`;
}

/** The select value for a stored grade: older rows 1 to 4 show as Under grade 6; blank for none. */
export function gradeSelectValue(grade: number | null): string {
  if (!isVerifierGrade(grade)) return '';
  return String(grade < VERIFIER_GRADE_UNDER_6 ? VERIFIER_GRADE_UNDER_6 : grade);
}

/** "31 Mar 2027", or "Not set". */
export function formatValidUntil(iso: string | null): string {
  if (!iso) return 'Not set';
  try {
    return format(parseISO(iso), 'd MMM yyyy');
  } catch {
    return iso;
  }
}

export function profileNotice(status: ProfileStatus): string | null {
  if (status === 'missing') return 'Add your grade, school and board below. Papers are given to you either way, but with your grade you only get papers for your class or below.';
  if (status === 'expired') return 'Your details have expired, so no new papers are being given to you. Ask your HOD to refresh them.';
  return null;
}

/** "Mathematics, Physics" typed or pasted, split on commas, semicolons and new lines, no blanks, no repeats. */
export function parseSubjectList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[,;\n]/)) {
    const s = part.trim().replace(/\s+/g, ' ');
    const key = s.toLowerCase();
    if (!s || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}
