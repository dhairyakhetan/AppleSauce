/**
 * Pure row-transformation logic behind readBankURLs() in generate-sitemap.ts,
 * split out so the "right row count" claim in a published paper/school row
 * set is testable without a live Supabase fetch. The network call and the
 * `fail()` on missing credentials stay in generate-sitemap.ts; this file only
 * turns already-fetched rows into sitemap URLs.
 */

import { schoolSlug } from '../src/lib/school-slug';
import { displaySchool, isRealSchoolLabel } from '../src/lib/school-display';
import { isExcludedPaper } from './excluded-papers';

export interface SitemapURL {
  loc: string;
  lastmod: string;
  changefreq: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority: number;
}

export interface BankPaperRow {
  id: string;
  school: string;
  has_school: boolean;
  created_at: string | null;
}

function toDay(timestamp: string | null | undefined): string | null {
  if (!timestamp) return null;
  const day = String(timestamp).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function newestDay(days: (string | null)[], fallback: string): string {
  const real = days.filter((d): d is string => Boolean(d));
  return real.length ? real.reduce((a, b) => (a > b ? a : b)) : fallback;
}

/**
 * One paper URL per non-excluded published paper, one school URL per
 * distinct school slug among the paper rows that carry a school -- so the
 * paper count is exactly `allRows.length - excluded count`, and the school
 * count is exactly the number of distinct slugs, never the number of raw
 * school-name spellings (two spellings of the same school are one page).
 */
export function buildBankURLs(
  allRows: BankPaperRow[],
  currentDate: string,
): { schools: SitemapURL[]; papers: SitemapURL[]; skipped: number } {
  const rows = allRows.filter((r) => !isExcludedPaper(r.id));
  const skipped = allRows.length - rows.length;

  const daysBySlug = new Map<string, (string | null)[]>();
  rows.forEach((r) => {
    if (!r.has_school) return;
    /* has_school is true for import fragments like "History" too; those
       slugs now render "School not found" (school-display.ts), so listing
       them would advertise soft 404s. */
    if (!isRealSchoolLabel(displaySchool(r.school))) return;
    const slug = schoolSlug(r.school);
    daysBySlug.set(slug, [...(daysBySlug.get(slug) ?? []), toDay(r.created_at)]);
  });

  const schools: SitemapURL[] = [...daysBySlug].map(([slug, days]) => ({
    loc: `/school/${slug}`,
    changefreq: 'weekly',
    priority: 0.5,
    lastmod: newestDay(days, currentDate),
  }));
  const papers: SitemapURL[] = rows.map((r) => ({
    loc: `/past-papers/${r.id}`,
    changefreq: 'yearly',
    priority: 0.6,
    lastmod: toDay(r.created_at) ?? currentDate,
  }));
  return { schools, papers, skipped };
}

/** First occurrence wins, so a location in both sources is one URL, not two. */
export function dedupeByLoc(urls: SitemapURL[]): SitemapURL[] {
  const seen = new Set<string>();
  return urls.filter((url) => {
    if (seen.has(url.loc)) return false;
    seen.add(url.loc);
    return true;
  });
}
