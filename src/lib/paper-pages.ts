/**
 * The whole-paper fallback. When no page picture matched a question, the
 * screen shows every page picture of the paper as a page-flip instead of
 * telling the reader to judge from the words alone (owner, 7 Oct 2026).
 *
 * The list of a paper's pages comes from paper_page_pictures(), a SECURITY
 * DEFINER function (20261007110000): the table behind it is closed to every
 * client role. This file is pure: shaping and wording only, no network.
 */

import { normaliseRotation, type PageRotation } from '@/lib/page-rotation';
import { SLOW_WORDS } from '@/lib/checker-timeout';

export interface PaperPage {
  /** 1-based page number of the printed paper. */
  page: number;
  /** Object path in the private audit-figures bucket. */
  object_path: string;
  /** Clockwise quarter turns, in degrees, that make the stored picture read upright. Missing = 0 (page-rotation.ts). */
  rotation?: PageRotation;
}

/** Rows from the RPC, cleaned: numbers only, a path only, a turn only when it is a quarter turn, in page order, one per page. */
export function normalisePaperPages(raw: unknown): PaperPage[] {
  const rows = Array.isArray(raw) ? raw : [];
  const byPage = new Map<number, PaperPage>();
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const page = typeof o.page === 'number' ? o.page : typeof o.page === 'string' ? Number(o.page) : NaN;
    const path = typeof o.object_path === 'string' ? o.object_path.trim() : '';
    if (!Number.isInteger(page) || page < 1 || !path || path.startsWith('/') || path.includes('..')) continue;
    if (byPage.has(page)) continue;
    const rotation = normaliseRotation(o.rotation);
    // Only a real turn is carried; a page with none keeps the exact shape it always had.
    byPage.set(page, rotation === 0 ? { page, object_path: path } : { page, object_path: path, rotation });
  }
  return [...byPage.values()].sort((a, b) => a.page - b.page);
}

/**
 * A page number read from a question's source: a whole number from 1 to 999, given as a number or
 * as text ("4"). Anything else is null. The database accepts the page as text too, so the flip must
 * not ignore a question just because its page came as a string.
 */
export function pageNumberOf(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d{1,3}$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 999 ? n : null;
}

/**
 * Said when the question's own page has no picture, so the flip never opens on page 1 as if nothing
 * were wrong (tracker of 2 Nov, "it jumps to page 3" and "the questions do not match the paper").
 * Empty when the page has a picture, when the page is not known, or when the paper has no pictures
 * at all (that case has its own message).
 */
export function ownPageNote(pages: PaperPage[], questionPage: number | null | undefined): string {
  if (typeof questionPage !== 'number' || pages.length === 0) return '';
  if (pages.some((p) => p.page === questionPage)) return '';
  return `This question is on page ${questionPage}, which has no picture yet. The flip starts at the first page we have. If you cannot find the question, do not pass it.`;
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

/** Page numbers below the last stored page that have no picture (a paper with pictures of pages 1 and 3 is missing 2). */
export function missingPages(pages: PaperPage[]): number[] {
  if (pages.length === 0) return [];
  const have = new Set(pages.map((p) => p.page));
  const last = pages[pages.length - 1].page;
  const out: number[] = [];
  for (let n = 1; n < last; n += 1) if (!have.has(n)) out.push(n);
  return out;
}

/** "Page 3 of 5" from real page numbers, so a gap never reads as "2 of 2" beside "Page 3". The total is the last page we hold. */
export function pageOfLabel(pages: PaperPage[], index: number): string {
  if (pages.length === 0) return '';
  const p = pages[clampPageIndex(index, pages.length)];
  return `Page ${p.page} of ${pages[pages.length - 1].page}`;
}

/** Says plainly which pages have no picture yet; empty when the run of pages is complete. */
export function missingPagesNote(pages: PaperPage[]): string {
  const gaps = missingPages(pages);
  if (gaps.length === 0) return '';
  const list = gaps.length === 1 ? `Page ${gaps[0]} is` : `Pages ${gaps.slice(0, -1).join(', ')} and ${gaps[gaps.length - 1]} are`;
  return `${list} not available yet, so the flip skips ahead. If the question is not on a page you can see, do not pass it.`;
}

export const WHOLE_PAPER_TITLE = 'No page matched this question, so here is the whole paper';
export const WHOLE_PAPER_NOTE = 'Flip through the pages until you find the question, then check the typed words against it.';
export const NO_PAGES_TITLE = 'This paper has no page pictures yet';
// Shown to verifiers AND to the HOD, so it must not tell the HOD to "ask the HOD".
export const NO_PAGES_NOTE = 'There is nothing to compare the words with. If you are not sure the words are right, do not pass it.';
export const PAGES_FAILED_NOTE = `The page pictures did not load. ${SLOW_WORDS}`;
