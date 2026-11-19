/**
 * Picks which one of a teacher's comma/slash-separated facet values (subject
 * or area) a Browse result card should show, when a filter on that facet is
 * active.
 *
 * Round 1 fixed this for Subject only (Browse.tsx's `matchedFilterSubject`):
 * the card badge always showed the teacher's first-listed subject, even when
 * a subject filter was active and the card matched on a DIFFERENT subject —
 * a multi-subject teacher filtered on "Maths" could show "Commerce" instead,
 * if that happened to be listed first. Round 2 (RM1) found the identical bug
 * for Area: under an active "Salt Lake" filter, most multi-area teacher cards
 * showed a different area than the one just filtered for (their first-listed
 * area), reading as if the filter had silently failed even though it had not.
 * Confirmed live at
 * /all-tuition-teachers-in-kolkata?filter_subjects=Maths&filter_classes=10&filter_areas=Salt+Lake.
 *
 * Both need the SAME fix: show the first active filter value that actually
 * appears among the teacher's tokens for that facet — the same whole-token
 * matching filterShikshaqRecords (src/lib/teacher-facet-match.ts) used to
 * decide the teacher matched in the first place — falling back to the
 * teacher's first-listed value only when no filter value on that facet
 * matches (i.e. the facet isn't filtered, or the teacher matched on a
 * different facet entirely).
 *
 * Kept here rather than folded into teacher-facet-match.ts because that file
 * matches whole RECORDS against a full FilterState; this is a narrower,
 * display-only concern (which single token to print) shared by both facets.
 */
export function firstMatchingToken(
  filterValues: string[],
  recordTokens: string[],
  /** Optional per-value synonym expansion (subject only — e.g. "Accountancy"
   *  filter should also match a teacher's "Accounts" token). Return
   *  `undefined` to fall back to a plain case-insensitive token match. */
  synonymsFor?: (filterValueLower: string) => string[] | undefined,
): string | null {
  const tokensLower = recordTokens.map((t) => t.trim().toLowerCase());
  const match = filterValues.find((fv) => {
    const fvLower = fv.trim().toLowerCase();
    const synonyms = synonymsFor?.(fvLower);
    if (synonyms) return synonyms.some((s) => tokensLower.includes(s));
    return tokensLower.includes(fvLower);
  });
  return match ?? null;
}

/** Splits a comma/slash-separated Shikshaqmine facet field into trimmed
 *  tokens — the same tokenisation filterShikshaqRecords' `tokenize()` helper
 *  uses for Area (and boards/classSize/mode/place), so a card badge and the
 *  filter predicate that decided the teacher matched agree on what counts as
 *  one token (e.g. "Salt Lake, Newtown / Rajarhat" -> 3 tokens, not 2). */
export function tokenizeFacetField(value: string | null | undefined): string[] {
  return (value || '').split(/\s*[,/]\s*/).map((t) => t.trim()).filter(Boolean);
}

/** The subject-synonym rules filterShikshaqRecords applies (Accountancy/
 *  Accounts, Computers/Computer, Drawing variants, Social Studies). Exported
 *  so Browse.tsx's subject badge and any other subject-badge caller share one
 *  copy instead of each re-declaring the same six special cases. */
export function subjectFilterSynonyms(filterValueLower: string): string[] | undefined {
  if (filterValueLower === 'accountancy') return ['accountancy', 'accounts'];
  if (filterValueLower === 'computers') return ['computers', 'computer'];
  if (filterValueLower === 'computer') return ['computer'];
  if (filterValueLower === 'drawing & painting' || filterValueLower === 'drawing and painting') {
    return ['drawing & painting', 'drawing and painting', 'drawing'];
  }
  if (filterValueLower === 'drawing') return ['drawing'];
  if (filterValueLower === 'social studies') return ['history & civics', 'geography', 'social studies'];
  return undefined;
}
