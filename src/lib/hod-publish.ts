/**
 * The HOD desk's go-live side (2026-10-12): Needs you, Ready to go live, the
 * preview flow, Student uploads, Live papers, the route trail and the desk
 * counts. Types and the normalisers that turn each RPC's rows into them, plus
 * the small pure rules (the four checks, the header fields, the filters).
 *
 * Pure, no Supabase client, so it is tested without a login. The RPC calls
 * themselves are in hod-api.ts. Question text is passed through untouched:
 * never trimmed, cleaned or re-cased.
 *
 * Every word on screen is plain: "checks", "left out", never "bucket" or "RPC".
 */

import { normaliseOptions, type ReviewOption } from '@/lib/admin-approval-shape';
import { marksTextInvalid } from '@/lib/hod-desk';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const bool = (v: unknown): boolean => v === true || v === 'true';
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A function returning `table(...)` may arrive as an array, or a jsonb array; one object is one row. */
function asRows(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') return [v];
  return [];
}

// ------------------------------------------------------------ the route trail

export type TrailStage = 'read' | 'checking' | 'needs_you' | 'ready' | 'live';

/** The five stops, in order, in the words the pipeline page uses. */
export const TRAIL_STAGES: { key: TrailStage; label: string; hint: string }[] = [
  { key: 'read', label: 'Read', hint: 'The computer has read the paper.' },
  { key: 'checking', label: 'Checking by students', hint: 'Students are checking the questions.' },
  { key: 'needs_you', label: 'Needs you', hint: 'Questions only an HOD can settle.' },
  { key: 'ready', label: 'Ready', hint: 'Every question is settled. It waits for your yes.' },
  { key: 'live', label: 'Live', hint: 'On the site for visitors.' },
];

export function stageIndex(stage: TrailStage): number {
  return Math.max(0, TRAIL_STAGES.findIndex((s) => s.key === stage));
}

export function isTrailStage(v: unknown): v is TrailStage {
  return TRAIL_STAGES.some((s) => s.key === v);
}

/** For screen readers: "Where it is: step 3 of 5, Needs you." */
export function trailSentence(stage: TrailStage): string {
  const i = stageIndex(stage);
  return `Where it is: step ${i + 1} of ${TRAIL_STAGES.length}, ${TRAIL_STAGES[i].label}.`;
}

export interface HodTrailRow {
  audit_paper_id: string;
  stage: TrailStage;
  total: number;
  passed: number;
  checking: number;
  needs_you: number;
  set_aside: number;
  title: string | null;
  subject: string | null;
  cls: string | null;
  school: string | null;
  is_live: boolean;
}

export function normaliseTrail(raw: unknown): HodTrailRow[] {
  const out: HodTrailRow[] = [];
  for (const x of asRows(raw)) {
    const r = obj(x);
    const id = str(r.audit_paper_id);
    if (!id || !isTrailStage(r.stage)) continue;
    out.push({
      audit_paper_id: id,
      stage: r.stage,
      total: num(r.total),
      passed: num(r.passed),
      checking: num(r.checking),
      needs_you: num(r.needs_you),
      set_aside: num(r.set_aside),
      title: str(r.title),
      subject: str(r.subject),
      cls: str(r.cls),
      school: str(r.school),
      is_live: bool(r.is_live),
    });
  }
  return out;
}

/** The trail rows by paper, so a list row finds its stop in one lookup. */
export function trailByPaper(rows: HodTrailRow[]): Map<string, HodTrailRow> {
  return new Map(rows.map((r) => [r.audit_paper_id, r]));
}

// ----------------------------------------------------------------- desk counts

export interface HodDeskCounts {
  read: number;
  checking: number;
  needs_you: number;
  ready: number;
  ready_ok: number;
  approved: number;
  needs_you_questions: number;
  live: number;
  hidden: number;
  student_uploads_pending: number;
}

export function normaliseDeskCounts(raw: unknown): HodDeskCounts {
  const r = obj(Array.isArray(raw) ? raw[0] : raw);
  return {
    read: num(r.read),
    checking: num(r.checking),
    needs_you: num(r.needs_you),
    ready: num(r.ready),
    ready_ok: num(r.ready_ok),
    approved: num(r.approved),
    needs_you_questions: num(r.needs_you_questions),
    live: num(r.live),
    hidden: num(r.hidden),
    student_uploads_pending: num(r.student_uploads_pending),
  };
}

// ------------------------------------------------------------------ the checks

export type CheckKey = 'questions_checked' | 'pictures_present' | 'header_complete' | 'scanner_junk_gone';

/** The four checks, in the order the server always sends them, with the short name used on chips. */
export const CHECKS: { key: CheckKey; label: string; short: string; fixHint: string }[] = [
  {
    key: 'questions_checked',
    label: 'Every question is checked',
    short: 'Every question checked',
    fixHint: 'Settle the questions that are still open: pass them, fix them or leave them out.',
  },
  {
    key: 'pictures_present',
    label: 'Pictures are in place',
    short: 'Pictures present',
    fixHint: 'A picture has not reached the site yet. Pictures go up when the owner says to upload them.',
  },
  {
    key: 'header_complete',
    label: 'Paper details are complete',
    short: 'Header complete',
    fixHint: 'Fill in the missing details in the Details step.',
  },
  {
    key: 'scanner_junk_gone',
    label: 'No scanner junk left',
    short: 'Scanner junk gone',
    fixHint: 'Fix the words of the marked questions, or set them aside.',
  },
];

export interface HodCheck {
  key: CheckKey;
  label: string;
  ok: boolean;
  detail: string;
}

/**
 * Always exactly the four checks, in order. A check the server did not send (or a
 * payload that is not a list) comes back NOT ok with a plain "did not load" note, so
 * a broken read can never turn a red paper green.
 */
export function normaliseChecks(raw: unknown): HodCheck[] {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const x of list(raw)) {
    const r = obj(x);
    const k = str(r.key);
    if (k) byKey.set(k, r);
  }
  return CHECKS.map((c) => {
    const r = byKey.get(c.key);
    if (!r) return { key: c.key, label: c.label, ok: false, detail: 'This check did not load. Refresh the page.' };
    return { key: c.key, label: str(r.label) ?? c.label, ok: r.ok === true, detail: str(r.detail) ?? '' };
  });
}

/** True only when all four checks are there and every one is ok. This is what enables Publish. */
export function allChecksPass(checks: HodCheck[] | null | undefined): boolean {
  return Array.isArray(checks) && checks.length === CHECKS.length && checks.every((c) => c.ok === true);
}

export function failedChecks(checks: HodCheck[]): HodCheck[] {
  return checks.filter((c) => !c.ok);
}

export function checkShort(key: string): string {
  return CHECKS.find((c) => c.key === key)?.short ?? key;
}

export function checkFixHint(key: string): string {
  return CHECKS.find((c) => c.key === key)?.fixHint ?? '';
}

/** "Not yet: 2 checks to fix" / "All four checks pass". */
export function checksSummary(checks: HodCheck[]): string {
  const bad = failedChecks(checks).length;
  if (bad === 0 && allChecksPass(checks)) return 'All four checks pass';
  return bad === 1 ? '1 check to fix' : `${bad} checks to fix`;
}

// --------------------------------------------------------------- Needs you

export interface HodNeedsYouPaper {
  audit_paper_id: string;
  title: string;
  subject: string | null;
  cls: string | null;
  school: string | null;
  is_live: boolean;
  escalated: number;
  admin_bucket: number;
  total: number;
}

export function paperTitleOf(r: { title?: string | null; subject?: string | null; cls?: string | null; school?: string | null }): string {
  if (r.title && r.title.trim()) return r.title;
  const bits = [r.subject, r.cls ? `Class ${r.cls}` : null, r.school].filter(Boolean);
  return bits.length ? bits.join(' · ') : 'Untitled paper';
}

export function normaliseNeedsYouPapers(raw: unknown): HodNeedsYouPaper[] {
  const out: HodNeedsYouPaper[] = [];
  for (const x of asRows(raw)) {
    const r = obj(x);
    const id = str(r.audit_paper_id);
    if (!id) continue;
    out.push({
      audit_paper_id: id,
      title: paperTitleOf({ title: str(r.title), subject: str(r.subject), cls: str(r.cls), school: str(r.school) }),
      subject: str(r.subject),
      cls: str(r.cls),
      school: str(r.school),
      is_live: bool(r.is_live),
      escalated: num(r.escalated),
      admin_bucket: num(r.admin_bucket),
      total: num(r.total),
    });
  }
  return out;
}

/** Questions waiting for the HOD on one paper. */
export function waitingOn(p: Pick<HodNeedsYouPaper, 'escalated' | 'admin_bucket'>): number {
  return p.escalated + p.admin_bucket;
}

export type NeedsBucket = 'escalated' | 'admin';

export interface HodNeedsQuestion {
  id: string;
  paper_id: string;
  ord: number;
  kind: string;
  parent_id: string | null;
  number_path: string | null;
  display_number: string | null;
  instructions: string | null;
  body: string;
  options: ReviewOption[];
  /** The options exactly as stored, so a Fix sends back what it was given. */
  options_raw: unknown;
  marks: number | null;
  figure_path: string | null;
  state: string;
  version: number;
  flag_reasons: string[];
  review_bucket: NeedsBucket | null;
  live_bank_question_id: string | null;
  ai_decision: string | null;
  ai_review_reason: string | null;
  page: number | null;
  page_path: string | null;
  snippet_path: string | null;
  escalated_by: string | null;
  escalated_by_name: string | null;
  escalated_at: string | null;
  reason: string | null;
}

export function normaliseNeedsQuestion(raw: unknown): HodNeedsQuestion | null {
  const r = obj(raw);
  const id = str(r.id);
  const paper = str(r.paper_id);
  if (!id || !paper) return null;
  const bucket = r.review_bucket === 'escalated' || r.review_bucket === 'admin' ? r.review_bucket : null;
  return {
    id,
    paper_id: paper,
    ord: num(r.ord),
    kind: str(r.kind) ?? 'question',
    parent_id: str(r.parent_id),
    number_path: str(r.number_path),
    display_number: str(r.display_number),
    instructions: str(r.instructions),
    // The words are passed through untouched.
    body: typeof r.body === 'string' ? r.body : '',
    options: normaliseOptions(r.options),
    options_raw: r.options ?? null,
    marks: numOrNull(r.marks),
    figure_path: str(r.figure_path),
    state: str(r.state) ?? 'open',
    version: num(r.version),
    flag_reasons: strList(r.flag_reasons),
    review_bucket: bucket,
    live_bank_question_id: str(r.live_bank_question_id),
    ai_decision: str(r.ai_decision),
    ai_review_reason: str(r.ai_review_reason),
    page: numOrNull(r.page) || null,
    page_path: str(r.page_path),
    snippet_path: str(r.snippet_path),
    escalated_by: str(r.escalated_by),
    escalated_by_name: str(r.escalated_by_name),
    escalated_at: str(r.escalated_at),
    reason: str(r.reason),
  };
}

export function normaliseNeedsQuestions(raw: unknown): HodNeedsQuestion[] {
  return list(raw)
    .map(normaliseNeedsQuestion)
    .filter((q): q is HodNeedsQuestion => q !== null)
    .sort((a, b) => a.ord - b.ord);
}

/** "Sent up by a student" for the escalated pile, "Flagged by the computer" for the other. */
export function whyItNeedsYou(q: Pick<HodNeedsQuestion, 'review_bucket' | 'escalated_by_name' | 'reason' | 'ai_review_reason'>): string {
  if (q.review_bucket === 'escalated') {
    const who = q.escalated_by_name ?? 'A student';
    return q.reason ? `${who} asked you: ${q.reason}` : `${who} sent this up and gave no reason.`;
  }
  return q.ai_review_reason ?? 'The computer could not settle this one, so it came to you.';
}

/** Send back works on a question a student sent up. The other pile has no send-back. */
export function canSendBack(q: Pick<HodNeedsQuestion, 'review_bucket'>): boolean {
  return q.review_bucket === 'escalated';
}

// ------------------------------------------------------------- Ready to go live

export interface HodReadyPaper {
  audit_paper_id: string;
  title: string;
  subject: string | null;
  cls: string | null;
  school: string | null;
  question_count: number;
  passed_count: number;
  /** Questions set aside on purpose; they do not go live. */
  left_out: number;
  checks: HodCheck[];
  board: string | null;
  year: string | null;
  exam: string | null;
  kind: 'new' | 'retro';
  queued_at: string | null;
  all_ok: boolean;
  is_live: boolean;
}

export function normaliseReadyPapers(raw: unknown): HodReadyPaper[] {
  const out: HodReadyPaper[] = [];
  for (const x of asRows(raw)) {
    const r = obj(x);
    const id = str(r.audit_paper_id);
    if (!id) continue;
    const checks = normaliseChecks(r.checks);
    out.push({
      audit_paper_id: id,
      title: paperTitleOf({ title: str(r.title), subject: str(r.subject), cls: str(r.cls), school: str(r.school) }),
      subject: str(r.subject),
      cls: str(r.cls),
      school: str(r.school),
      question_count: num(r.question_count),
      passed_count: num(r.passed_count),
      left_out: num(r.left_out),
      checks,
      board: str(r.board),
      year: str(r.year),
      exam: str(r.exam),
      kind: r.kind === 'retro' ? 'retro' : 'new',
      queued_at: str(r.queued_at),
      // Our own reading of the four checks wins over the server's flag.
      all_ok: allChecksPass(checks),
      is_live: bool(r.is_live),
    });
  }
  return out;
}

// ------------------------------------------------------------------- the preview

export type PreviewState = 'passed' | 'open' | 'set_aside' | 'section';

export interface PreviewQuestion {
  id: string;
  ord: number;
  kind: string;
  parent_id: string | null;
  section_label: string | null;
  number_path: string | null;
  display_number: string | null;
  instructions: string | null;
  body: string;
  options: ReviewOption[];
  marks: number | null;
  /** A picture already on the site (paper-figures bucket). */
  figure_path: string | null;
  /** The picture the checkers kept, in the private bucket. */
  figure_storage_path: string | null;
  has_picture: boolean;
  picture_staged: boolean;
  page: number | null;
  state: PreviewState;
  version: number;
  review_bucket: string | null;
  flag_reasons: string[];
  set_aside_reason: string | null;
  scanner_junk: boolean;
}

export interface PreviewHeader {
  school: string | null;
  school_raw: string | null;
  is_board_paper: boolean | null;
  has_school: boolean | null;
  cls: string | null;
  subject: string | null;
  board: string | null;
  year: string | null;
  exam: string | null;
  marks: number | null;
  allowed_time_minutes: number | null;
  general_instructions: string | null;
  incomplete_note: string | null;
}

export interface PreviewPaper {
  audit_paper_id: string;
  title: string;
  approval_state: string | null;
  kind: 'new' | 'retro';
  queued_at: string | null;
  live_bank_paper_id: string | null;
  is_live: boolean;
  page_count: number;
  header: PreviewHeader;
  marks_from_questions: number | null;
  approval_note: string | null;
}

export interface HodPreview {
  paper: PreviewPaper;
  questions: PreviewQuestion[];
  counts: { total: number; passed: number; open: number; set_aside: number };
  pages: { page: number; object_path: string }[];
  checks: HodCheck[];
}

function triState(v: unknown): boolean | null {
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  return null;
}

export function normalisePreviewQuestion(raw: unknown): PreviewQuestion | null {
  const r = obj(raw);
  const id = str(r.id);
  if (!id) return null;
  const state: PreviewState = r.state === 'passed' || r.state === 'set_aside' || r.state === 'section' ? r.state : 'open';
  return {
    id,
    ord: num(r.ord),
    kind: str(r.kind) ?? 'question',
    parent_id: str(r.parent_id),
    section_label: str(r.section_label),
    number_path: str(r.number_path),
    display_number: str(r.display_number),
    instructions: str(r.instructions),
    body: typeof r.body === 'string' ? r.body : '',
    options: normaliseOptions(r.options),
    marks: numOrNull(r.marks),
    figure_path: str(r.figure_path),
    figure_storage_path: str(r.figure_storage_path),
    has_picture: bool(r.has_picture),
    picture_staged: bool(r.picture_staged),
    page: numOrNull(r.page) || null,
    state,
    version: num(r.version),
    review_bucket: str(r.review_bucket),
    flag_reasons: strList(r.flag_reasons),
    set_aside_reason: str(r.set_aside_reason),
    scanner_junk: bool(r.scanner_junk),
  };
}

export function normalisePreviewHeader(raw: unknown): PreviewHeader {
  const h = obj(raw);
  const year = str(h.year);
  return {
    school: str(h.school),
    school_raw: str(h.school_raw),
    is_board_paper: triState(h.is_board_paper),
    has_school: triState(h.has_school),
    cls: str(h.cls),
    subject: str(h.subject),
    board: str(h.board),
    year: year && year !== 'year-unknown' ? year : null,
    exam: str(h.exam),
    marks: numOrNull(h.marks),
    allowed_time_minutes: numOrNull(h.allowed_time_minutes),
    general_instructions: str(h.general_instructions),
    incomplete_note: str(h.incomplete_note),
  };
}

/** Counts from the question rows themselves, used when the server sends none. */
export function countQuestions(qs: PreviewQuestion[]): HodPreview['counts'] {
  const real = qs.filter((q) => q.kind === 'question' && q.state !== 'section');
  return {
    total: real.length,
    passed: real.filter((q) => q.state === 'passed').length,
    open: real.filter((q) => q.state === 'open').length,
    set_aside: real.filter((q) => q.state === 'set_aside').length,
  };
}

export function normalisePreview(raw: unknown): HodPreview {
  const r = obj(Array.isArray(raw) ? raw[0] : raw);
  const p = obj(r.paper);
  const id = str(p.audit_paper_id);
  if (!id) throw new Error('The paper preview came back incomplete.');
  const questions = list(r.questions)
    .map(normalisePreviewQuestion)
    .filter((q): q is PreviewQuestion => q !== null)
    .sort((a, b) => a.ord - b.ord);
  const c = obj(r.counts);
  const fromRows = countQuestions(questions);
  const counts = r.counts
    ? { total: num(c.total), passed: num(c.passed), open: num(c.open), set_aside: num(c.set_aside) }
    : fromRows;
  return {
    paper: {
      audit_paper_id: id,
      title: paperTitleOf({ title: str(p.title) }),
      approval_state: str(p.approval_state),
      kind: p.kind === 'retro' ? 'retro' : 'new',
      queued_at: str(p.queued_at),
      live_bank_paper_id: str(p.live_bank_paper_id),
      is_live: bool(p.is_live),
      page_count: num(p.page_count),
      header: normalisePreviewHeader(p.header),
      marks_from_questions: numOrNull(p.marks_from_questions),
      approval_note: str(p.approval_note),
    },
    questions,
    counts,
    pages: list(r.pages)
      .map((x) => obj(x))
      .map((x) => ({ page: num(x.page), object_path: str(x.object_path) ?? '' }))
      .filter((x) => x.object_path !== ''),
    checks: normaliseChecks(r.checks),
  };
}

/**
 * Publish is allowed when all four checks pass AND, if any question is left out, the HOD
 * has ticked that they know. Left-out questions do not fail a check; they need this tick.
 */
export function canPublishNow(checks: HodCheck[], leftOut: number, confirmedLeftOut: boolean, waiting: boolean): boolean {
  return waiting && allChecksPass(checks) && (leftOut <= 0 || confirmedLeftOut);
}

/** The words next to the tick box. */
export function leftOutConfirmText(count: number): string {
  return count === 1
    ? 'I know 1 question is left out. It will not go live.'
    : `I know ${count} questions are left out. They will not go live.`;
}

/** "3 questions left out", "1 question left out", or null when none are. */
export function leftOutText(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? '1 question left out' : `${count} questions left out`;
}

/** The marks on the header against the marks of the passed questions, as a plain warning, or null when they agree or one is missing. */
export function marksMismatch(header: Pick<PreviewHeader, 'marks'>, fromQuestions: number | null): string | null {
  if (header.marks === null || fromQuestions === null) return null;
  if (Math.abs(header.marks - fromQuestions) < 0.0001) return null;
  return `The header says ${header.marks} marks, but the questions add up to ${fromQuestions}. Check which is right.`;
}

/** Depth of each row below its parent, for indenting sub-questions. */
export function questionDepths(qs: Pick<PreviewQuestion, 'id' | 'parent_id'>[]): Map<string, number> {
  const byId = new Map(qs.map((q) => [q.id, q]));
  const out = new Map<string, number>();
  for (const q of qs) {
    let d = 0;
    let p = q.parent_id;
    const seen = new Set<string>();
    while (p && byId.has(p) && !seen.has(p) && d < 4) {
      seen.add(p);
      d++;
      p = byId.get(p)?.parent_id ?? null;
    }
    out.set(q.id, d);
  }
  return out;
}

// ---------------------------------------------------------------- header fields

export type FieldKind = 'text' | 'number' | 'longtext' | 'yesno';

export type PublishField =
  | 'cls'
  | 'subject'
  | 'board'
  | 'year'
  | 'school'
  | 'exam'
  | 'marks'
  | 'allowed_time_minutes'
  | 'general_instructions'
  | 'incomplete_note'
  | 'is_board_paper';

export interface FieldDef {
  key: PublishField;
  label: string;
  kind: FieldKind;
  /** Can never be blank (the server refuses). */
  required?: boolean;
  hint?: string;
  placeholder?: string;
}

/** The header editor, before a paper goes live (hod_update_publish_meta). */
export const PUBLISH_FIELDS: FieldDef[] = [
  { key: 'cls', label: 'Class', kind: 'text', required: true, placeholder: 'For example X or XII' },
  { key: 'subject', label: 'Subject', kind: 'text', required: true },
  { key: 'board', label: 'Board', kind: 'text', required: true, placeholder: 'For example ICSE, ISC or CBSE' },
  { key: 'year', label: 'Year', kind: 'text', placeholder: 'For example 2024' },
  { key: 'school', label: 'School', kind: 'text', required: true },
  { key: 'exam', label: 'Exam', kind: 'text', placeholder: 'For example Prelims' },
  { key: 'is_board_paper', label: 'Board exam paper', kind: 'yesno', hint: 'Yes if the board set this paper, not a school.' },
  { key: 'marks', label: 'Total marks', kind: 'number', hint: 'A number from 0 to 1000.' },
  { key: 'allowed_time_minutes', label: 'Time allowed (minutes)', kind: 'number', hint: 'A whole number of minutes, 1 to 600.' },
  { key: 'general_instructions', label: 'General instructions', kind: 'longtext', hint: 'As printed on the paper.' },
  { key: 'incomplete_note', label: 'Note', kind: 'longtext', hint: 'Shown with the paper, for example if a page is missing.' },
];

/** The details of a paper that is already live (hod_edit_live_paper). */
export const LIVE_FIELDS: FieldDef[] = PUBLISH_FIELDS.filter((f) => f.key !== 'is_board_paper');

/** The header value as text for its input. */
export function headerText(h: PreviewHeader, key: PublishField): string {
  const v = h[key];
  if (v === null || v === undefined) return '';
  return typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v);
}

/** The first problem with a typed value, in plain words, or null. */
export function fieldProblem(def: FieldDef, value: string): string | null {
  const v = value.trim();
  if (def.required && v === '') return 'This cannot be left blank.';
  if (v === '') return null;
  if (def.key === 'marks') {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1000) return 'Total marks must be a number from 0 to 1000.';
  }
  if (def.key === 'allowed_time_minutes') {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 600) return 'Time allowed must be a whole number of minutes, from 1 to 600.';
  }
  return null;
}

/** What to send for a typed value. General instructions and notes go as typed; short fields are trimmed. */
export function fieldPayload(def: FieldDef, value: string): string {
  return def.kind === 'longtext' ? value : value.trim();
}

/** True when the typed value differs from what is saved. */
export function fieldDirty(def: FieldDef, typed: string, saved: string): boolean {
  return fieldPayload(def, typed) !== fieldPayload(def, saved);
}

// ----------------------------------------------------------------- Live papers

export interface HodLivePaper {
  paper_id: string;
  title: string;
  subject: string | null;
  cls: string | null;
  school: string | null;
  board: string | null;
  year: string | null;
  exam: string | null;
  marks: number | null;
  question_count: number;
  allowed_time_minutes: number | null;
  is_published: boolean;
  hidden_reason: string | null;
  hidden_at: string | null;
  hidden_by: string | null;
  audit_paper_id: string | null;
  from_pipeline: boolean;
  waiting_students: number;
  waiting_you: number;
  general_instructions: string | null;
  incomplete_note: string | null;
}

export function normaliseLivePapers(raw: unknown): HodLivePaper[] {
  const out: HodLivePaper[] = [];
  for (const x of asRows(raw)) {
    const r = obj(x);
    const id = str(r.paper_id);
    if (!id) continue;
    out.push({
      paper_id: id,
      title: paperTitleOf({ title: str(r.title), subject: str(r.subject), cls: str(r.cls), school: str(r.school) }),
      subject: str(r.subject),
      cls: str(r.cls),
      school: str(r.school),
      board: str(r.board),
      year: str(r.year),
      exam: str(r.exam),
      marks: numOrNull(r.marks),
      question_count: num(r.question_count),
      allowed_time_minutes: numOrNull(r.allowed_time_minutes),
      is_published: r.is_published === true,
      hidden_reason: str(r.hidden_reason),
      hidden_at: str(r.hidden_at),
      hidden_by: str(r.hidden_by),
      audit_paper_id: str(r.audit_paper_id),
      from_pipeline: bool(r.from_pipeline),
      waiting_students: num(r.waiting_students),
      waiting_you: num(r.waiting_you),
      general_instructions: str(r.general_instructions),
      incomplete_note: str(r.incomplete_note),
    });
  }
  return out;
}

export type LiveStatus = 'all' | 'live' | 'hidden';

export interface LiveFilter {
  status: LiveStatus;
  subject: string;
  cls: string;
  q: string;
}

export const NO_LIVE_FILTER: LiveFilter = { status: 'all', subject: '', cls: '', q: '' };

/** Live and Hidden, nothing else. */
export function liveCounts(rows: HodLivePaper[]): { live: number; hidden: number } {
  let live = 0;
  for (const r of rows) if (r.is_published) live++;
  return { live, hidden: rows.length - live };
}

export function filterLivePapers(rows: HodLivePaper[], f: LiveFilter): HodLivePaper[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.status === 'live' && !r.is_published) return false;
    if (f.status === 'hidden' && r.is_published) return false;
    if (f.subject && r.subject !== f.subject) return false;
    if (f.cls && r.cls !== f.cls) return false;
    if (q) {
      const hay = [r.title, r.school, r.exam, r.year, r.board].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** The distinct values of one column, sorted, for a filter's choices. */
export function distinctValues(rows: HodLivePaper[], pick: (r: HodLivePaper) => string | null): string[] {
  return [...new Set(rows.map(pick).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** How many rows a long list shows at first, and per "Show more". */
export const LIVE_PAGE = 40;

/** The words under a live row: what is still waiting on its questions. */
export function liveWaitingText(r: Pick<HodLivePaper, 'waiting_students' | 'waiting_you'>): string | null {
  const bits: string[] = [];
  if (r.waiting_students > 0) bits.push(`${r.waiting_students} with students`);
  if (r.waiting_you > 0) bits.push(`${r.waiting_you} waiting for you`);
  return bits.length ? `${bits.join(', ')}` : null;
}

// ------------------------------------------------------------- Student uploads

export type UploadStatus = 'all' | 'pending' | 'approved' | 'rejected';

export const UPLOAD_FILTERS: { key: UploadStatus; label: string }[] = [
  { key: 'pending', label: 'Waiting' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
];

export interface HodStudentUpload {
  id: string;
  created_at: string | null;
  school: string | null;
  board: string | null;
  cls: string | null;
  subject: string | null;
  year: string | null;
  exam_type: string | null;
  submitter_name: string | null;
  file_count: number;
  file_paths: string[];
  status: string;
  review_note: string | null;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
}

export function normaliseUploads(raw: unknown): HodStudentUpload[] {
  const out: HodStudentUpload[] = [];
  for (const x of asRows(raw)) {
    const r = obj(x);
    const id = str(r.id);
    if (!id) continue;
    const paths = strList(r.file_paths);
    out.push({
      id,
      created_at: str(r.created_at),
      school: str(r.school),
      board: str(r.board),
      cls: str(r.cls),
      subject: str(r.subject),
      year: str(r.year),
      exam_type: str(r.exam_type),
      submitter_name: str(r.submitter_name),
      file_count: num(r.file_count) || paths.length,
      file_paths: paths,
      status: str(r.status) ?? 'pending',
      review_note: str(r.review_note),
      reviewed_at: str(r.reviewed_at),
      reviewed_by_name: str(r.reviewed_by_name),
    });
  }
  return out;
}

export function uploadTitle(u: Pick<HodStudentUpload, 'subject' | 'cls' | 'board' | 'school' | 'year' | 'exam_type'>): string {
  const head = [u.board, u.cls ? `Class ${u.cls}` : null, u.subject].filter(Boolean).join(' ');
  return [head || 'Paper', u.school, u.exam_type, u.year].filter(Boolean).join(' · ');
}

export function uploadStatusWord(status: string): string {
  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Rejected';
  return 'Waiting';
}

/** Rejecting needs a reason the submitter can be told; approving needs none. */
export function uploadDecisionProblem(decision: 'approved' | 'rejected', note: string): string | null {
  if (decision === 'rejected' && note.trim() === '') return 'Say why it is rejected.';
  return null;
}

/** A readable file name from a storage path. */
export function fileNameOf(path: string): string {
  const last = path.split('/').filter(Boolean).pop() ?? path;
  return last.length > 48 ? `${last.slice(0, 22)}...${last.slice(-20)}` : last;
}

// ------------------------------------------------------------ AI trust: overall

export interface AiTrustOverall {
  checks_done: number;
  agreed: number;
  changed: number;
  threshold: number;
  reached: boolean;
  /** 0 to 1, or null when nothing has been checked. */
  agreement_rate: number | null;
}

export function normaliseTrustOverall(raw: unknown): AiTrustOverall {
  const r = obj(Array.isArray(raw) ? raw[0] : raw);
  const threshold = num(r.threshold) || 100;
  const done = num(r.checks_done);
  let rate = numOrNull(r.agreement_rate);
  // 0 to 100 is read as a percentage.
  if (rate !== null && rate > 1) rate = rate / 100;
  return {
    checks_done: done,
    agreed: num(r.agreed),
    changed: num(r.changed),
    threshold,
    reached: r.reached === true || (r.reached === undefined && done >= threshold),
    agreement_rate: done > 0 ? rate : null,
  };
}

/** The one sentence a card shows: "34 of 100 checks". Once the bar is met it reads "100 of 100 checks, reached", never "250 of 100". */
export function overallProgress(o: Pick<AiTrustOverall, 'checks_done' | 'threshold'>): string {
  if (o.checks_done >= o.threshold) return `${o.threshold} of ${o.threshold} checks, reached`;
  return `${o.checks_done} of ${o.threshold} checks`;
}

export function overallStatus(o: AiTrustOverall): string {
  return o.reached ? 'Reached' : 'Not reached yet';
}

/** What reaching the number unlocks, in one sentence, and what is true until then. */
export function overallUnlocks(o: AiTrustOverall): string {
  if (o.reached) {
    return 'The AI may now approve clean questions by itself. People still see every question it flags, and what students change keeps teaching it.';
  }
  const left = Math.max(0, o.threshold - o.checks_done);
  return `At ${o.threshold} checks the AI may approve clean questions by itself. Until then every question goes to students first (${left} more ${left === 1 ? 'check' : 'checks'} to go).`;
}

export function overallRateText(o: Pick<AiTrustOverall, 'agreement_rate'>): string {
  if (o.agreement_rate === null) return 'No checks yet';
  const pct = Math.round(o.agreement_rate * 1000) / 10;
  return `${Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(1)}%`;
}

// ------------------------------------------------------------ Why this paper?

export interface AssignmentReason {
  key: string;
  /** true = in their favour, false = a problem, null = neutral. */
  ok: boolean | null;
  text: string;
}

export interface AssignmentExplanation {
  eligible: boolean;
  score: number;
  summary: string;
  reasons: AssignmentReason[];
}

export function normaliseExplanation(raw: unknown): AssignmentExplanation {
  const r = obj(Array.isArray(raw) ? raw[0] : raw);
  return {
    eligible: r.eligible !== false,
    score: num(r.score),
    summary: str(r.summary) ?? '',
    reasons: list(r.reasons)
      .map((x) => obj(x))
      .map((x) => ({ key: str(x.key) ?? '', ok: x.ok === true ? true : x.ok === false ? false : null, text: str(x.text) ?? '' }))
      .filter((x) => x.text !== ''),
  };
}

/** A word to go with the tick, so colour is never the only signal. */
export function reasonMark(ok: boolean | null): string {
  return ok === true ? 'In their favour' : ok === false ? 'A problem' : 'Neutral';
}

// ----------------------------------------------------------------------- errors

/**
 * The server's own sentence, shown as written (the backend raises plain English). A stale
 * version (40001) gets a plain line of ours; anything with no message gets the fallback.
 */
export function errorWords(err: unknown, fallback = 'That did not go through. Nothing was changed. Try again.'): string {
  if (!err || typeof err !== 'object') return fallback;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code === '42501') return 'Your account is not set up for the HOD desk, so nothing was changed. Ask an admin to add you.';
  if (e.code === '40001') return 'Someone changed this question while you had it open, so nothing was saved. It has been refreshed.';
  const m = typeof e.message === 'string' ? e.message.trim() : '';
  return m || fallback;
}

// ------------------------------------------------------------------ Fix a question

export interface QuestionDraft {
  body: string;
  number: string;
  marks: string;
}

export type QuestionChangesResult = { error: string } | { changes: Record<string, unknown> };

/**
 * What a Fix sends (hod_edit_question's p_changes): only the keys that really changed, and
 * the words exactly as typed. Nothing here trims, cleans or re-cases question text. A number
 * or marks box emptied over a stored value is refused in words, because the server reads a
 * missing key as "keep".
 */
export function buildQuestionChanges(
  orig: { body: string; display_number: string | null; marks: number | null },
  draft: QuestionDraft,
): QuestionChangesResult {
  if (marksTextInvalid(draft.marks)) return { error: 'Marks must be a number, like 2 or 0.5.' };
  const number = draft.number.trim();
  const marks = draft.marks.trim();
  if (number === '' && (orig.display_number ?? '').trim() !== '') {
    return { error: 'The question number cannot be left empty. Type the number, or press Cancel to keep it as it was.' };
  }
  if (marks === '' && orig.marks != null) {
    return { error: 'Marks cannot be left empty. Type the marks, or press Cancel to keep them as they were.' };
  }
  if (draft.body !== orig.body && draft.body.trim() === '') return { error: 'The question needs its words. Type them, or press Cancel.' };
  const changes: Record<string, unknown> = {};
  if (draft.body !== orig.body) changes.body = draft.body;
  if (number !== (orig.display_number ?? '').trim()) changes.display_number = number;
  const newMarks = marks === '' ? null : Number(marks);
  if (newMarks !== orig.marks) changes.marks = newMarks;
  return { changes };
}
