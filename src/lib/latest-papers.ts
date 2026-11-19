/* The "Latest papers" shelf on the past papers page.

   It used to be ordered by EXAM year, newest first. A paper an HOD publishes
   today but whose exam was in 2024 therefore sat a hundred places down and
   never reached the 12-paper shelf, which is exactly what the owner saw:
   "this area doesn't reflect papers I publish actively from the HOD desk".

   The shelf is now ordered by when a paper was PUBLISHED (created_at), newest
   first. Papers published in one batch share a timestamp, so the exam year
   breaks the tie (newer exam first), then the id, which keeps the order the
   same on every render. A paper with no known publish time counts as the
   oldest, so it can only appear once there are no timestamped papers left to
   show. */

/** How many covers the shelf holds. A shelf you can reach the end of. */
export const SHELF_LIMIT = 12;

export interface ShelfEntry {
  id: string;
  /** ISO timestamp of when the paper was published, or '' when unknown. */
  created_at: string;
  /** Exam year; 0 when the paper is undated. */
  year: number;
}

/** Milliseconds since 1970 for a publish timestamp; 0 when missing or unreadable. */
export function publishTime(createdAt: string | null | undefined): number {
  if (!createdAt) return 0;
  const t = Date.parse(createdAt);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Merge any number of paper lists into one, newest publish first.
 *
 * A paper that appears in more than one list is kept once, from the EARLIEST
 * list given, so a fresh read passed first wins over an older cached copy.
 * Never mutates its inputs.
 */
export function orderLatest<T extends ShelfEntry>(...lists: ReadonlyArray<ReadonlyArray<T>>): T[] {
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const list of lists) {
    for (const paper of list) {
      if (seen.has(paper.id)) continue;
      seen.add(paper.id);
      merged.push(paper);
    }
  }
  return merged.sort((a, b) => {
    const byPublish = publishTime(b.created_at) - publishTime(a.created_at);
    if (byPublish !== 0) return byPublish;
    const byYear = (b.year || 0) - (a.year || 0);
    if (byYear !== 0) return byYear;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
