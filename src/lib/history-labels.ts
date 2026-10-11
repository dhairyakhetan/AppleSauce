/**
 * History in people's words (owner, 2026-10-02): "I don't want coded text. I
 * want friendly user interface friendly text. That this user edited this. And
 * that user edited this."
 *
 * This is the ONE file that turns the database's codes into words for the
 * admin approval pages: action codes ('admin_edit', 'checker_pass'), checker
 * kinds ('haiku_paddle', 'sonnet'), field names ('display_number'), review
 * piles ('kid'), verdicts ('printed_typo') and actor kinds. A raw code never
 * reaches the screen: every lookup has a plain fallback, and
 * history-labels.test.ts checks that every code the database is known to emit
 * has its own label and that no finished line carries a uuid, a brace, an
 * underscore code or an 'ai:' prefix.
 *
 * Pure (no React, no Supabase), so it is tested without a login.
 * No em or en dashes anywhere in the copy.
 */

import { format, formatDistance, isSameYear } from 'date-fns';

// ---------------------------------------------------------------------------
// Who

export type ActorKind = 'admin' | 'student' | 'ai' | 'pipeline';

export const ACTOR_KINDS: readonly ActorKind[] = ['admin', 'student', 'ai', 'pipeline'];

/** Older rows say 'checker' for a student checker and 'system' for a script. */
const ACTOR_KIND_ALIASES: Record<string, ActorKind> = {
  admin: 'admin',
  student: 'student',
  checker: 'student',
  kid: 'student',
  ai: 'ai',
  pipeline: 'pipeline',
  system: 'pipeline',
  script: 'pipeline',
};

export function normaliseActorKind(kind: string | null | undefined): ActorKind {
  return ACTOR_KIND_ALIASES[(kind ?? '').trim().toLowerCase()] ?? 'pipeline';
}

/** The AI models, by every spelling the pipeline writes. */
export const MODEL_LABELS: Record<string, string> = {
  haiku: 'Haiku',
  haiku_paddle: 'Haiku',
  haiku_pdf: 'Haiku',
  sonnet: 'Sonnet',
  opus: 'Opus',
};

/** checker_kind values from content_checks (20261001090000). */
export const CHECKER_KIND_LABELS: Record<string, string> = {
  haiku: 'AI check (Haiku)',
  haiku_paddle: 'AI check (Haiku, from the scan)',
  haiku_pdf: 'AI check (Haiku, from the page)',
  sonnet: 'AI check (Sonnet)',
  student: 'Student checker',
  admin: 'Admin',
};

/**
 * "Haiku", "Sonnet" or "Opus" from whatever the row carries: 'sonnet',
 * 'haiku_pdf', 'ai:haiku+haiku', 'claude-sonnet-4-5'. Null when it names no
 * model we know, so the caller can say plain "AI check".
 */
export function modelName(raw: string | null | undefined): string | null {
  const s = (raw ?? '').toLowerCase();
  if (!s) return null;
  if (MODEL_LABELS[s]) return MODEL_LABELS[s];
  if (s.includes('sonnet')) return 'Sonnet';
  if (s.includes('opus')) return 'Opus';
  if (s.includes('haiku')) return 'Haiku';
  return null;
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * A person's name as the server resolved it (profiles.full_name, else the
 * email's local part). Defensive anyway: an email becomes its local part, a
 * uuid or a code becomes nothing, so the caller falls back to "An admin".
 */
/** The server's own role words when it has no name (history_person_name). */
const GENERIC_NAMES = new Set(['an admin', 'a student checker']);

export function cleanPersonName(raw: string | null | undefined): string | null {
  let s = (raw ?? '').trim();
  if (!s) return null;
  if (GENERIC_NAMES.has(s.toLowerCase())) return null;
  if (s.startsWith('[email]')) return null;
  if (s.includes('@')) s = s.split('@')[0];
  if (UUID_RE.test(s) || /^[0-9a-f]{8,}$/i.test(s)) return null;
  if (/^(ai|system|pipeline|script)(:|$)/i.test(s)) return null;
  s = s.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  // "priya sharma" -> "Priya Sharma" only when it came in all lower case
  // (an email local part); a real full_name keeps its own casing.
  if (s === s.toLowerCase()) s = s.replace(/\b\w/g, (c) => c.toUpperCase());
  return s;
}

export interface ActorInput {
  actor_kind?: string | null;
  actor_name?: string | null;
  model?: string | null;
  checker_kind?: string | null;
}

/** Who did it, as the start of a sentence. */
export function actorLabel(a: ActorInput): string {
  const kind = a.checker_kind
    ? a.checker_kind === 'student'
      ? 'student'
      : a.checker_kind === 'admin'
        ? 'admin'
        : 'ai'
    : normaliseActorKind(a.actor_kind);
  if (kind === 'ai') {
    const m = modelName(a.model) ?? modelName(a.checker_kind) ?? modelName(a.actor_name);
    return m ? `AI check (${m})` : 'AI check';
  }
  if (kind === 'pipeline') return 'Pipeline (automatic)';
  const name = cleanPersonName(a.actor_name);
  if (kind === 'student') return name ? `${name} (student checker)` : 'A student checker';
  return name ?? 'An admin';
}

// ---------------------------------------------------------------------------
// What field

/** Every column a history row can name, in words. */
export const FIELD_LABELS: Record<string, string> = {
  body: 'the question text',
  display_number: 'the question number',
  number: 'the question number',
  number_path: 'the question number',
  marks: 'the marks',
  options: 'the answer choices',
  instructions: 'the question instructions',
  figure: 'the picture',
  figure_path: 'the picture',
  chapter: 'the chapter',
  qtype: 'the question type',
  kind: 'the kind of row',
  parent_id: 'which question it is part of',
  parent_question_id: 'which question it is part of',
  section_label: 'the section heading',
  alternative_group: 'the OR choice',
  alternative_label: 'the OR choice',
  suggested_time_minutes: 'the suggested time',
  ord: 'its place in the paper',
  status: 'the status',
  question_passed: 'the check result',
  review_bucket: 'who checks it next',
  flag_reasons: 'the reasons it was flagged',
  flag_detail: 'the reasons it was flagged',
  answer_key: 'the answer key',
  answer_text: 'the answer',
  // paper level
  title: 'the paper title',
  school: 'the school',
  subject: 'the subject',
  cls: 'the class',
  class: 'the class',
  exam_type: 'the exam',
  max_marks: 'the total marks',
  board: 'the board',
  year: 'the year',
  exam: 'the exam',
  general_instructions: 'the paper instructions',
  allowed_time_minutes: 'the time allowed',
  incomplete_note: 'the incomplete paper note',
  is_published: 'whether it is on the site',
  needs_review: 'whether it needs review',
  paper_passed: 'whether the paper passed',
  is_red: 'the problem flag',
  red_reason: 'the problem note',
  live_bank_paper_id: 'the link to the live paper',
  live_bank_question_id: 'the link to the live question',
};

export function fieldLabel(field: string | null | undefined): string {
  const f = (field ?? '').trim();
  return FIELD_LABELS[f] ?? 'a detail';
}

/**
 * Fields whose before/after values are ids, links or bookkeeping. The
 * sentence still names them ("changed which question it is part of"), but
 * their values are never drawn: they would be uuids or codes.
 */
export const VALUE_HIDDEN_FIELDS = new Set([
  'parent_id',
  'parent_question_id',
  'live_bank_paper_id',
  'live_bank_question_id',
  'flag_reasons',
  'flag_detail',
  'answer_key',
  'ord',
  'kind',
  'alternative_group',
]);

/** The changes worth drawing as before/after: known fields with readable values. */
export function shownChanges(changes: FieldChange[] | null | undefined): FieldChange[] {
  return (changes ?? []).filter((c) => FIELD_LABELS[c.field] !== undefined && !VALUE_HIDDEN_FIELDS.has(c.field));
}

/** Fields that read as text and get a word diff, not a "from X to Y". */
export const TEXT_FIELDS = new Set([
  'body',
  'options',
  'instructions',
  'general_instructions',
  'incomplete_note',
  'answer_text',
  'red_reason',
]);

// ---------------------------------------------------------------------------
// Values

/** review_bucket values (audit_questions check constraint). */
export const REVIEW_BUCKET_LABELS: Record<string, string> = {
  kid: 'student checkers',
  admin: 'admins',
  data: 'the data team',
  renderer: 'the display team',
  none: 'nobody, it is done',
  escalated: 'an admin (sent up for help)',
};

/** content_checks.verdict values, as a predicate about a question. */
export const VERDICT_LABELS: Record<string, (q: string) => string> = {
  pass: (q) => `passed ${q}`,
  fix: (q) => `suggested a fix to ${q}`,
  printed_typo: (q) => `found a typo printed on the paper in ${q}`,
  escalate: (q) => `sent ${q} to an admin`,
  flag: (q) => `flagged ${q}`,
};

export function verdictWords(verdict: string | null | undefined, q: string): string {
  const fn = VERDICT_LABELS[(verdict ?? '').trim()];
  return fn ? fn(q) : `checked ${q}`;
}

/** audit_questions.status values, plus the approval flow's own. */
export const STATUS_LABELS: Record<string, string> = {
  pending: 'waiting to be checked',
  open: 'waiting to be checked',
  flagged: 'flagged',
  passed: 'passed',
  approved: 'approved',
  rejected: 'rejected',
  set_aside: 'set aside',
  held: 'held back',
};

function optionText(o: unknown): string {
  if (typeof o === 'string') return o;
  if (o && typeof o === 'object') {
    const r = o as { label?: unknown; text?: unknown };
    const text = typeof r.text === 'string' ? r.text : '';
    const label = typeof r.label === 'string' && r.label.trim() ? `(${r.label.trim()}) ` : '';
    return `${label}${text}`.trim();
  }
  return '';
}

/**
 * Any stored value as words a person reads. Strings are verbatim (question
 * text is never altered). Arrays of options become one choice per line. An
 * object we cannot describe becomes "a different value", never json.
 */
export function valueWords(field: string | null | undefined, v: unknown): string {
  if (v === null || v === undefined || v === '') return 'nothing';
  const f = field ?? '';
  if (f === 'review_bucket' && typeof v === 'string') return REVIEW_BUCKET_LABELS[v] ?? 'another pile';
  if (f === 'status' && typeof v === 'string') return STATUS_LABELS[v] ?? 'another status';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') {
    if (f === 'marks') return `${v} ${v === 1 ? 'mark' : 'marks'}`;
    if (f.endsWith('_minutes')) return `${v} min`;
    return String(v);
  }
  if (typeof v === 'string') {
    if (f === 'marks' && /^\d+(\.\d+)?$/.test(v)) return `${v} ${v === '1' ? 'mark' : 'marks'}`;
    return v;
  }
  if (Array.isArray(v)) {
    const lines = v.map(optionText).filter((s) => s !== '');
    return lines.length ? lines.join('\n') : 'nothing';
  }
  return 'a different value';
}

// ---------------------------------------------------------------------------
// What happened

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface HistoryEventInput extends ActorInput {
  at: string;
  action: string;
  /** "5", "5(a)": the question this row is about, in a whole-paper history. */
  question_label?: string | null;
  changes?: FieldChange[] | null;
  note?: string | null;
  verdict?: string | null;
  /** 0..1 or 0..100. */
  confidence?: number | null;
  version?: number | null;
  to_version?: number | null;
  /** True when the person who did this took it back (verifier Undo last). The row stays in history. */
  undone?: boolean;
}

/** Put "(undone)" after a history sentence for a row that was taken back. */
export function markUndone(text: string, undone: boolean | null | undefined): string {
  return undone ? `${text} (undone)` : text;
}

type Ctx = {
  /** "this question" or "question 5" */
  q: string;
  /** " on question 5" or "" */
  on: string;
  changes: string | null;
  /** "passed this question", from the row's verdict */
  verdict: string;
  conf: string;
  toVersion: string;
};

/**
 * Every action code the database writes to audit_review_log, content_checks,
 * the content_versions log or admin_activity_feed, as the rest of a sentence
 * that starts with who did it. The fallback for an unknown code is generic
 * words, never the code itself.
 */
export const ACTION_LABELS: Record<string, (c: Ctx) => string> = {
  // the approval flow (QUEUE_20261002 contract)
  admin_approve: () => 'approved the paper for launch',
  admin_retro_approve: () => 'approved the paper, which was already live',
  admin_reject: () => 'sent the paper back, not approved',
  admin_unpublish: () => 'took the paper off the site',
  admin_update_live: () => 'updated the live paper with the reviewed changes',
  admin_republish: () => 'put the paper back on the site',
  admin_edit: (c) => (c.changes ? `changed ${c.changes}${c.on}` : `edited ${c.q}`),
  admin_revert: (c) => `restored ${c.toVersion}${c.on}`,
  admin_set_aside: (c) => `set ${c.q} aside`,
  admin_pass: (c) => `passed ${c.q}`,
  admin_reopen: (c) => `reopened ${c.q} for checking`,
  admin_queue: () => 'put the paper in the approval queue',
  queued_for_approval: () => 'put the paper in the approval queue',
  // earlier admin tools
  admin_draft_edit: (c) => (c.changes ? `changed ${c.changes}${c.on}` : `edited ${c.q}`),
  admin_verify_paper: () => 'verified the paper',
  admin_resolve_escalation: (c) => `answered a request for help${c.on}`,
  // log_action_catalog: "An admin hid a paper" / "restored a hidden paper"
  admin_hide: () => 'took the paper off the site',
  admin_restore: () => 'put the paper back on the site',
  admin_reapply_paper_to_live: () => 'copied the checked paper to the live site',
  admin_english_rescue_publish: () => 'published the rescued English paper',
  admin_english_rescue_unpublish: () => 'took the rescued English paper off the site',
  admin_grant_checker: () => 'gave someone checker access',
  admin_add_checker: () => 'added a checker',
  admin_revoke_checker: () => 'removed checker access',
  admin_remove_checker: () => 'removed a checker',
  admin_undo: (c) => `undid an earlier change${c.on}`,
  admin_add: (c) => `added ${c.q}`,
  admin_delete: (c) => `deleted ${c.q}`,
  admin_merge: (c) => `joined two questions into one${c.on}`,
  admin_split: (c) => `split ${c.q} in two`,
  admin_reorder: () => 'changed the order of the questions',
  // student checkers (Kid Mode)
  checker_pass: (c) => `said ${c.q} matches the page`,
  checker_fix: (c) => (c.changes ? `fixed a reading mistake in ${c.changes}${c.on}` : `fixed a reading mistake${c.on}`),
  checker_printed_typo: (c) => `corrected a typo printed on the paper${c.on}`,
  checker_skip: (c) => `skipped ${c.q}`,
  checker_split: (c) => `split ${c.q} in two`,
  checker_ask_help: (c) => `asked the HOD for help${c.on}`,
  checker_return_paper: () => 'handed a paper back',
  verifier_undo: () => 'undid their last answer',
  verifier_or_separator: (c) => `marked ${c.q} as just the OR between two questions and linked the questions around it`,
  // the HOD and the AI trust levels
  admin_add_hod: () => 'made someone an HOD',
  admin_remove_hod: () => 'removed someone as an HOD',
  // the admin audit trail (admin_audit_log), written from the Verifiers page
  grant_hod: () => 'made someone an HOD',
  revoke_hod: () => 'removed someone as an HOD',
  grant_checker: () => 'gave someone checker access',
  revoke_checker: () => 'removed checker access',
  hod_send_back: (c) => `sent ${c.q} back to the checkers`,
  hod_set_aside: (c) => `set ${c.q} aside`,
  hod_assign_paper: () => 'gave a paper to a verifier',
  hod_unassign: () => 'took a paper back from a verifier',
  auto_return_idle: () => 'took a paper back automatically after 7 days with nothing done on it',
  auto_return_inactive: () => 'took a paper back automatically because its verifier is no longer active',
  hod_set_verifier_profile: () => 'saved the grade, school and board of a verifier',
  hod_set_preferred_subjects: () => 'set the preferred subjects of a verifier',
  verifier_request_subjects: () => 'asked for preferred subjects',
  verifier_set_my_profile: () => 'filled in their own grade, school and board',
  owner_reroute_to_verifiers: () => 'sent questions the AI had settled on its own to verifiers, so people check them',
  admin_set_ai_trust: () => 'changed which AI confidence levels are trusted',
  ai_trust_auto_off: () => 'stopped trusting an AI confidence level because people corrected it too often',
  ai_trust_sample: (c) => `sent ${c.q} to a checker to measure the AI`,
  // content_checks verdicts, as logged by the activity feed
  check_pass: (c) => `passed ${c.q}${c.conf}`,
  check_fix: (c) => `suggested a fix to ${c.q}${c.conf}`,
  check_printed_typo: (c) => `found a typo printed on the paper${c.on}${c.conf}`,
  check_escalate: (c) => `sent ${c.q} to an admin${c.conf}`,
  check_flag: (c) => `flagged ${c.q}${c.conf}`,
  // AI rows
  ai_check: (c) => `${c.verdict}${c.conf}`,
  ai_verdict: (c) => `${c.verdict}${c.conf}`,
  content_check: (c) => `${c.verdict}${c.conf}`,
  ai_pass: (c) => `passed ${c.q}${c.conf}`,
  ai_fix: (c) => (c.changes ? `fixed ${c.changes}${c.on}${c.conf}` : `fixed ${c.q}${c.conf}`),
  ai_escalate: (c) => `sent ${c.q} to an admin${c.conf}`,
  ai_flagged: (c) => `flagged ${c.q}${c.conf}`,
  // versions
  version_insert: (c) => `added ${c.q}`,
  version_update: (c) => (c.changes ? `changed ${c.changes}${c.on}` : `changed ${c.q}`),
  version_revert: (c) => `restored ${c.toVersion}${c.on}`,
  version_delete: (c) => `deleted ${c.q}`,
  // pipeline
  reclassify: (c) => `moved ${c.q} to another checking pile`,
  route_back_unverified_page: (c) => `sent ${c.q} back because its page was not checked yet`,
  live_apply: (c) => `put the change on the live site${c.on}`,
  live_copy: (c) => `copied ${c.q} to the live paper`,
  live_changes: (c) => `updated the live paper${c.on}`,
  published: () => 'published the paper',
  set_aside: (c) => `set ${c.q} aside`,
  question_set_aside: (c) => `set ${c.q} aside`,
  paper_loaded: () => 'loaded the paper for checking',
  load: () => 'loaded the paper for checking',
  created: (c) => `added ${c.q}`,
  publish: () => 'published the paper',
  autofill_metadata: (c) => `filled in the chapter and other details${c.on}`,
  locate_page: (c) => `looked for ${c.q} on the scanned pages`,
  pdf_mismatch_flag: () => 'noticed the scan may not match this paper',
  auto_fix: (c) => (c.changes ? `fixed a reading mistake in ${c.changes}${c.on}` : `fixed a reading mistake${c.on}`),
  flag_fix: (c) => `updated the warnings${c.on}`,
  discard_mark: (c) => `removed a stray mark${c.on}`,
  correct_pdf_match: () => 'matched the paper to its scan',
  gap_flag: (c) => `noticed a question may be missing near ${c.q}`,
  gap_audit_pass: () => 'checked that no question is missing',
  gap_audit_renderer_note: () => 'left a note about how the paper displays',
  live_match_loop_resolve: () => 'matched the paper to its live copy',
  search_no_match_broad_resolve: () => 'found the live copy of the paper',
  marks_from_picture: (c) => `read the marks from the picture${c.on}`,
  picture_check_hide: () => 'hid the paper after checking its pictures',
  revert_header: () => 'undid a change to the paper details',
  restore: (c) => `brought ${c.q} back`,
  live_clear: () => 'marked the live paper as complete',
  auto_return: () => 'put the paper back on the site',
  other: (c) => (c.changes ? `changed ${c.changes}${c.on}` : `made a change${c.on}`),
  apply_fix: (c) => (c.changes ? `applied a fix to ${c.changes}${c.on}` : `applied a fix${c.on}`),
};

/** Every action code with a label, for the test and for callers that need the list. */
export const KNOWN_ACTIONS = Object.keys(ACTION_LABELS);

function joinWords(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The distinct field labels a change list touches, in words. */
export function changedFieldWords(changes: FieldChange[] | null | undefined): string | null {
  const labels = Array.from(new Set((changes ?? []).map((c) => fieldLabel(c.field))));
  return labels.length ? joinWords(labels) : null;
}

/** 0.92 or 92 -> " confidence 92%"; nothing when absent. */
export function confidenceWords(confidence: number | null | undefined): string {
  if (confidence === null || confidence === undefined || Number.isNaN(confidence)) return '';
  const pct = confidence <= 1 ? Math.round(confidence * 100) : Math.round(confidence);
  return `, confidence ${pct}%`;
}

/** "2 Oct, 4:12 pm" in the reader's own time zone; the year only when it is not this one. */
export function timeWords(at: string | Date, now: Date = new Date()): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) return 'at an unknown time';
  return format(d, isSameYear(d, now) ? 'd MMM, h:mm aaa' : 'd MMM yyyy, h:mm aaa');
}

/** "5 minutes ago": the relative form, used as the hover title beside an absolute time. */
export function relativeWords(at: string | Date, now: Date = new Date()): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) return '';
  return formatDistance(d, now, { addSuffix: true });
}

/** The predicate of a history sentence: "changed the question text on question 5". */
export function actionWords(e: HistoryEventInput): string {
  const label = (e.question_label ?? '').trim();
  const ctx: Ctx = {
    q: label ? `question ${label}` : 'this question',
    on: label ? ` on question ${label}` : '',
    changes: changedFieldWords(e.changes),
    verdict: verdictWords(e.verdict, label ? `question ${label}` : 'this question'),
    conf: confidenceWords(e.confidence),
    toVersion: e.to_version ? `version ${e.to_version}` : 'an earlier version',
  };
  const fn = ACTION_LABELS[(e.action ?? '').trim()];
  if (fn) return fn(ctx);
  if (ctx.changes) return `changed ${ctx.changes}${ctx.on}`;
  return label ? `made a change to question ${label}` : 'made a change';
}

/**
 * A note is shown only when a person could have written it. Pipeline notes
 * ("skipped: live_bank_question_id ... not found") are bookkeeping, and
 * anything that looks like a code, an id or json is dropped, not shown raw.
 */
export function friendlyNote(note: string | null | undefined, kind?: string | null): string | null {
  const s = (note ?? '').trim();
  if (!s) return null;
  if (normaliseActorKind(kind) === 'pipeline') return null;
  if (UUID_RE.test(s)) return null;
  if (/[{}[\]]/.test(s)) return null;
  if (/\b[a-z]+_[a-z_]+\b/.test(s)) return null;
  if (/\bai:/i.test(s)) return null;
  return s;
}

export interface HistoryLine {
  who: string;
  what: string;
  when: string;
  /** "Priya Sharma changed the question text - 2 Oct, 4:12 pm" */
  line: string;
  note: string | null;
}

export function historyLine(e: HistoryEventInput, now: Date = new Date()): HistoryLine {
  const who = actorLabel(e);
  const what = markUndone(actionWords(e), e.undone);
  const when = timeWords(e.at, now);
  return { who, what, when, line: `${who} ${what} - ${when}`, note: friendlyNote(e.note, e.actor_kind) };
}

/** The sentence for one AI or person check (content_checks row). */
export function checkLine(
  c: { checker_kind: string; model?: string | null; verdict: string; confidence?: number | null; at?: string | null; actor_name?: string | null },
  now: Date = new Date(),
): string {
  const who = actorLabel({ checker_kind: c.checker_kind, model: c.model, actor_name: c.actor_name });
  const what =
    c.checker_kind === 'student' && c.verdict === 'pass'
      ? 'said it matches the page'
      : verdictWords(c.verdict, 'this question');
  const conf = confidenceWords(c.confidence);
  const when = c.at ? ` - ${timeWords(c.at, now)}` : '';
  return `${who} ${what}${conf}${when}`;
}

// ---------------------------------------------------------------------------
// Word diff, so a change reads as the visible text with the old words struck
// through and the new ones highlighted. Never json.

export type DiffPart = { kind: 'same' | 'removed' | 'added'; text: string };

function tokens(s: string): string[] {
  return s.match(/\s+|[^\s]+/g) ?? [];
}

/** Longest-common-subsequence diff over words (whitespace kept as tokens). */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = tokens(before);
  const b = tokens(after);
  // Very long texts: one block out, one block in, rather than a slow table.
  if (a.length * b.length > 4_000_000) {
    const out: DiffPart[] = [];
    if (before) out.push({ kind: 'removed', text: before });
    if (after) out.push({ kind: 'added', text: after });
    return out;
  }
  const n = a.length;
  const m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffPart[] = [];
  const push = (kind: DiffPart['kind'], text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('same', a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('removed', a[i]);
      i++;
    } else {
      push('added', b[j]);
      j++;
    }
  }
  while (i < n) push('removed', a[i++]);
  while (j < m) push('added', b[j++]);
  return out;
}

/** "from 2 marks to 3 marks", for a short field that does not need a diff. */
export function shortChangeWords(change: FieldChange): string {
  const label = fieldLabel(change.field).replace(/^the /, '');
  return `${label}: was ${valueWords(change.field, change.before)}, now ${valueWords(change.field, change.after)}`;
}
