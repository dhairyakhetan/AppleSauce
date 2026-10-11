/**
 * Filters filter_* query-string values down to ones the site actually
 * recognises.
 *
 * PaperResults reflects `filter_classes`/`filter_subjects`/`filter_boards`/
 * `filter_schools` straight from the URL into the page heading, the <title>
 * and the Supabase query itself. Nothing checked a value against a real
 * class, subject or board before that -- a malformed link
 * (?filter_classes=%25%25%25) or a crafted one (?filter_classes=BUY+CHEAP+WATCHES)
 * rendered verbatim: "Class %%% papers | Shikshaq", a headline that is
 * simply untrue (there is no "Class %%%") and a low-effort spam-title vector
 * since any query string could steer the indexable <title>.
 *
 * This is that check: case-insensitive against a known vocabulary, deduped,
 * with each surviving value rewritten to the vocabulary's own casing so two
 * spellings of the same value ("maths" and "Maths") don't produce two chips.
 * A value with no match in the vocabulary is dropped, not echoed.
 */
export function filterToKnownVocabulary(
  values: readonly string[],
  knownValues: Iterable<string>,
): string[] {
  const byLower = new Map<string, string>();
  for (const known of knownValues) {
    const key = known.trim().toLowerCase();
    if (key && !byLower.has(key)) byLower.set(key, known);
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const canonical = byLower.get(raw.trim().toLowerCase());
    if (canonical && !seen.has(canonical)) {
      seen.add(canonical);
      out.push(canonical);
    }
  }
  return out;
}
