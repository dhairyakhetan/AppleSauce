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

/** A verifier holds at most 10 unfinished papers at a time (an HOD can still assign more by hand). */
export const PAPER_LIMIT_NOTE = 'You get up to 10 papers at a time; more arrive as you finish.';

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
    });
  }
  return out;
}

export interface PaperCardProgress {
  /** "4 of 12 done". */
  label: string;
  /** 0 to 100. */
  percent: number;
  /** Nothing is left for the verifier to do on this paper. */
  finished: boolean;
}

export function paperCardProgress(p: Pick<MyPaper, 'total' | 'done' | 'remaining'>): PaperCardProgress {
  const total = Math.max(p.total, p.done + p.remaining, 0);
  const done = Math.min(p.done, total);
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return { label: `${done} of ${total} done`, percent, finished: p.remaining === 0 };
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

/** Unfinished papers first (fewest left first, so almost-done papers surface), finished ones last. */
export function sortPapers(list: MyPaper[]): MyPaper[] {
  return [...list].sort((a, b) => {
    const fa = a.remaining === 0 ? 1 : 0;
    const fb = b.remaining === 0 ? 1 : 0;
    if (fa !== fb) return fa - fb;
    if (a.remaining !== b.remaining) return a.remaining - b.remaining;
    return (a.assigned_at ?? '').localeCompare(b.assigned_at ?? '');
  });
}

// ----------------------------------------------------------------- questions

export type PaperQuestionState = 'to_verify' | 'done' | 'with_hod' | 'set_aside' | 'not_for_verifiers';

export const QUESTION_STATE_LABEL: Record<PaperQuestionState, string> = {
  to_verify: 'To verify',
  done: 'Done',
  with_hod: 'With the HOD',
  set_aside: 'Set aside',
  not_for_verifiers: 'Not for verifiers',
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
  if (c.not_for_verifiers) parts.push(`${c.not_for_verifiers} not for verifiers`);
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
