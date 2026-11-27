/**
 * "Class 10" for a class number or Roman numeral, and the words as they are for anything else.
 *
 * Bylines used to put "Class" in front of whatever the grade field held, so a reviewer read "Class Other" and
 * "Class UG, First Year" (site-wide audit B9, 27 Nov 2026). Returns null for an empty grade.
 */
export function classLabel(grade: string | null | undefined): string | null {
  const g = String(grade ?? '').trim();
  if (!g) return null;
  return /^(\d{1,2}|[ivx]{1,5})$/i.test(g) ? `Class ${g}` : g;
}
