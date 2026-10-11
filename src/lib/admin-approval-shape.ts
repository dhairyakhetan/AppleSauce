/**
 * The admin paper-approval flow (QUEUE_20261002, section B): types and the
 * normalisers that turn whatever the RPCs return into them.
 *
 * Pure, no Supabase client, so it is tested without a login. The RPC calls
 * themselves live in admin-approval.ts, the one module to edit if the backend
 * names a function or a field differently from the contract.
 *
 * The normalisers are deliberately forgiving: the backend migration is being
 * written in parallel, so a field that arrives under a near-synonym
 * ('total_questions' for 'questions_total', a before/after object instead of
 * a changes list) still lands in the right place, and a missing one becomes
 * a safe default rather than a crash.
 */

import type { ActorKind, FieldChange } from '@/lib/history-labels';
import { normaliseActorKind } from '@/lib/history-labels';

type Json = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);
const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const int0 = (v: unknown): number => num(v) ?? 0;
const pick = (o: Json, ...keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};
const asObj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// ---------------------------------------------------------------------------
// Queue

export type QueueKind = 'new' | 'retro';

export interface ApprovalQueueRow {
  audit_paper_id: string;
  title: string;
  board: string | null;
  cls: string | null;
  subject: string | null;
  school: string | null;
  year: string | null;
  questions_total: number;
  passed: number;
  open: number;
  set_aside: number;
  ai_summary: { pass: number; fix: number; student: number };
  queued_at: string | null;
  kind: QueueKind;
  live_bank_paper_id: string | null;
}

export function paperTitleFrom(p: { board?: string | null; cls?: string | null; subject?: string | null; year?: string | null }): string {
  const head = [p.board, p.cls ? `Class ${p.cls}` : null, p.subject].filter(Boolean).join(' ');
  return [head || 'Untitled paper', p.year].filter(Boolean).join(', ');
}

export function normaliseQueueRow(raw: unknown): ApprovalQueueRow {
  const r = asObj(raw);
  const ai = asObj(pick(r, 'ai_summary', 'ai'));
  const kindRaw = str(pick(r, 'kind', 'queue_kind'));
  const live = str(pick(r, 'live_bank_paper_id', 'bank_paper_id'));
  const base = {
    board: str(r.board),
    cls: str(pick(r, 'cls', 'class')),
    subject: str(r.subject),
    year: str(r.year),
  };
  return {
    audit_paper_id: str(pick(r, 'audit_paper_id', 'id')) ?? '',
    title: str(r.title) || paperTitleFrom(base),
    ...base,
    school: str(r.school),
    questions_total: int0(pick(r, 'questions_total', 'total_questions', 'questions', 'total')),
    passed: int0(pick(r, 'passed', 'passed_questions')),
    open: int0(pick(r, 'open', 'open_questions', 'open_count')),
    set_aside: int0(pick(r, 'set_aside', 'set_aside_questions', 'set_aside_count')),
    ai_summary: {
      pass: int0(pick(ai, 'pass', 'passed', 'ai_pass')),
      fix: int0(pick(ai, 'fix', 'fixed', 'ai_fix')),
      student: int0(pick(ai, 'student', 'kid', 'to_student')),
    },
    queued_at: str(pick(r, 'queued_at', 'created_at')),
    kind: kindRaw === 'retro' ? 'retro' : 'new',
    live_bank_paper_id: live,
  };
}

/** One paper already decided in Ready to go live (admin_approval_history). */
export interface ApprovalHistoryRow {
  audit_paper_id: string;
  title: string;
  kind: QueueKind;
  state: 'approved' | 'rejected';
  by_name: string | null;
  at: string | null;
  note: string | null;
  live_bank_paper_id: string | null;
}

export function normaliseHistoryRow(raw: unknown): ApprovalHistoryRow {
  const r = asObj(raw);
  return {
    audit_paper_id: str(r.audit_paper_id) ?? '',
    title: str(r.title) || 'Untitled paper',
    kind: str(r.kind) === 'retro' ? 'retro' : 'new',
    state: str(r.state) === 'rejected' ? 'rejected' : 'approved',
    by_name: str(r.by_name),
    at: str(r.at),
    note: str(r.note),
    live_bank_paper_id: str(r.live_bank_paper_id),
  };
}

/** Ready means nothing is open: every question ended passed or set aside. */
export function isReady(row: Pick<ApprovalQueueRow, 'open'>): boolean {
  return row.open === 0;
}

// ---------------------------------------------------------------------------
// One paper under review

/** passed and set_aside are the two ends; open blocks approval. */
export type QuestionState = 'passed' | 'open' | 'set_aside';

export function questionState(status: string | null | undefined, passed?: boolean | null): QuestionState {
  const s = (status ?? '').toLowerCase();
  if (s === 'set_aside' || s === 'rejected' || s === 'skipped' || s === 'held') return 'set_aside';
  if (s === 'passed' || s === 'approved' || passed === true) return 'passed';
  return 'open';
}

export type RowKind = 'question' | 'section_break' | 'master_instruction' | 'section_instruction';

export interface ReviewOption {
  label: string | null;
  text: string;
}

export interface ReviewRow {
  id: string;
  kind: RowKind;
  ord: number;
  parent_id: string | null;
  display_number: string | null;
  number_path: string | null;
  body: string;
  options: ReviewOption[];
  marks: number | null;
  instructions: string | null;
  figure: string | null;
  state: QuestionState;
  version: number;
  flag_reasons: string[];
  flag_detail: string | null;
  review_bucket: string | null;
  live_bank_question_id: string | null;
  /** Why an admin set it aside (admin_set_question_state's note). */
  set_aside_reason: string | null;
}

export interface ReviewPaper {
  audit_paper_id: string;
  title: string;
  board: string | null;
  cls: string | null;
  subject: string | null;
  school: string | null;
  year: string | null;
  exam: string | null;
  kind: QueueKind;
  live_bank_paper_id: string | null;
  /** On the site right now (admin_paper_review's paper.is_live). */
  is_published: boolean;
  /** approval_state: 'awaiting' reads as 'pending'. */
  approval: 'approved' | 'rejected' | 'pending';
  general_instructions: string | null;
  allowed_time_minutes: number | null;
  /** The note left with the last approve or send-back. */
  approval_note: string | null;
}

export interface PaperReview {
  paper: ReviewPaper;
  rows: ReviewRow[];
  open_count: number;
}

export function normaliseOptions(raw: unknown): ReviewOption[] {
  return asArr(raw)
    .map((o): ReviewOption | null => {
      if (typeof o === 'string') return o.trim() ? { label: null, text: o } : null;
      const r = asObj(o);
      const text = str(r.text) ?? '';
      const label = str(r.label);
      return text.trim() || label ? { label: label && label.trim() ? label : null, text } : null;
    })
    .filter((o): o is ReviewOption => o !== null);
}

const ROW_KINDS: RowKind[] = ['question', 'section_break', 'master_instruction', 'section_instruction'];

export function normaliseReviewRow(raw: unknown, i: number): ReviewRow {
  const r = asObj(raw);
  const kind = str(r.kind) as RowKind | null;
  const flags = asArr(r.flag_reasons).map((f) => str(f)).filter((f): f is string => !!f);
  return {
    id: str(pick(r, 'id', 'question_id')) ?? `row-${i}`,
    kind: kind && ROW_KINDS.includes(kind) ? kind : 'question',
    ord: num(r.ord) ?? i,
    parent_id: str(pick(r, 'parent_id', 'parent_question_id')),
    display_number: str(r.display_number),
    number_path: str(pick(r, 'number_path', 'number')),
    body: str(r.body) ?? '',
    options: normaliseOptions(r.options),
    marks: num(r.marks),
    instructions: str(r.instructions),
    // admin_paper_review sends figure as an object and figure_path as its path.
    figure: str(r.figure_path) ?? str(r.figure),
    state: questionState(str(pick(r, 'state', 'status')), r.question_passed === true),
    version: num(pick(r, 'version', 'current_version')) ?? 1,
    flag_reasons: flags,
    flag_detail: str(r.flag_detail),
    review_bucket: str(r.review_bucket),
    live_bank_question_id: str(r.live_bank_question_id),
    set_aside_reason: str(r.set_aside_reason),
  };
}

export function normaliseReview(raw: unknown): PaperReview {
  const r = asObj(raw);
  const p = asObj(pick(r, 'paper', 'meta'));
  const rows = asArr(pick(r, 'rows', 'questions'))
    .map(normaliseReviewRow)
    .sort((a, b) => a.ord - b.ord);
  const base = { board: str(p.board), cls: str(pick(p, 'cls', 'class')), subject: str(p.subject), year: str(p.year) };
  const approvalRaw = str(pick(p, 'approval', 'final_verdict', 'approval_state'));
  const live = str(pick(p, 'live_bank_paper_id', 'bank_paper_id'));
  const openFromRows = rows.filter((x) => x.kind === 'question' && x.state === 'open').length;
  return {
    paper: {
      audit_paper_id: str(pick(p, 'audit_paper_id', 'id')) ?? '',
      title: str(p.title) || paperTitleFrom(base),
      ...base,
      school: str(p.school),
      exam: str(pick(p, 'exam', 'exam_type')),
      kind: str(p.kind) === 'retro' ? 'retro' : 'new',
      live_bank_paper_id: live,
      is_published: p.is_live === true || p.is_published === true,
      approval: approvalRaw === 'approved' || approvalRaw === 'rejected' ? approvalRaw : 'pending',
      general_instructions: str(pick(p, 'general_instructions', 'instructions')),
      allowed_time_minutes: num(p.allowed_time_minutes),
      approval_note: str(p.approval_note),
    },
    rows,
    open_count: num(pick(r, 'open_count', 'open')) ?? num(asObj(r.counts).open) ?? openFromRows,
  };
}

/** Passed / open / set aside counts over the question rows. */
export function reviewCounts(rows: ReviewRow[]): { total: number; passed: number; open: number; set_aside: number } {
  const qs = rows.filter((r) => r.kind === 'question');
  return {
    total: qs.length,
    passed: qs.filter((r) => r.state === 'passed').length,
    open: qs.filter((r) => r.state === 'open').length,
    set_aside: qs.filter((r) => r.state === 'set_aside').length,
  };
}

// ---------------------------------------------------------------------------
// History

export interface HistoryEvent {
  at: string;
  actor_name: string | null;
  actor_kind: ActorKind;
  action: string;
  model: string | null;
  question_id: string | null;
  question_label: string | null;
  changes: FieldChange[];
  note: string | null;
  verdict: string | null;
  confidence: number | null;
  version: number | null;
  to_version: number | null;
  /** The person who did this took it back (Undo last). Only present when true. */
  undone?: boolean;
}

export interface QuestionVersion {
  version: number;
  body: string;
  options: ReviewOption[];
  marks: number | null;
  display_number: string | null;
  instructions: string | null;
  created_at: string;
  actor_name: string | null;
  actor_kind: ActorKind;
  action: string | null;
  note: string | null;
  /** What changed since the version before, when the server sends it. */
  changes: FieldChange[] | null;
  /** Set when this version is an admin's restore of an older one. */
  restored_from_version: number | null;
}

export interface QuestionCheck {
  checker_kind: string;
  model: string | null;
  verdict: string;
  confidence: number | null;
  at: string | null;
  actor_name: string | null;
}

export interface QuestionHistory {
  versions: QuestionVersion[];
  events: HistoryEvent[];
  checks: QuestionCheck[];
}

/** before/after objects (audit_review_log's shape) into a change list. */
export function changesFrom(r: Json): FieldChange[] {
  const list = asArr(r.changes);
  if (list.length) {
    return list
      .map((c) => asObj(c))
      .filter((c) => typeof c.field === 'string')
      .map((c) => ({ field: c.field as string, before: c.before ?? null, after: c.after ?? null }));
  }
  // {changes: {body: {before, after}}}
  const asMap = asObj(r.changes);
  if (Object.keys(asMap).length) {
    return Object.entries(asMap).map(([field, v]) => {
      const o = asObj(v);
      return { field, before: o.before ?? null, after: o.after ?? null };
    });
  }
  const field = str(r.field);
  const before = r.before;
  const after = r.after;
  const bObj = before && typeof before === 'object' && !Array.isArray(before) ? (before as Json) : null;
  const aObj = after && typeof after === 'object' && !Array.isArray(after) ? (after as Json) : null;
  if (bObj || aObj) {
    const keys = Array.from(new Set([...Object.keys(bObj ?? {}), ...Object.keys(aObj ?? {})]));
    return keys
      .filter((k) => JSON.stringify(bObj?.[k] ?? null) !== JSON.stringify(aObj?.[k] ?? null))
      .map((k) => ({ field: k, before: bObj?.[k] ?? null, after: aObj?.[k] ?? null }));
  }
  if (field && (before !== undefined || after !== undefined)) {
    return [{ field, before: before ?? null, after: after ?? null }];
  }
  return [];
}

export function normaliseEvent(raw: unknown): HistoryEvent {
  const r = asObj(raw);
  return {
    at: str(pick(r, 'at', 'created_at')) ?? new Date(0).toISOString(),
    actor_name: str(pick(r, 'actor_name', 'actor_label')),
    actor_kind: normaliseActorKind(str(r.actor_kind)),
    action: str(r.action) ?? '',
    model: str(pick(r, 'model', 'checker_kind')),
    question_id: str(r.question_id),
    question_label: str(pick(r, 'question_label', 'display_number', 'question_number')),
    changes: changesFrom(r),
    note: str(r.note),
    verdict: str(r.verdict),
    confidence: num(r.confidence),
    version: num(r.version),
    to_version: num(pick(r, 'to_version', 'restored_version')),
    ...(r.undone === true ? { undone: true } : {}),
  };
}

export function normaliseVersion(raw: unknown): QuestionVersion {
  const r = asObj(raw);
  const snap = { ...r, ...asObj(r.snapshot) };
  return {
    version: num(r.version) ?? 0,
    body: str(snap.body) ?? '',
    options: normaliseOptions(snap.options),
    marks: num(snap.marks),
    display_number: str(snap.display_number),
    instructions: str(snap.instructions),
    created_at: str(pick(r, 'created_at', 'at')) ?? new Date(0).toISOString(),
    actor_name: str(pick(r, 'actor_name', 'actor_label')),
    actor_kind: normaliseActorKind(str(r.actor_kind)),
    action: str(pick(r, 'action', 'op')),
    note: str(pick(r, 'note', 'reason')),
    changes: Array.isArray(r.changes) ? changesFrom(r) : null,
    restored_from_version: num(r.restored_from_version),
  };
}

export function normaliseQuestionHistory(raw: unknown): QuestionHistory {
  const r = asObj(raw);
  return {
    versions: asArr(r.versions).map(normaliseVersion).sort((a, b) => a.version - b.version),
    events: asArr(r.events)
      .map(normaliseEvent)
      .sort((a, b) => b.at.localeCompare(a.at)),
    checks: asArr(r.checks).map((c) => {
      const o = asObj(c);
      return {
        checker_kind: str(o.checker_kind) ?? 'admin',
        model: str(o.model),
        verdict: str(o.verdict) ?? '',
        confidence: num(o.confidence),
        at: str(pick(o, 'at', 'created_at')),
        actor_name: str(o.actor_name),
      };
    }),
  };
}

export function normalisePaperHistory(raw: unknown): HistoryEvent[] {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? asObj(raw).events : raw;
  return asArr(r)
    .map(normaliseEvent)
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** What changed between two versions of one question, as field changes. */
export function versionChanges(older: QuestionVersion | null, newer: QuestionVersion): FieldChange[] {
  // admin_question_full_history sends each version's own changes; trust it.
  if (newer.changes) return newer.changes;
  if (!older) return [];
  const out: FieldChange[] = [];
  if (older.body !== newer.body) out.push({ field: 'body', before: older.body, after: newer.body });
  if (older.display_number !== newer.display_number)
    out.push({ field: 'display_number', before: older.display_number, after: newer.display_number });
  if (older.marks !== newer.marks) out.push({ field: 'marks', before: older.marks, after: newer.marks });
  if (older.instructions !== newer.instructions)
    out.push({ field: 'instructions', before: older.instructions, after: newer.instructions });
  if (JSON.stringify(older.options) !== JSON.stringify(newer.options))
    out.push({ field: 'options', before: older.options, after: newer.options });
  return out;
}

// ---------------------------------------------------------------------------
// Edits

/** The fields an admin edits on the review page; only changed ones are sent. */
export interface QuestionChanges {
  body?: string;
  display_number?: string | null;
  marks?: number | null;
  options?: ReviewOption[];
}

/** The inline editor's working copy of one question. */
export type Draft = { body: string; number: string; marks: string; options: ReviewOption[] };

export function draftOf(row: ReviewRow): Draft {
  return {
    body: row.body,
    number: row.display_number ?? '',
    marks: row.marks === null ? '' : String(row.marks),
    options: row.options.map((o) => ({ ...o })),
  };
}

/** Only the fields that actually changed, in the contract's p_changes shape. */
export function changesFromDraft(row: ReviewRow, d: Draft): QuestionChanges | 'bad-marks' {
  const out: QuestionChanges = {};
  if (d.body !== row.body) out.body = d.body;
  const num = d.number.trim() === '' ? null : d.number.trim();
  if (num !== (row.display_number ?? null)) out.display_number = num;
  const m = d.marks.trim();
  if (m !== '' && !/^\d+(\.\d+)?$/.test(m)) return 'bad-marks';
  const marks = m === '' ? null : Number(m);
  if (marks !== row.marks) out.marks = marks;
  if (JSON.stringify(d.options) !== JSON.stringify(row.options)) out.options = d.options;
  return out;
}

export interface ApprovalApi {
  queue(): Promise<ApprovalQueueRow[]>;
  /** Papers already approved or rejected, newest first. */
  history(): Promise<ApprovalHistoryRow[]>;
  review(auditPaperId: string): Promise<PaperReview>;
  /** Returns the live bank paper id. */
  approve(auditPaperId: string, note: string): Promise<string | null>;
  reject(auditPaperId: string, note: string): Promise<void>;
  unpublish(bankPaperId: string, note: string): Promise<void>;
  /** Returns the new version number. */
  editQuestion(questionId: string, version: number, changes: QuestionChanges, note: string): Promise<number | null>;
  revertQuestion(questionId: string, toVersion: number, note: string): Promise<number | null>;
  questionHistory(questionId: string): Promise<QuestionHistory>;
  paperHistory(auditPaperId: string): Promise<HistoryEvent[]>;
  /** Pass, set aside (note required) or reopen one question while the paper waits. Returns the new state. */
  setQuestionState(questionId: string, state: 'pass' | 'set_aside' | 'reopen', note: string): Promise<QuestionState>;
  /** Undo of unpublish: admin_restore_bank_paper. */
  restorePaper(bankPaperId: string): Promise<void>;
}

/** A version number out of whatever an RPC returned: 4, "4", {version: 4}. */
export function versionFrom(data: unknown): number | null {
  const direct = num(data);
  if (direct !== null) return direct;
  const o = asObj(Array.isArray(data) ? data[0] : data);
  return num(pick(o, 'version', 'new_version', 'admin_edit_question', 'admin_revert_question'));
}

/** A server message a person can read as it is: a sentence, no codes or ids. */
function readable(message: string | null): string | null {
  const m = (message ?? '').trim();
  if (!m || m.length > 200) return null;
  if (/[{}[\]]|\b[a-z]+_[a-z_]+\b|[0-9a-f]{8}-[0-9a-f]{4}-/i.test(m)) return null;
  return /[.!?]$/.test(m) ? m : `${m}.`;
}

/**
 * Plain words for a failed write, never the server's code.
 *   42501  not an admin
 *   40001  someone else changed the question first (stale version)
 *   55000  a refusal written for people ("This paper is already off the site"): shown as it is
 *   22023  a field that cannot be edited here, or a missing note
 */
export function writeErrorWords(e: unknown, fallback: string): string {
  const o = asObj(e);
  const raw = str(o.message);
  const msg = `${raw ?? ''} ${str(o.details) ?? ''} ${str(o.hint) ?? ''}`.toLowerCase();
  const code = str(o.code) ?? '';
  if (code === '42501' || msg.includes('not authorized')) return 'Your account is not allowed to do this. Sign in as an admin and try again.';
  if (code === '40001')
    return 'Someone else changed this question while you were editing. Reload to see their version, then try again.';
  if (code === '55000') return readable(raw) ?? fallback;
  if (code === '22023') {
    if (/cannot be edited here/.test(msg))
      return 'Only the question text, number, marks, instructions and answer choices can be changed here.';
    return readable(raw) ?? fallback;
  }
  if (code === 'P0002') return readable(raw) ?? 'That was not found. Reload the page and try again.';
  if (/still open|open question/.test(msg)) return 'Some questions are still open. Each one must be passed or set aside first.';
  if (/version|stale|conflict|changed since/.test(msg))
    return 'Someone else changed this question while you were editing. Reload to see their version, then try again.';
  return fallback;
}

// ---------------------------------------------------------------------------
// Admin rework, Batch 4: one place for the words and rules the approval pages share

export type RowTone = 'live' | 'pending' | 'paused';

/** The one status every surface reads: the pill, the filter chips and the counts.
 *  A paper already on the site with open questions says so ("Live, 2 open"), so it
 *  is never shown as a plain green "Already live" next to questions that need a person. */
export function rowStatus(r: Pick<ApprovalQueueRow, 'kind' | 'open'>): { tone: RowTone; label: string; ready: boolean } {
  const ready = isReady(r);
  if (r.kind === 'retro') {
    return ready ? { tone: 'live', label: 'Live, ready', ready } : { tone: 'pending', label: `Live, ${r.open} open`, ready };
  }
  return ready ? { tone: 'pending', label: 'Ready', ready } : { tone: 'paused', label: `${r.open} open`, ready };
}

/** Approving a paper that is already on the site only records the yes
 *  (admin_approve_paper: for a retro paper "approval is a record, nothing moves"). */
export function isRecordOnly(p: Pick<ReviewPaper, 'kind' | 'live_bank_paper_id'>): boolean {
  return p.kind === 'retro' || Boolean(p.live_bank_paper_id);
}

export interface ApproveCopy {
  title: string;
  body: string;
  button: string;
  busy: string;
  toast: string;
}

export function approveCopy(kind: QueueKind): ApproveCopy {
  if (kind === 'retro') {
    return {
      title: 'Record your approval?',
      body: 'This paper is already on the site. Approving records your yes in the history. Nothing on the site changes.',
      button: 'Record approval',
      busy: 'Recording...',
      toast: 'Approval recorded. The paper was already live, so nothing on the site changed.',
    };
  }
  return {
    title: 'Approve this paper for launch?',
    body: 'Passed questions go on the site straight away. Set-aside questions show as a short placeholder card with no text. You can take the paper off the site later.',
    button: 'Approve for launch',
    busy: 'Approving...',
    toast: 'Paper approved. It is now on the site.',
  };
}

/** What an admin may do to a question on this paper (admin_set_question_state):
 *  while the paper waits, pass, set aside or reopen; once approved, pass only
 *  (a late pass); after a send-back, nothing. */
export type ResolveMode = 'full' | 'pass-only' | 'none';

export function resolveMode(approval: ReviewPaper['approval']): ResolveMode {
  return approval === 'pending' ? 'full' : approval === 'approved' ? 'pass-only' : 'none';
}

/** The queue, oldest waiting first. Rows with no date go last. */
export function oldestFirst<T extends Pick<ApprovalQueueRow, 'queued_at'>>(rows: T[]): T[] {
  const t = (r: T) => (r.queued_at ? new Date(r.queued_at).getTime() : Number.POSITIVE_INFINITY);
  return [...rows].sort((a, b) => t(a) - t(b));
}

/** The next paper to look at after a decision: the oldest ready one, not the one just done. */
export function nextWaitingPaper<T extends Pick<ApprovalQueueRow, 'audit_paper_id' | 'queued_at' | 'open'>>(
  rows: T[],
  excludeId: string,
): T | null {
  return oldestFirst(rows).find((r) => r.audit_paper_id !== excludeId && isReady(r)) ?? null;
}

/** The next paper to look at: a paper, nothing left, or "could not check". A failed
 *  read of the queue must never be reported as "nothing else is ready". */
export type NextPaperLookup<T> = T | null | 'unknown';

export async function lookupNextWaiting<T extends Pick<ApprovalQueueRow, 'audit_paper_id' | 'queued_at' | 'open'>>(
  readQueue: () => Promise<T[]>,
  excludeId: string,
): Promise<NextPaperLookup<T>> {
  try {
    return nextWaitingPaper(await readQueue(), excludeId);
  } catch {
    return 'unknown';
  }
}

/** How many decided papers the history reads. The list is capped, so a full
 *  list must say that older decisions are not shown. */
export const HISTORY_LIMIT = 200;

export function historyCapNote(count: number): string | null {
  return count >= HISTORY_LIMIT ? `Showing the latest ${HISTORY_LIMIT} decisions. Older ones are not listed here.` : null;
}

/** What the open-questions banner says about what can be done with them. A sent
 *  back paper still lets the text be fixed (the server allows it); it only
 *  refuses to pass or set aside. */
export function openQuestionsAdvice(mode: ResolveMode): string {
  if (mode === 'full') return 'Each must be passed or set aside before this paper can be approved.';
  if (mode === 'pass-only') return 'This paper is approved, so each one can be passed but not set aside.';
  return 'This paper was sent back, so its questions cannot be passed or set aside here. The text can still be fixed with Edit.';
}

/** Why the Approve button is shut, in words. Undefined when it is open. */
export function approveClosedReason(s: { open: number; approved: boolean; rejected: boolean }): string | undefined {
  if (s.rejected) return 'This paper was sent back, so approval is closed for it.';
  if (s.approved) return 'This paper is already approved.';
  if (s.open > 0) return 'Pass or set aside the open questions first.';
  return undefined;
}
