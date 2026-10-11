/**
 * Friendly label for the question-type chip on a paper page.
 *
 * bank_questions.qtype holds two vocabularies while the migration to the
 * pipeline enum is in flight: the pipeline names (mcq, short_answer, ...)
 * and the old live strings ('MCQ', 'short', 'Short Answer', 'context:image'
 * ...). Both must read well, so this maps every known value and falls back
 * to a tidied version of anything else. Pure function, no site copy beyond
 * these labels, and no dashes in them.
 */

const LABELS: Record<string, string> = {
  // Pipeline enum
  mcq: 'MCQ',
  short_answer: 'Short answer',
  long_answer: 'Long answer',
  fill_in_blank: 'Fill in the blank',
  true_false: 'True or false',
  definition: 'Definition',
  identify: 'Identify',
  composition: 'Composition',
  context_thematic: 'Thematic',
  context_image: 'Picture based',
  context_quote: 'Quotation',
  context_map: 'Map based',
  other: 'Other',
  // Old live vocabulary, matched case-insensitively after normalising
  short: 'Short answer',
  long: 'Long answer',
  sub: 'Short answer',
  fill_in_the_blank: 'Fill in the blank',
  'true/false': 'True or false',
  'context:thematic': 'Thematic',
  'context:image': 'Picture based',
  'context:picture': 'Picture based',
  'context:quote': 'Quotation',
  'context:map': 'Map based',
  'context:passage': 'Passage',
  'context:prose_extract': 'Prose extract',
  'context:poem_extract': 'Poem extract',
  'context:dialogue': 'Dialogue',
  'context:table': 'Table based',
};

function normalise(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '_');
}

/** The chip text for a qtype, or null when there is nothing to show. */
export function qtypeLabel(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const key = normalise(trimmed);
  const hit = LABELS[key];
  if (hit) return hit;
  // Unknown value: tidy it rather than print a raw token.
  const words = key.replace(/[:_/]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
