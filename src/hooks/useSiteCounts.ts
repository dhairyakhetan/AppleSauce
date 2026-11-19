import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { fetchBankSchoolValues } from '@/lib/question-bank';
import { fetchListedTeacherCount } from '@/lib/listed-teachers';
import { readablePapersCountQuery } from '@/lib/readable-papers';

/**
 * The three figures the site describes itself with: verified teachers,
 * readable papers (listed and not Coming soon: lib/readable-papers.ts), and
 * the number of schools those papers came from.
 *
 * There are four hand-rolled copies of this query in the codebase already
 * (Navbar, ProductTour, About, papers-live-announcement), each with its own
 * caching, its own error handling and its own idea of which table to count.
 * This is the canonical one. New callers use it; the existing four can be
 * retired onto it one at a time.
 *
 * A count that does not arrive stays `null` and its caller draws nothing,
 * rather than rendering a zero or a plausible-looking figure. That is the
 * site's standing rule for numbers and the reason this returns nulls instead
 * of defaulting to 0.
 */
export interface SiteCounts {
  teachers: number | null;
  papers: number | null;
  schools: number | null;
}

/* Papers and schools. Teachers are NOT read here: see fetchListedTeacherCount
   (lib/listed-teachers.ts) for why a plain teachers_list count is wrong. */
async function loadPapersAndSchools(): Promise<Pick<SiteCounts, 'papers' | 'schools'>> {
  /* One RPC where this used to be three round trips, the third of which
     paged every row of bank_papers -- all 1,282 of them, ~100KB -- purely
     to count distinct schools, on every page load, because the Footer
     renders everywhere and there is no distinct-count over REST.
     Falls back to the old path while migration 20260917120002 has not been
     applied, so this is safe to deploy before or after it. Once applied,
     the fallback and fetchBankSchoolValues' other callers can go. */
  const { data, error } = await supabase.rpc('site_counts' as never);
  const missingFn = error && (error.code === 'PGRST202' || /does not exist/i.test(error.message ?? ''));

  if (!missingFn && !error) {
    const rows = (data ?? []) as unknown;
    const row = (Array.isArray(rows) ? rows[0] : rows) as
      | { teachers: number; papers: number; schools: number }
      | undefined;
    if (row) {
      return {
        papers: Number(row.papers) || null,
        schools: Number(row.schools) || null,
      };
    }
  }

  const [papers, schools] = await Promise.all([
    /* Readable papers only (owner, 12 October 2026): the same rule
       site_counts() now applies, written once in lib/readable-papers.ts.
       The 2026-09-26 decision to count needs_review papers is reversed:
       Coming soon papers stay listed in the library but are not a total. */
    readablePapersCountQuery(supabase),
    /* has_school = true: a board-level row (is_board_paper) carries a
       board name, not a school, in the `school` column, and counting it
       as a distinct school is exactly what made this figure indefensible.
       scripts/generate-bank-sql.ts's own distinct_schools report already
       filters the same way. */
    fetchBankSchoolValues(true, true),
  ]);

  return {
    papers: papers.count ?? null,
    schools: new Set(schools.filter(Boolean)).size || null,
  };
}

export function useSiteCounts() {
  return useQuery<SiteCounts>({
    queryKey: ['site', 'counts'],
    /* These move a handful of times a week at most, and every surface that
       shows them is chrome rather than the page's subject. */
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [teachers, rest] = await Promise.all([fetchListedTeacherCount(), loadPapersAndSchools()]);
      return { teachers, papers: rest.papers, schools: rest.schools };
    },
  });
}
