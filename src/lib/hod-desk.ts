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

// ------------------------------------------------------- assignments: filters on the papers nobody has

export interface FreeFilter {
  subject: string;
  cls: string;
  q: string;
}

export const NO_FREE_FILTER: FreeFilter = { subject: '', cls: '', q: '' };

type FreeRow = { subject: string | null; cls: string | null; school: string | null; exam: string | null; year: string | null };

export function freeFilterOn(f: FreeFilter): boolean {
  return f.subject !== '' || f.cls !== '' || f.q.trim() !== '';
}

/** The papers that match a subject, a class and a search (subject, class, school, exam or year), in list order. */
export function filterFreePapers<T extends FreeRow>(rows: readonly T[], f: FreeFilter): T[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.subject && (r.subject ?? '') !== f.subject) return false;
    if (f.cls && (r.cls ?? '') !== f.cls) return false;
    if (!q) return true;
    return [r.subject, r.cls ? `class ${r.cls}` : null, r.school, r.exam, r.year].some((v) => (v ?? '').toLowerCase().includes(q));
  });
}

/** The subjects and classes on the list, for the two dropdowns, each sorted and without blanks. */
export function freeFilterChoices(rows: readonly FreeRow[]): { subjects: string[]; classes: string[] } {
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => Boolean(x && x.trim())))];
  return {
    subjects: uniq(rows.map((r) => r.subject)).sort((a, b) => a.localeCompare(b)),
    classes: uniq(rows.map((r) => r.cls)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
  };
}

// ------------------------------------------------------- needs you: order and the next paper

export type NeedsSort = 'most' | 'fewest' | 'students';

export const NEEDS_SORTS: { key: NeedsSort; label: string }[] = [
  { key: 'most', label: 'Most waiting first' },
  { key: 'fewest', label: 'Fewest waiting first' },
  { key: 'students', label: 'Sent up by students first' },
];

type NeedsRow = { audit_paper_id: string; title: string; escalated: number; admin_bucket: number };

/**
 * The Needs you papers in the chosen order. Ties keep the server's order (most waiting first). There is no "oldest
 * first": the list carries no date for when a paper started waiting (that needs a change to hod_needs_you_papers).
 */
export function sortNeedsPapers<T extends NeedsRow>(rows: readonly T[], sort: NeedsSort): T[] {
  const waiting = (p: T) => p.escalated + p.admin_bucket;
  const indexed = rows.map((p, i) => ({ p, i }));
  const by =
    sort === 'fewest'
      ? (a: { p: T; i: number }, b: { p: T; i: number }) => waiting(a.p) - waiting(b.p) || a.i - b.i
      : sort === 'students'
        ? (a: { p: T; i: number }, b: { p: T; i: number }) => b.p.escalated - a.p.escalated || waiting(b.p) - waiting(a.p) || a.i - b.i
        : (a: { p: T; i: number }, b: { p: T; i: number }) => waiting(b.p) - waiting(a.p) || a.i - b.i;
  return indexed.sort(by).map((x) => x.p);
}

/** The paper to open after this one: the next in the list that still has questions waiting, else the first such paper. */
export function nextNeedsPaper<T extends NeedsRow>(rows: readonly T[], currentId: string): T | null {
  const waiting = rows.filter((p) => p.audit_paper_id !== currentId && p.escalated + p.admin_bucket > 0);
  if (waiting.length === 0) return null;
  const at = rows.findIndex((p) => p.audit_paper_id === currentId);
  if (at === -1) return waiting[0];
  return rows.slice(at + 1).find((p) => p.escalated + p.admin_bucket > 0) ?? waiting[0];
}

// ------------------------------------------------------- history

export type HistoryView = 'loading' | 'error' | 'empty' | 'rows';

/** The rows whose paper matches the search (its name as shown), in the order given. An empty search keeps every row. */
export function historyByPaper<T extends { paper_label: string | null }>(rows: readonly T[], q: string): T[] {
  const s = q.trim().toLowerCase();
  if (!s) return [...rows];
  return rows.filter((r) => (r.paper_label ?? '').toLowerCase().includes(s));
}

export interface HistoryPerson {
  id: string;
  label: string;
}

/**
 * Everyone the Person list offers: the checkers on the team, then the HODs and admins (and anyone else) who appear in
 * the history read so far, with their role in brackets. There is no list of HODs and admins to read on its own, so a
 * person shows up here once they have done something in the rows loaded. Sorted by name, each person once.
 */
export function historyPeople(
  team: readonly { user_id: string; label: string }[],
  seen: readonly { id: string; name: string | null; role: string | null }[],
  roleWord: (role: string) => string,
): HistoryPerson[] {
  const out = new Map<string, HistoryPerson>();
  for (const m of team) out.set(m.user_id, { id: m.user_id, label: m.label });
  for (const s of seen) {
    if (out.has(s.id)) continue;
    out.set(s.id, { id: s.id, label: s.role ? `${s.name ?? 'Someone'} (${roleWord(s.role)})` : (s.name ?? 'Someone') });
  }
  return [...out.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * A failed "Load older" keeps the rows already on screen (TanStack Query v5 keeps
 * the data when a later page errors), so the error replaces the list only when
 * there is no list to keep.
 *
 * `hasData` is whether an answer has arrived at all (loadGate's rule), not `isLoading`: offline, TanStack Query pauses
 * the read and `isLoading` is false, which once let "Nothing has been recorded" show while nothing had been read yet.
 */
export function historyView(s: { hasData: boolean; isError: boolean; rowCount: number }): HistoryView {
  if (s.rowCount > 0) return 'rows';
  if (s.isError) return 'error';
  return s.hasData ? 'empty' : 'loading';
}

/**
 * The first sentence above the verifier details. "Everyone is set up" is only said when the details really loaded
 * and every verifier is set up; while the details failed to load (or there is nobody to count) it says nothing.
 */
export function verifierSetupLine(needing: number, total: number, loadFailed: boolean): string {
  if (loadFailed) return '';
  if (needing > 0) return `${needing} need${needing === 1 ? 's' : ''} your attention and are listed first.`;
  return total > 0 ? 'Everyone is set up.' : '';
}
