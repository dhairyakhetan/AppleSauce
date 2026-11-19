/* The one place the two subject vocabularies are reconciled.
 *
 * The question bank and the rest of the site name the same subject
 * differently. `bank_papers.subject` says "Mathematics"; every facet, filter,
 * route and label on the site says "Maths". History & Civics and Economics
 * happen to agree, so the mismatch is invisible until you look at the busiest
 * subject there is.
 *
 * That gap has now caused the same class of bug three times:
 *   - BankPaper's "Find a {subject} teacher" linked to
 *     ?filter_subjects=Mathematics, which no teacher matches.
 *   - PaperResults tagged EVERY bank paper subject:'Maths', so filtering the
 *     papers surface by History & Civics returned none of its 302 papers and
 *     each one rendered as "Class X Mathematics".
 *   - Browse's "{Subject} papers too" promo counted only the `papers` table,
 *     so the Maths page advertised 4 papers when 197 existed.
 *
 * So the mapping lives here rather than being re-declared per file, and both
 * directions are exported: a page going bank -> site needs one, a page going
 * site -> bank needs the other.
 */

/** bank_papers.subject -> the label the site uses everywhere else. */
const BANK_TO_SITE: Record<string, string> = {
  mathematics: 'Maths',
};

/** The reverse. Built from the same table so the two cannot drift apart. */
const SITE_TO_BANK: Record<string, string> = Object.fromEntries(
  Object.entries(BANK_TO_SITE).map(([bank, site]) => [site.toLowerCase(), bank]),
);

/** The site's label for a bank subject. Unknown subjects pass through. */
export function bankSubjectToSite(subject: string | null | undefined): string {
  const s = (subject ?? '').trim();
  if (!s) return '';
  return BANK_TO_SITE[s.toLowerCase()] ?? s;
}

/**
 * True when a site-side subject filter should match a bank paper.
 *
 * Compares in the SITE vocabulary, so "Maths" matches a bank row whose subject
 * is "Mathematics", and "History & Civics" matches itself. Case-insensitive
 * because filter values arrive from query strings.
 */
export function bankSubjectMatches(siteLabel: string, bankSubject: string): boolean {
  const want = siteLabel.trim().toLowerCase();
  if (!want) return true;
  const have = bankSubjectToSite(bankSubject).toLowerCase();
  if (want === have) return true;
  // Also accept the raw bank spelling, so an existing link that already says
  // ?filter_subjects=Mathematics keeps working rather than silently breaking.
  return want === (bankSubject ?? '').trim().toLowerCase()
    || SITE_TO_BANK[want] === (bankSubject ?? '').trim().toLowerCase();
}

/** Every site label the bank actually has papers for. */
export const BANK_SUBJECT_SITE_LABELS = ['Maths', 'History & Civics', 'Economics'] as const;
