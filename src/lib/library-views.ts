/* The Library's views: Live, Needs review, Hidden, With students, With an
   admin, Ready to go live, Incomplete, All.

   The first, second, third and Incomplete come straight from the paper list
   (paper-review-filter.ts, which tests pin). With students, With an admin and
   Ready to go live need numbers the list does not carry, so they come from
   admin_library_extras() and are merged onto each paper by id. When that
   function is not on the server yet the three views report "unknown" rather
   than a false zero. Pure, so it is tested without a login. */

import type { PaperQueueRow } from '@/lib/checker-api';
import { matchesFilter } from '@/lib/paper-review-filter';
import type { TipKey } from '@/lib/admin-hints';

export interface LibraryExtra {
  paper_id: string;
  /** Why an admin hid it, in the admin's own words. */
  hidden_reason: string | null;
  hidden_at: string | null;
  /** Who hid it: a person's name, or "The pipeline". */
  hidden_by: string | null;
  with_students: number;
  with_admin: number;
  /** Waiting in Ready to go live. */
  ready: boolean;
}

export type LibraryRow = PaperQueueRow & Partial<Omit<LibraryExtra, 'paper_id'>>;

export type LibraryView = 'live' | 'needs_review' | 'hidden' | 'with_students' | 'with_admin' | 'ready' | 'incomplete' | 'all';

export const LIBRARY_VIEWS: { key: LibraryView; label: string; tip: TipKey; needsExtras?: boolean }[] = [
  { key: 'live', label: 'Live', tip: 'view.live' },
  { key: 'needs_review', label: 'Needs review', tip: 'view.needs_review' },
  { key: 'hidden', label: 'Hidden', tip: 'view.hidden' },
  { key: 'with_students', label: 'With students', tip: 'view.with_students', needsExtras: true },
  { key: 'with_admin', label: 'With an admin', tip: 'view.with_admin', needsExtras: true },
  { key: 'ready', label: 'Ready to go live', tip: 'view.ready', needsExtras: true },
  { key: 'incomplete', label: 'Incomplete', tip: 'view.incomplete' },
  { key: 'all', label: 'All', tip: 'view.all' },
];

export function matchesView(p: LibraryRow, v: LibraryView): boolean {
  switch (v) {
    case 'live':
      return p.is_published;
    case 'needs_review':
      return matchesFilter(p, 'needs_review');
    case 'hidden':
      return matchesFilter(p, 'hidden');
    case 'with_students':
      return (p.with_students ?? 0) > 0;
    case 'with_admin':
      return (p.with_admin ?? 0) > 0;
    case 'ready':
      return p.ready === true;
    case 'incomplete':
      return matchesFilter(p, 'incomplete');
    default:
      return true;
  }
}

export function viewRows(rows: LibraryRow[], v: LibraryView): LibraryRow[] {
  return rows.filter((p) => matchesView(p, v));
}

export function viewCounts(rows: LibraryRow[]): Record<LibraryView, number> {
  const out = {} as Record<LibraryView, number>;
  for (const v of LIBRARY_VIEWS) out[v.key] = 0;
  for (const p of rows) for (const v of LIBRARY_VIEWS) if (matchesView(p, v.key)) out[v.key] += 1;
  return out;
}

/** Merge the extras onto the paper rows (by paper id). Papers with no extras
 *  row keep zeros, so a count is never invented. */
export function withExtras(rows: PaperQueueRow[], extras: LibraryExtra[] | null): LibraryRow[] {
  if (!extras) return rows;
  const byId = new Map(extras.map((e) => [e.paper_id, e]));
  return rows.map((p) => {
    const e = byId.get(p.paper_id);
    return e
      ? { ...p, hidden_reason: e.hidden_reason, hidden_at: e.hidden_at, hidden_by: e.hidden_by, with_students: e.with_students, with_admin: e.with_admin, ready: e.ready }
      : { ...p, with_students: 0, with_admin: 0, ready: false };
  });
}

/** Coerces one extras row as PostgREST may send it (bigint as strings). */
export function normaliseExtra(raw: unknown): LibraryExtra | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const id = typeof r.paper_id === 'string' ? r.paper_id : null;
  if (!id) return null;
  const n = (v: unknown) => {
    const x = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(x) ? x : 0;
  };
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  return {
    paper_id: id,
    hidden_reason: s(r.hidden_reason),
    hidden_at: s(r.hidden_at),
    hidden_by: s(r.hidden_by),
    with_students: n(r.with_students),
    with_admin: n(r.with_admin),
    ready: r.ready === true || r.ready === 'true' || r.ready === 't',
  };
}

/** The sentence under a hidden paper. Never empty: an older hide has no
 *  reason on record, and the page says so instead of leaving a blank. */
export function hiddenWhy(p: Pick<LibraryRow, 'is_published' | 'hidden_reason' | 'hidden_by'>, extrasKnown: boolean): string {
  if (p.is_published) return '';
  if (p.hidden_reason) return p.hidden_by ? `${p.hidden_reason} (${p.hidden_by})` : p.hidden_reason;
  return extrasKnown ? 'No reason was recorded when it was hidden.' : 'Reason not available yet.';
}
