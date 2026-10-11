/* The Paper review list's filters, tiles and chip counts, in one place.

   Owner, 2026-09-28: "filters dont work". The filter switch itself was
   right; the rows under it were not. admin_paper_queue() returned every
   English paper TWICE (a second live_copy audit paper, the W14 rescue copy,
   joined in beside the main one): 2,696 rows for 1,960 papers. The table
   keyed rows by paper id, and React keeps stale rows on screen when two
   siblings share a key, so a filter change left rows from the previous
   filter behind. The tiles counted the duplicates too ("Needs review" 1,190
   against a true 893).

   The server fix is 20260928230000_admin_paper_queue_one_row_and_pdf_name.sql. This
   file makes the page correct on its own as well: every row is normalised
   and merged to one per paper before anything counts or renders it, and the
   tiles, the chips and the list all read the SAME predicate, so they cannot
   disagree again. Pure, so it is pinned by tests without an admin login. */

import type { PaperQueueRow } from '@/lib/checker-api';
import { showIncompleteNote } from '@/lib/bank-paper-display';

export type PaperFilter = 'needs_review' | 'escalated' | 'hidden' | 'incomplete' | 'verified' | 'all';

export const PAPER_FILTERS: { key: PaperFilter; label: string }[] = [
  { key: 'needs_review', label: 'Needs review' },
  { key: 'escalated', label: 'Escalated' },
  { key: 'hidden', label: 'Hidden' },
  { key: 'incomplete', label: 'Incomplete' },
  { key: 'verified', label: 'Verified' },
  { key: 'all', label: 'All' },
];

/** Fully verified = live and cleared: published, and needs_review is off. */
export const isVerified = (p: PaperQueueRow) => p.is_published && !p.needs_review;

export function matchesFilter(p: PaperQueueRow, f: PaperFilter): boolean {
  switch (f) {
    case 'needs_review':
      // On the site with questions still unchecked. A hidden paper that is
      // flagged belongs to Hidden, not here, so the two never overlap.
      return p.is_published && p.needs_review;
    case 'escalated':
      return p.escalated_count > 0;
    case 'hidden':
      return !p.is_published;
    case 'incomplete':
      return showIncompleteNote(p.incomplete_note);
    case 'verified':
      return isVerified(p);
    default:
      return true;
  }
}

export function filterPapers(papers: PaperQueueRow[], f: PaperFilter): PaperQueueRow[] {
  return papers.filter((p) => matchesFilter(p, f));
}

/** The number on every tile and chip, from the same predicate the list uses. */
export function filterCounts(papers: PaperQueueRow[]): Record<PaperFilter, number> {
  const out: Record<PaperFilter, number> = {
    needs_review: 0,
    escalated: 0,
    hidden: 0,
    incomplete: 0,
    verified: 0,
    all: papers.length,
  };
  for (const p of papers) {
    for (const f of ['needs_review', 'escalated', 'hidden', 'incomplete', 'verified'] as const) {
      if (matchesFilter(p, f)) out[f] += 1;
    }
  }
  return out;
}

const bool = (v: unknown) => v === true || v === 'true' || v === 't';
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Coerces one row as PostgREST may send it (bigint counts as strings, a
 *  missing boolean) into the shape the page relies on. */
export function normaliseQueueRow(r: PaperQueueRow): PaperQueueRow {
  return {
    ...r,
    needs_review: bool(r.needs_review),
    is_published: bool(r.is_published),
    incomplete_note: typeof r.incomplete_note === 'string' ? r.incomplete_note : null,
    escalated_count: num(r.escalated_count),
    total_questions: num(r.total_questions),
    passed_questions: num(r.passed_questions),
  };
}

/**
 * One row per paper. A paper that arrives more than once (an older
 * admin_paper_queue, one row per audit copy) becomes one row whose counts
 * are added up across its copies, so no question and no escalation is
 * dropped. First-seen order is kept. */
export function mergeQueueRows(rows: PaperQueueRow[]): PaperQueueRow[] {
  const byId = new Map<string, PaperQueueRow>();
  for (const raw of rows) {
    if (!raw || !raw.paper_id) continue;
    const r = normaliseQueueRow(raw);
    const seen = byId.get(r.paper_id);
    if (!seen) {
      byId.set(r.paper_id, r);
      continue;
    }
    byId.set(r.paper_id, {
      ...seen,
      escalated_count: seen.escalated_count + r.escalated_count,
      total_questions: seen.total_questions + r.total_questions,
      passed_questions: seen.passed_questions + r.passed_questions,
    });
  }
  return [...byId.values()];
}

/** Questions on this paper still waiting for a check. A paper with no audit
 *  copy yet (total 0) has nothing countable and sorts after every paper that
 *  does. */
export const leftToCheck = (p: PaperQueueRow) =>
  p.total_questions > 0 ? Math.max(p.total_questions - p.passed_questions, 0) : Number.POSITIVE_INFINITY;

/** Fewest questions left first: those papers clear and go live soonest. */
export function sortForReview(papers: PaperQueueRow[]): PaperQueueRow[] {
  return [...papers].sort((a, b) => leftToCheck(a) - leftToCheck(b) || a.paper_id.localeCompare(b.paper_id));
}

/** How many rows the list paints at first. 1,960 rows twice over (the grid
 *  and the phone list) made every chip tap wait on a very large render. */
export const PAGE_SIZE = 100;
