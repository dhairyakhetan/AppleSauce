/**
 * The whole-paper fallback. When no page picture matched a question, the
 * screen shows every page picture of the paper as a page-flip instead of
 * telling the reader to judge from the words alone (owner, 7 Oct 2026).
 *
 * The list of a paper's pages comes from paper_page_pictures(), a SECURITY
 * DEFINER function (20261007110000): the table behind it is closed to every
 * client role. This file is pure: shaping and wording only, no network.
 */

export interface PaperPage {
  /** 1-based page number of the printed paper. */
  page: number;
  /** Object path in the private audit-figures bucket. */
  object_path: string;
}

/** Rows from the RPC, cleaned: numbers only, a path only, in page order, one per page. */
export function normalisePaperPages(raw: unknown): PaperPage[] {
  const rows = Array.isArray(raw) ? raw : [];
  const byPage = new Map<number, PaperPage>();
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const page = typeof o.page === 'number' ? o.page : typeof o.page === 'string' ? Number(o.page) : NaN;
    const path = typeof o.object_path === 'string' ? o.object_path.trim() : '';
    if (!Number.isInteger(page) || page < 1 || !path || path.startsWith('/') || path.includes('..')) continue;
    if (!byPage.has(page)) byPage.set(page, { page, object_path: path });
  }
  return [...byPage.values()].sort((a, b) => a.page - b.page);
}

/** Keep a page index inside the list. */
export function clampPageIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(Math.max(Math.trunc(index) || 0, 0), count - 1);
}

/** Where to start flipping: the question's own page when the paper has a picture of it, else the first. */
export function startPageIndex(pages: PaperPage[], questionPage: number | null | undefined): number {
  if (typeof questionPage !== 'number') return 0;
  const i = pages.findIndex((p) => p.page === questionPage);
  return i >= 0 ? i : 0;
}

export function pageLabel(pages: PaperPage[], index: number): string {
  const i = clampPageIndex(index, pages.length);
  const p = pages[i];
  return p ? `Page ${p.page}` : '';
}

export function positionLabel(pages: PaperPage[], index: number): string {
  if (pages.length === 0) return '';
  return `${clampPageIndex(index, pages.length) + 1} of ${pages.length}`;
}

export const WHOLE_PAPER_TITLE = 'No page matched this question, so here is the whole paper';
export const WHOLE_PAPER_NOTE = 'Flip through the pages until you find the question, then check the typed words against it.';
export const NO_PAGES_TITLE = 'This paper has no page pictures yet';
// Shown to verifiers AND to the HOD, so it must not tell the HOD to "ask the HOD".
export const NO_PAGES_NOTE = 'There is nothing to compare the words with. If you are not sure the words are right, do not pass it.';
export const PAGES_FAILED_NOTE = 'The page pictures could not be loaded. Check your internet and try again.';
