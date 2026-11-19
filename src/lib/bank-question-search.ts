/**
 * In-paper search over the questions the reader actually holds.
 *
 * Matching is read-only: the stored text is never altered, only lower-cased
 * into a throwaway haystack for the comparison.
 *
 * Options are searched along with the stem. A multiple-choice question keeps
 * its choices in `o`, not in `t`, so a student searching for what one option
 * says (a date, a name, a formula) was told "Nothing in this paper matches
 * that" about a paper that plainly contains it. History & Civics and
 * Economics are MCQ-heavy, which is where this bit.
 */
export interface SearchableQuestion {
  t: string;
  o?: string[] | null;
}

export function questionMatchesSearch(row: SearchableQuestion, needle: string): boolean {
  if (!needle) return true;
  if (row.t.toLowerCase().includes(needle)) return true;
  if (!Array.isArray(row.o)) return false;
  return row.o.some((option) => typeof option === 'string' && option.toLowerCase().includes(needle));
}

/** How many questions can actually be searched: held placeholders are cards with
 *  no text, so they never match and must not be counted in "No match in the N
 *  free questions". */
export function searchableCount(rows: { held?: boolean }[]): number {
  return rows.filter((row) => !row.held).length;
}
