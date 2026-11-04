/* The ONE definition of a "readable" paper, and of "Coming soon".

   Owner decision, 12 October 2026: the public paper count counts papers a
   reader can actually open. A paper that is listed but under review stays in
   the library, drawn as "Coming soon", and is simply not part of any total.

     listed        is_published and question_count > 0         (the library)
     coming soon   listed, and needs_review                    (cards say "Soon")
     readable      listed, and not needs_review                (the total)

   Every figure that says how many papers the site has, and the library
   heading, goes through this file. Nothing else may decide that a paper is
   or is not countable. site_counts() in SQL is the one other place the same
   rule is written down (migration 20261012980000_site_counts_readable_papers);
   readable-papers.test.ts keeps the two in step.

   Pure on purpose: no supabase client, no browser APIs. scripts/prerender.ts
   and scripts/generate-sitemap.ts run in node and import this directly. */

/** The two spellings a paper row carries on the site: `needsReview` (the
 *  BankPaper shape and PaperResults) and `_needsReview` (the cover mapping
 *  PastPapers and the home rail build). Either one marks Coming soon. */
export interface ComingSoonShape {
  needsReview?: boolean | null;
  _needsReview?: boolean | null;
}

/** A bank_papers row as the database stores it. */
export interface PaperRowShape {
  is_published?: boolean | null;
  question_count?: number | null;
  needs_review?: boolean | null;
}

/** Listed in the library but not openable yet. */
export function isComingSoon(p: ComingSoonShape): boolean {
  return p.needsReview === true || p._needsReview === true;
}

/** A paper that appears in the library at all: published, with questions. */
export function isListedRow(r: PaperRowShape): boolean {
  return r.is_published === true && (r.question_count ?? 0) > 0;
}

/** A paper a reader can open: listed, and not Coming soon. */
export function isReadableRow(r: PaperRowShape): boolean {
  return isListedRow(r) && r.needs_review !== true;
}

export interface PaperCounts {
  /** Papers a reader can open. This is the number the site advertises. */
  ready: number;
  /** Listed but not openable yet. Never part of a total. */
  comingSoon: number;
  /** ready + comingSoon: how many cards the library draws. */
  listed: number;
}

/** Split a list of already-listed papers into ready and Coming soon. */
export function countPapers(papers: ReadonlyArray<ComingSoonShape>): PaperCounts {
  let comingSoon = 0;
  for (const p of papers) if (isComingSoon(p)) comingSoon += 1;
  return { ready: papers.length - comingSoon, comingSoon, listed: papers.length };
}

/** Same split over raw bank_papers rows; an unlisted row counts as neither. */
export function countPaperRows(rows: ReadonlyArray<PaperRowShape>): PaperCounts {
  let ready = 0;
  let comingSoon = 0;
  for (const r of rows) {
    if (!isListedRow(r)) continue;
    if (r.needs_review === true) comingSoon += 1;
    else ready += 1;
  }
  return { ready, comingSoon, listed: ready + comingSoon };
}

/** The school total: distinct schools with at least one READABLE paper. A
 *  school whose only papers are Coming soon keeps its page but is not counted.
 *  Mirrors site_counts() (migration 20261012981000): board-level rows
 *  (has_school false) and blank names never count as a school. */
export function countReadableSchools(
  rows: ReadonlyArray<PaperRowShape & { school?: string | null; has_school?: boolean | null }>,
): number {
  const schools = new Set<string>();
  for (const r of rows) {
    if (!isReadableRow(r) || r.has_school !== true) continue;
    if (r.school == null || r.school.trim() === '') continue;
    schools.add(r.school);
  }
  return schools.size;
}

/** "N papers ready, M coming soon". With nothing coming soon the second
 *  clause is dropped rather than printing "0 coming soon". */
export function paperCountLabel(ready: number, comingSoon: number): string {
  const n = (v: number) => v.toLocaleString('en-IN');
  const head = `${n(ready)} paper${ready === 1 ? '' : 's'} ready`;
  return comingSoon > 0 ? `${head}, ${n(comingSoon)} coming soon` : head;
}

/** The head-only count query for readable papers, for the one place that has
 *  to ask the table directly (useSiteCounts' fallback when site_counts() is
 *  unreachable). The client is passed in so this file stays free of the
 *  browser-only supabase module. */
export function readablePapersCountQuery(client: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: 'bank_papers') => any;
}) {
  return client
    .from('bank_papers')
    .select('id', { count: 'exact', head: true })
    .eq('is_published', true)
    .gt('question_count', 0)
    .eq('needs_review', false);
}
