/* The category headings on /past-papers (By subject, By board) as data, not
   as a fixed list.

   They used to be `SUBJECTS.filter(has papers).slice(0, 8)`: a hard-coded
   vocabulary cut at eight, so a ninth subject, or any subject the site's own
   list does not know, never showed up however many papers it had. Now every
   facet value that has at least one paper is listed. Biggest first, so the
   headings that show before "Show all" are the ones with the most papers. The page shows the first few, a "Show all" button for the rest,
   and a search box once there are enough of them to need one. Pure, so it is
   pinned by tests. */

/** How many headings show before "Show all". */
export const FACET_LIMIT = 8;

/** The search box appears only when there are more headings than this. */
export const FACET_SEARCH_FROM = 8;

/** Every value with at least one paper, biggest first (so the few that show
 *  before "Show all" are the ones with the most papers), ties broken by the
 *  curated order and then by name. */
export function orderFacets(known: readonly string[], counts: Record<string, number>): string[] {
  const rank = (v: string) => {
    const i = known.indexOf(v);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return Object.keys(counts)
    .filter((v) => (counts[v] ?? 0) > 0)
    .sort((a, b) => counts[b] - counts[a] || rank(a) - rank(b) || a.localeCompare(b));
}

/** Case-insensitive match on the heading, ignoring surrounding spaces. */
export function searchFacets(values: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  return q ? values.filter((v) => v.toLowerCase().includes(q)) : [...values];
}

export interface FacetView {
  /** The headings to draw now. */
  shown: string[];
  /** How many headings match (all of them when there is no search). */
  matching: number;
  /** How many exist in total. */
  total: number;
  /** Headings hidden behind "Show all". */
  hidden: number;
  searchable: boolean;
}

/** What to draw: with a search, every match; without, the first FACET_LIMIT
 *  unless expanded. */
export function facetView(values: readonly string[], query: string, expanded: boolean, limit = FACET_LIMIT): FacetView {
  const matches = searchFacets(values, query);
  const searching = query.trim() !== '';
  const shown = searching || expanded ? matches : matches.slice(0, limit);
  return {
    shown,
    matching: matches.length,
    total: values.length,
    hidden: matches.length - shown.length,
    searchable: values.length > FACET_SEARCH_FROM,
  };
}
