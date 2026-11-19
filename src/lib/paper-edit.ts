import { describeFlags } from '@/lib/checker-kid-reasons';
import { englishContext, type EnglishPassage } from '@/lib/checker-english';

/* Pure logic behind the admin paper edit page (W12,
   src/pages/admin/paper-edit.tsx). Kept free of React and Supabase so the
   parts that decide what the admin is told (save state, verify counts) are
   pinned by tests rather than by clicking through with an admin login. */

// ---------------------------------------------------------------------------
// Autosave, one question at a time.
//
// `editVersion` counts keystrokes-worth of edits; `savingVersion` is the edit
// the in-flight save carries. If the admin keeps typing while a save is in
// flight, the save still lands but the question is dirty again afterwards,
// so the page schedules one more save instead of claiming "Saved" for text
// the server has not seen.

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'failed' | 'conflict';

export interface AutosaveState {
  status: SaveStatus;
  editVersion: number;
  savingVersion: number | null;
  savedVersion: number;
  error: string | null;
}

export type AutosaveEvent =
  | { type: 'edit' }
  | { type: 'save_start' }
  | { type: 'save_ok' }
  | { type: 'save_fail'; error: string }
  | { type: 'conflict' }
  | { type: 'reset' };

export const initialAutosave: AutosaveState = {
  status: 'idle',
  editVersion: 0,
  savingVersion: null,
  savedVersion: 0,
  error: null,
};

export function autosaveReducer(state: AutosaveState, event: AutosaveEvent): AutosaveState {
  switch (event.type) {
    case 'edit':
      return {
        ...state,
        editVersion: state.editVersion + 1,
        // An edit during a save keeps showing "Saving"; the follow-up save
        // is decided when this one settles.
        status: state.status === 'saving' ? 'saving' : 'dirty',
        error: null,
      };
    case 'save_start':
      return { ...state, status: 'saving', savingVersion: state.editVersion, error: null };
    case 'save_ok': {
      const saved = state.savingVersion ?? state.editVersion;
      return {
        ...state,
        savedVersion: saved,
        savingVersion: null,
        status: state.editVersion > saved ? 'dirty' : 'saved',
        error: null,
      };
    }
    case 'save_fail':
      return { ...state, status: 'failed', savingVersion: null, error: event.error };
    case 'conflict':
      return { ...state, status: 'conflict', savingVersion: null, error: null };
    case 'reset':
      return initialAutosave;
  }
}

/**
 * True when an edit exists that no save has stored or started storing.
 * Unlike status, this stays true for keystrokes typed while a save is in
 * flight, which is what an unmount must still flush. A conflict is excluded:
 * that question was reloaded from the server on purpose.
 */
export function hasEditsBeyondSave(state: AutosaveState): boolean {
  if (state.status === 'conflict') return false;
  return state.editVersion > Math.max(state.savedVersion, state.savingVersion ?? 0);
}

/** True while there is text the server has not stored yet. */
export function hasUnsavedWork(state: AutosaveState): boolean {
  return state.status === 'dirty' || state.status === 'saving' || state.status === 'failed';
}

export function saveStatusLabel(status: SaveStatus): string {
  switch (status) {
    case 'dirty':
      return 'Not saved yet';
    case 'saving':
      return 'Saving...';
    case 'saved':
      return 'Saved';
    case 'failed':
      return 'Failed to save';
    case 'conflict':
      return 'Changed by someone else';
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// Field parsing.

export type MarksParse = { ok: true; value: number | null } | { ok: false };

/** Blank means "no marks printed" (null). Anything else must be a
 *  non-negative number; a half mark ("0.5") is allowed. */
export function parseMarks(input: string): MarksParse {
  const trimmed = input.trim();
  if (trimmed === '') return { ok: true, value: null };
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return { ok: false };
  return { ok: true, value: Number(trimmed) };
}

/** A cleared number box is stored as null, not as an empty string, so it
 *  compares equal to a row that never had one. The text itself is sent
 *  exactly as typed otherwise. */
export function numberForSave(input: string): string | null {
  return input === '' ? null : input;
}

export interface DraftFields {
  body: string;
  display_number: string | null;
  marks: number | null;
}

export function fieldsEqual(a: DraftFields, b: DraftFields): boolean {
  return a.body === b.body && a.display_number === b.display_number && a.marks === b.marks;
}

// ---------------------------------------------------------------------------
// Verify confirmation.

export interface VerifyCountable {
  kind: string;
  question_passed: boolean;
  review_bucket: string | null;
  flag_reasons: string[] | null;
}

export interface VerifySummary {
  total: number;
  stillFlagged: number;
  escalated: number;
  alreadyPassed: number;
}

/** Counts only kind = 'question' rows, the same rows admin_verify_paper()
 *  passes; instruction and section rows are never counted. "Still flagged"
 *  is every question not yet passed. */
export function summarizeForVerify(rows: VerifyCountable[]): VerifySummary {
  let total = 0;
  let stillFlagged = 0;
  let escalated = 0;
  for (const r of rows) {
    if (r.kind !== 'question') continue;
    total += 1;
    if (!r.question_passed) {
      stillFlagged += 1;
      if (r.review_bucket === 'escalated') escalated += 1;
    }
  }
  return { total, stillFlagged, escalated, alreadyPassed: total - stillFlagged };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function verifyConfirmLines(s: VerifySummary, red: { isRed: boolean; reason: string | null }): string[] {
  const lines: string[] = [];
  if (s.stillFlagged === 0) {
    lines.push(`All ${plural(s.total, 'question is', 'questions are')} already checked.`);
  } else {
    lines.push(`${plural(s.stillFlagged, 'question is', 'questions are')} still flagged, out of ${s.total}.`);
    if (s.escalated > 0) {
      lines.push(`${plural(s.escalated, 'of them was', 'of them were')} sent for help.`);
    }
    lines.push('Verify marks every question as checked by you.');
  }
  if (red.isRed) {
    lines.push(`The AI marked this paper red${red.reason ? `: ${red.reason}` : ''}. Verify publishes it anyway.`);
  }
  lines.push('Your edits go live for readers straight away.');
  return lines;
}

// ---------------------------------------------------------------------------
// Verify result.

export interface VerifyResult {
  is_live: boolean;
  needs_review: boolean;
  is_published: boolean;
  reason: string | null;
  questions_total: number;
  questions_newly_passed: number;
}

export function verifyResultHeadline(r: VerifyResult): string {
  return r.is_live ? 'Live. Readers can see this paper now.' : 'Verified, but not live yet.';
}

// ---------------------------------------------------------------------------
// Layout helpers.

/** Nesting depth for sub-parts (5 -> 5(a) -> 5(a)(i)), from parent_id.
 *  Guards against a cycle in bad data by capping the walk. */
export function depthMap(rows: { id: string; parent_id: string | null }[]): Map<string, number> {
  const parent = new Map(rows.map((r) => [r.id, r.parent_id]));
  const out = new Map<string, number>();
  for (const r of rows) {
    let d = 0;
    let p = r.parent_id;
    while (p && parent.has(p) && d < 6) {
      d += 1;
      p = parent.get(p) ?? null;
    }
    out.set(r.id, d);
  }
  return out;
}

/** Paper-level fields admin_edit_bank_paper() accepts, with the value the
 *  page already holds, so the details editor always prefills the field
 *  being edited and never another field's text. */
export const PAPER_DETAIL_FIELDS = [
  { key: 'incomplete_note', label: 'Incomplete note' },
  { key: 'general_instructions', label: 'General instructions' },
  { key: 'allowed_time_minutes', label: 'Time allowed (minutes)' },
  { key: 'school', label: 'School' },
  { key: 'cls', label: 'Class' },
  { key: 'subject', label: 'Subject' },
  { key: 'exam', label: 'Exam' },
  { key: 'year', label: 'Year' },
] as const;

export type PaperDetailField = (typeof PAPER_DETAIL_FIELDS)[number]['key'];

export function paperDetailValue(
  p: Partial<Record<PaperDetailField, string | number | null>>,
  field: PaperDetailField,
): string {
  const v = p[field];
  return v == null ? '' : String(v);
}

/** The toast for a header save the server refused. The server's own sentence
 *  (the 22023 validation messages) is shown, so an admin learns WHY; a
 *  transport failure with no message falls back to a plain line. */
export function notSavedMessage(e: unknown): string {
  const msg = (e as { message?: string } | null)?.message;
  return msg && msg.trim() ? `Not saved: ${msg.trim()}` : 'Not saved. Nothing was changed.';
}

/** What a paper detail may be saved as, before admin_edit_bank_paper() is
 *  called. That function casts time allowed with ::numeric, so a blank or a
 *  word would fail there with a database error; say it plainly here instead.
 *  Text fields are sent exactly as typed. */
export function detailError(field: PaperDetailField, value: string): string | null {
  if (field === 'allowed_time_minutes') {
    return /^\d+$/.test(value.trim()) ? null : 'Type the minutes as a number, like 90.';
  }
  if ((field === 'school' || field === 'subject' || field === 'cls') && value.trim() === '') {
    return 'This cannot be blank.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Flag reasons, in plain words.

/**
 * The lines shown under a flagged question. flag_detail is stored as text but
 * usually holds a JSON object ({"gate_not_ready": "The computer reading of
 * this question was unsure."}); describeFlags() turns it into sentences.
 * Raw JSON is never shown: a note that still looks like JSON after parsing
 * (malformed) is dropped rather than printed.
 */
export function adminFlagLines(
  flagReasons: string[] | null | undefined,
  flagDetail: string | null | undefined,
): string[] {
  const { lines, note } = describeFlags(flagReasons, flagDetail);
  const out: string[] = [];
  for (const l of lines) {
    out.push(l.sentence);
    if (l.detail && l.detail !== l.sentence && !looksLikeJson(l.detail)) out.push(l.detail);
  }
  if (note && !looksLikeJson(note)) out.push(note);
  return [...new Set(out)];
}

function looksLikeJson(text: string): boolean {
  const t = text.trim();
  return /^[[{]/.test(t) || /"\s*:/.test(t);
}

// ---------------------------------------------------------------------------
// D76: a question is a one-to-one copy of the printed paper. An edit may only
// correct a reading (OCR) mistake, never reword, paraphrase or improve.

export const OCR_ONLY_REMINDER =
  'Type exactly what the printed paper says. Only fix reading mistakes. Do not reword, shorten or improve the question.';

export const BIG_EDIT_WARNING =
  'This changes much more than a reading fix usually does. Check it still matches the printed paper word for word.';

/**
 * Levenshtein distance between a and b, but stops counting at `limit`:
 * returns limit + 1 as soon as the distance is known to be larger. Banded,
 * so a long question costs length x limit, not length squared, and can run
 * on every keystroke.
 */
export function editDistanceCapped(a: string, b: string, limit: number): number {
  if (a === b) return 0;
  const cap = Math.max(0, Math.floor(limit));
  const over = cap + 1;
  if (Math.abs(a.length - b.length) > cap) return over;
  const n = a.length;
  const m = b.length;
  let prev = new Array<number>(m + 1);
  let cur = new Array<number>(m + 1);
  for (let j = 0; j <= m; j += 1) prev[j] = Math.min(j, over);
  for (let i = 1; i <= n; i += 1) {
    const lo = Math.max(1, i - cap);
    const hi = Math.min(m, i + cap);
    cur.fill(over);
    cur[0] = Math.min(i, over);
    let rowMin = cur[0];
    for (let j = lo; j <= hi; j += 1) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      const v = Math.min(prev[j - 1] + cost, prev[j] + 1, cur[j - 1] + 1, over);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > cap) return over;
    [prev, cur] = [cur, prev];
  }
  return Math.min(prev[m], over);
}

/** How many single-letter changes a reading fix may plausibly need: a few
 *  letters on a short question, about one in seven on a long one. */
export function ocrFixBudget(originalLength: number): number {
  return Math.max(10, Math.ceil(originalLength * 0.15));
}

/** True when `edited` differs from the text as it was loaded by more than
 *  a reading fix would. Advisory only: it never blocks or delays a save. */
export function looksLikeRewrite(original: string, edited: string): boolean {
  const budget = ocrFixBudget(original.length);
  return editDistanceCapped(original, edited, budget) > budget;
}

// ---------------------------------------------------------------------------
// English passages: shown once, before the first question that uses them,
// as the public page shows a context row before its questions.

export function passagesBefore(rows: { question_id: string; source: unknown }[]): Map<string, EnglishPassage> {
  const out = new Map<string, EnglishPassage>();
  const seen = new Set<string>();
  for (const r of rows) {
    const p = englishContext(r.source)?.passage;
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    out.set(r.question_id, p);
  }
  return out;
}

/** The printed paper's file name line. Never a path, never a link. */
export function sourcePdfLine(name: string | null | undefined): string {
  const file = (name ?? '').split(/[\\/]/).pop()?.trim() ?? '';
  return file ? `Printed paper file: ${file}` : 'Printed paper file: not recorded';
}
