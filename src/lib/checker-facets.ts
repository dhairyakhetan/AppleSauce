/**
 * The "My subjects" picker's choices, for the paper checker.
 *
 * The queue filters on audit_papers.subject / audit_papers.class exactly
 * (checker_next_question: `ap.subject = any(v_subjects)`). Those values are
 * 'Mathematics', 'History & Civics', 'X', 'XII'. The picker used to offer the
 * SITE's facet lists (src/utils/searchFacets.ts: 'Maths', 'Computers', '10',
 * '12'), so picking Maths or any class matched nothing and the checker was
 * told "All done for now" with 840 questions waiting (measured 2026-09-28:
 * every one of the 840 kid rows has a Roman class; 260 are 'Mathematics').
 *
 * Choices therefore come from what is really waiting (checker_queue_facets),
 * with counts; the static fallback below is the audit vocabulary, used only
 * until that RPC is deployed.
 */

import type { CheckerPreferences, QueueFacetRow } from '@/lib/checker-api';

/** Whether to open the first-use "Which papers?" prompt. "All" is saved as
 *  two nulls, so without `chosen` a checker who picked All was asked again
 *  on every visit. */
export function shouldAskForPreferences(p: CheckerPreferences): boolean {
  if (typeof p.chosen === 'boolean') return !p.chosen;
  return (p.subjects === null || p.subjects.length === 0) && (p.classes === null || p.classes.length === 0);
}

export interface FacetChoice {
  value: string;
  /** Questions waiting, or null when unknown (static fallback). */
  waiting: number | null;
}

export const FALLBACK_SUBJECTS = [
  'Accounts', 'Biology', 'Business Studies', 'Chemistry', 'Commerce', 'Commercial Studies',
  'Computer Applications', 'Computer Science', 'Economics', 'English', 'English Language',
  'English Literature', 'Geography', 'Hindi', 'History & Civics', 'Mathematics', 'Physics',
  'Psychology', 'Sociology',
];

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
export const FALLBACK_CLASSES = ROMAN;

function classRank(c: string): number {
  const i = ROMAN.indexOf(c.trim().toUpperCase());
  if (i >= 0) return i;
  const n = Number(c);
  return Number.isFinite(n) ? n - 1 : 100;
}

/** "X" -> "Class X (10)", so a student who thinks in numbers still finds it. */
export function classLabel(c: string): string {
  const i = ROMAN.indexOf(c.trim().toUpperCase());
  return i >= 0 ? `${c} (${i + 1})` : c;
}

export function facetChoices(rows: QueueFacetRow[] | null | undefined): {
  subjects: FacetChoice[];
  classes: FacetChoice[];
} {
  if (!rows) {
    return {
      subjects: FALLBACK_SUBJECTS.map((value) => ({ value, waiting: null })),
      classes: FALLBACK_CLASSES.map((value) => ({ value, waiting: null })),
    };
  }
  const subjects = new Map<string, number>();
  const classes = new Map<string, number>();
  for (const r of rows) {
    const n = Number(r.waiting) || 0;
    if (r.subject) subjects.set(r.subject, (subjects.get(r.subject) ?? 0) + n);
    if (r.cls) classes.set(r.cls, (classes.get(r.cls) ?? 0) + n);
  }
  return {
    subjects: [...subjects.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([value, waiting]) => ({ value, waiting })),
    classes: [...classes.entries()]
      .sort((a, b) => classRank(a[0]) - classRank(b[0]))
      .map(([value, waiting]) => ({ value, waiting })),
  };
}

/**
 * Drops saved picks the queue no longer offers ('Maths', '10' saved before
 * this fix), so a stale pick cannot keep the queue empty. Only applied when
 * the real facet list is known.
 */
export function keepOffered(picked: string[], offered: FacetChoice[] | null): string[] {
  if (!offered) return picked;
  const ok = new Set(offered.map((o) => o.value));
  return picked.filter((p) => ok.has(p));
}

/** How many questions the current picks would serve, when known. */
export function waitingFor(
  rows: QueueFacetRow[] | null | undefined,
  subjects: string[],
  classes: string[],
): number | null {
  if (!rows) return null;
  return rows
    .filter((r) => subjects.length === 0 || (r.subject !== null && subjects.includes(r.subject)))
    .filter((r) => classes.length === 0 || (r.cls !== null && classes.includes(r.cls)))
    .reduce((sum, r) => sum + (Number(r.waiting) || 0), 0);
}
