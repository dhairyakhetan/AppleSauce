/**
 * The "Ghar pe tuition in Kolkata" section on subject pages.
 *
 * Parents search "ghar pe tuition" and "home tutor" as much as "tuition
 * teacher", so the subject pages say it once, in plain words, in visible text.
 * Shared by SEOContentBlock (browser) and scripts/prerender.ts (crawler) so the
 * two carry the same sentences.
 *
 * Every claim here is one the product supports: the Browse page has an area
 * filter, a class filter and a "Home tuition" place filter, and a teacher's
 * profile links to WhatsApp. Nothing about fees, availability or guarantees.
 */

export const GHAR_PE_HEADING = 'Ghar pe tuition in Kolkata';

/** Acronym subjects keep their case; ordinary words read better lower-cased. */
function inSentence(label: string): string {
  return /^[A-Z0-9&\s/-]+$/.test(label) ? label : label.toLowerCase();
}

export function gharPeParagraph(label: string): string {
  const subject = inSentence(label);
  return `Looking for ghar pe ${subject} tuition, or a ${subject} home tutor near you? Filter the teachers above by area and class, and switch on Home tuition to see tutors who teach at the student's home. `
    + 'Open any profile to check their subjects, classes and boards, then message the teacher directly on WhatsApp.';
}
