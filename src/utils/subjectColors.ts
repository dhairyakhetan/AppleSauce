/**
 * Per-subject colour ramp for subject tiles (SubjectCard and anything else
 * that needs a subject's tint/solid/text colours).
 *
 * This used to be a full second implementation of the subject-color
 * generator, verbatim-duplicated from src/lib/subject-palette.ts (same 8
 * seeds, same HSL math, its own re-implementation of the WCAG contrast
 * check) with a different return shape and a different alias-matching
 * strategy. The two could disagree for the same subject.
 *
 * src/lib/subject-palette.ts is now the single canonical implementation.
 * This file is a thin adapter that maps its `SubjectPalette` shape onto the
 * `SubjectColorSet` shape this module has always exported, so every existing
 * consumer (SubjectCard, JoinApply, etc.) keeps working unchanged.
 */

import { getSubjectPalette } from '@/lib/subject-palette';

export interface SubjectColorSet {
  tint: string;
  solid: string;
  titleText: string;
  metaText: string;
  badgeText: string;
}

const cache = new Map<string, SubjectColorSet>();

/**
 * Resolve the colour set for a subject name (e.g. "Maths", "Computers",
 * "History & Civics"). Unknown/unseeded subjects get the neutral fallback.
 */
export function getSubjectColors(subjectName: string | null | undefined): SubjectColorSet {
  const key = (subjectName ?? '').trim().toLowerCase();
  if (!key) {
    const p = getSubjectPalette(null);
    return { tint: p.tint, solid: p.solid, titleText: p.text, metaText: p.meta, badgeText: p.badgeText };
  }

  const cached = cache.get(key);
  if (cached) return cached;

  const p = getSubjectPalette(subjectName);
  const result: SubjectColorSet = {
    tint: p.tint,
    solid: p.solid,
    titleText: p.text,
    metaText: p.meta,
    badgeText: p.badgeText,
  };

  cache.set(key, result);
  return result;
}
