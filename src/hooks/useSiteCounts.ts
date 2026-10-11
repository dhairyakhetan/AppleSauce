import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { fetchBankSchoolValues } from '@/lib/question-bank';

/**
 * The three figures the site describes itself with: verified teachers,
 * published papers, and the number of schools those papers came from.
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

export function useSiteCounts() {
  return useQuery<SiteCounts>({
    queryKey: ['site', 'counts'],
    /* These move a handful of times a week at most, and every surface that
       shows them is chrome rather than the page's subject. */
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
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
            teachers: Number(row.teachers) || null,
            papers: Number(row.papers) || null,
            schools: Number(row.schools) || null,
          };
        }
      }

      const [teachers, papers, schools] = await Promise.all([
        supabase.from('teachers_list').select('id', { count: 'exact', head: true }),
        /* 2026-09-26: the product owner decided the headline figure should
           count every listed paper, needs_review or not -- a gated paper is
           still a real paper the site hosts, just not openable yet. This is
           an intentional reversal of the 20260926020000 exclusion; keep in
           sync with site_counts() (20260926030000) and any other caller that
           still filters needs_review for a count. */
        supabase
          .from('bank_papers')
          .select('id', { count: 'exact', head: true })
          .eq('is_published', true).gt('question_count', 0),
        /* has_school = true: a board-level row (is_board_paper) carries a
           board name, not a school, in the `school` column, and counting it
           as a distinct school is exactly what made this figure indefensible.
           scripts/generate-bank-sql.ts's own distinct_schools report already
           filters the same way. */
        fetchBankSchoolValues(true),
      ]);

      return {
        teachers: teachers.count ?? null,
        papers: papers.count ?? null,
        schools: new Set(schools.filter(Boolean)).size || null,
      };
    },
  });
}
