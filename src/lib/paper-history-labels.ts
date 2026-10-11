/* A paper's change history in people's words, for the Library's History dialog.

   admin_paper_history() returns raw codes ('admin_edit', 'is_published',
   'admin'). The admin should read "Edited by Priya Sharma", not a code. Every
   lookup has a safe plain fallback, so a code the database starts emitting
   later still reads as words, never as a raw token.

   Pure (no React, no Supabase). No em or en dashes in the copy. This is
   separate from activity-format.ts and history-labels.ts, which belong to the
   Logs pages. */

/** The revision actions admin_undo_revision() can reverse; every other action
 *  (merge, split, reorder, add, undo, live_apply, live_clear) it refuses. */
export const UNDOABLE_ACTIONS: ReadonlySet<string> = new Set(['admin_edit', 'admin_delete', 'admin_hide', 'admin_restore']);

export const HISTORY_ACTION_LABELS: Record<string, string> = {
  admin_edit: 'Edited',
  admin_hide: 'Hidden',
  admin_restore: 'Restored',
  admin_delete: 'Deleted',
  merge: 'Merged',
  split: 'Split',
  reorder: 'Reordered',
  add: 'Added',
  undo: 'Undone',
  live_apply: 'Updated on the live paper',
  live_clear: 'Cleared from the live paper',
};

export const HISTORY_FIELD_LABELS: Record<string, string> = {
  is_published: 'Visibility',
  school: 'School',
  cls: 'Class',
  class: 'Class',
  subject: 'Subject',
  exam: 'Exam',
  year: 'Year',
  board: 'Board',
  title: 'Title',
  allowed_time_minutes: 'Time allowed',
  general_instructions: 'General instructions',
  incomplete_note: 'Incomplete note',
  hidden_reason: 'Reason for hiding',
  body: 'Question text',
  display_number: 'Question number',
  marks: 'Marks',
  instructions: 'Question instructions',
  options: 'Answer options',
};

export const HISTORY_SOURCE_LABELS: Record<string, string> = {
  admin: 'admin screen',
  checker: 'verifier screen',
  student: 'verifier screen',
  ai: 'AI check',
  pipeline: 'pipeline',
  system: 'pipeline',
  script: 'pipeline',
};

function sentenceCase(code: string): string {
  const words = code.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : '';
}

/** "admin_edit" becomes "Edited". An unknown code becomes "Changed". */
export function historyActionLabel(action: string | null | undefined): string {
  return HISTORY_ACTION_LABELS[(action ?? '').trim()] ?? 'Changed';
}

/** "allowed_time_minutes" becomes "Time allowed". An unknown field is shown
 *  as plain words ("some_field" becomes "Some field"). */
export function historyFieldLabel(field: string | null | undefined): string {
  const key = (field ?? '').trim();
  if (!key) return '';
  return HISTORY_FIELD_LABELS[key] ?? sentenceCase(key);
}

/** Where the change was made, in words, or '' when unknown. */
export function historySourceLabel(source: string | null | undefined): string {
  return HISTORY_SOURCE_LABELS[(source ?? '').trim().toLowerCase()] ?? '';
}

/** One line for a revision: "Edited, Year by Priya Sharma (admin screen)". */
export function historyLine(r: { action: string; field: string | null; actor: string | null; source: string | null }): string {
  const what = historyActionLabel(r.action);
  const field = historyFieldLabel(r.field);
  const who = (r.actor ?? '').trim();
  const where = historySourceLabel(r.source);
  const head = field ? `${what}, ${field}` : what;
  const by = who ? ` by ${who}` : '';
  return `${head}${by}${where ? ` (${where})` : ''}`;
}

const PREVIEW_MAX = 80;

function preview(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 'on the site' : 'hidden';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t || t.length > PREVIEW_MAX) return null;
    return `"${t}"`;
  }
  return null;
}

/** What pressing Undo on this revision will do, as one or two plain
 *  sentences, so the admin confirms with the effect in front of them. The
 *  before and after values are shown only for a short header field; question
 *  text is never quoted here. */
export function undoEffect(r: { action: string; field: string | null; before?: unknown; after?: unknown }): string {
  switch (r.action) {
    case 'admin_hide':
      return 'This brings the paper back on the site, so readers can open it again.';
    case 'admin_restore':
      return 'This hides the paper again, so readers stop seeing it.';
    case 'admin_delete':
      return 'This brings the deleted item back.';
    case 'admin_edit': {
      const field = historyFieldLabel(r.field) || 'this detail';
      const quotable = r.field !== 'body' && r.field !== 'instructions' && r.field !== 'options';
      const was = quotable ? preview(r.before) : null;
      const now = quotable ? preview(r.after) : null;
      if (was && now) return `This puts ${field} back to ${was}, from ${now}.`;
      if (was) return `This puts ${field} back to ${was}.`;
      return `This puts ${field} back to what it was before this edit.`;
    }
    default:
      return 'This reverses the change.';
  }
}

/** "Class X Maths 2019, Sample Hill School": which paper a dialog is about.
 *  Used in titles so the admin never has to remember which row they pressed. */
export function paperLabel(p: { cls?: string | null; subject?: string | null; year?: string | number | null; school?: string | null }): string {
  const cls = (p.cls ?? '').toString().trim();
  const subject = (p.subject ?? '').trim();
  const year = (p.year ?? '').toString().trim();
  const school = (p.school ?? '').trim();
  const what = [cls ? `Class ${cls}` : '', subject, year].filter(Boolean).join(' ');
  if (what && school) return `${what}, ${school}`;
  return what || school || 'this paper';
}
