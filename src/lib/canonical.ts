/**
 * One place that decides what a route's canonical URL is.
 *
 * Two components write <link rel="canonical">: CanonicalTag, mounted above
 * <Routes>, and SEOHead, rendered by a page. SEOHead runs later and silently
 * wins, so a rule applied in only one of them does nothing — which is exactly
 * what happened when the alias below was added to CanonicalTag alone. Both now
 * resolve through this function.
 */

/**
 * Routes that serve a byte-identical result set to another route.
 *
 * `/commercial-studies-` and `/commerce-` both map to the filter value
 * "Commerce" in src/utils/subjectMapping.ts and return the SAME 29 teachers in
 * the same order — verified against live data. Two indexed URLs, one page:
 * the duplicate-content case rel=canonical exists for.
 *
 * This is deliberately NOT a decision about which subject name is right, and
 * not a redirect that would take a working URL away from anyone using it. It
 * states what is already true — these are the same page — so search engines
 * consolidate onto one instead of the two competing for the same query.
 *
 * "Commerce" is the target: the shorter, more-searched term, and the one the
 * filter value itself uses. If the two lists ever diverge, delete the entry.
 */
const CANONICAL_ALIASES: Record<string, string> = {
  '/commercial-studies-tuition-teachers-in-kolkata': '/commerce-tuition-teachers-in-kolkata',
};

/** Normalise a pathname and resolve any duplicate-route alias. */
export function canonicalPathFor(pathname: string): string {
  // Drop the trailing slash so /faq/ and /faq don't canonicalise differently.
  const stripped = pathname.length > 1 ? pathname.replace(/\/+$/, '') : '/';
  /* A path of only slashes -- "//", "///" -- strips down to nothing, and the
     callers concatenate this onto the origin, so an empty string would emit a
     canonical URL with no path at all. Those requests are reachable: a stray
     double slash in a link or a crawler normalising badly is enough. Collapse
     them to the root, which is the page they actually serve. */
  const trimmed = stripped === '' ? '/' : stripped;
  return CANONICAL_ALIASES[trimmed] ?? trimmed;
}
