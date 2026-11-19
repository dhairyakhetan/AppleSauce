/**
 * Multiple-choice options as the checker shows them.
 *
 * audit_questions.options holds two shapes: 15,657 rows are plain strings
 * (the pipeline's shape, the same one the public paper page reads) and 186 are
 * {label, text} objects. The checker used to read only `.text`, so every
 * string option rendered as an empty line. Both shapes are normalised here.
 *
 * Nothing is altered: order is the stored (printed) order, never sorted by
 * label, and text is passed on verbatim. A string option is NOT given a
 * letter: many already carry their own ("a. Dominion status"), and inventing
 * one would be writing paper data the paper does not have.
 */

export type RawOption = string | { label?: string | null; text?: string | null } | null | undefined;

export interface ShownOption {
  /** Printed label, only when the data has one as its own field. */
  label: string | null;
  text: string;
}

export function normaliseOptions(options: RawOption[] | null | undefined): ShownOption[] {
  if (!Array.isArray(options)) return [];
  const out: ShownOption[] = [];
  for (const o of options) {
    if (typeof o === 'string') {
      if (o.trim() !== '') out.push({ label: null, text: o });
    } else if (o && typeof o === 'object') {
      const text = typeof o.text === 'string' ? o.text : '';
      const label = typeof o.label === 'string' && o.label.trim() !== '' ? o.label : null;
      if (text.trim() !== '' || label) out.push({ label, text });
    }
  }
  return out;
}
