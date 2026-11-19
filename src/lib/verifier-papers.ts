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
 *  The 7 days are verifier_idle_days() (20261007140000): say so, or papers seem to change for no reason. */
export const PAPER_LIMIT_NOTE =
  'You get up to 10 papers at a time; more arrive as you finish. A paper with nothing done on it for 7 days goes back to the pool.';

export interface MyPaper {
  assignment_id: number;
  paper_id: string;
  subject: string | null;
  school: string | null;
  cls: string | null;
  exam: string | null;
  year: string | null;
  given_by_hod: boolean;
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
  return { label: `${done} of ${total} done`, percent, finished: p.remaining === 0 };
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
  to_verify: 'To verify',
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

/** "5 to verify, 4 done, 1 with the HOD", leaving out zeros. */
export function stateSummary(list: Pick<PaperQuestion, 'state'>[]): string {
  const c = stateCounts(list);
  const parts: string[] = [];
  if (c.to_verify) parts.push(`${c.to_verify} to verify`);
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
