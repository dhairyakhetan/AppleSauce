/**
 * Locality x subject landing pages: /maths-tuition-teachers-in-salt-lake.
 *
 * Decided by DATA, not by a list: a page exists only for a (subject, area) pair
 * with at least MIN_LOCALITY_TEACHERS real, published, unpaused teachers, so no
 * page is ever a template with a place name swapped in. The same pure functions
 * run in three places, which is why they live here and import nothing from the
 * browser or Supabase:
 *
 *   scripts/generate-locality-pages.ts  decides which pages exist (prebuild)
 *   scripts/prerender.ts                writes each page's crawlable HTML
 *   src/pages/LocalityPage.tsx          renders the page for people
 *
 * Inputs are the columns anon can already read for the public teacher pages
 * (name, slug, honorific, subjects, classes, area, boards). No contact column
 * is ever read or carried through here.
 */

import { AREAS, AREA_NORMALIZATION } from '../utils/area-normalization';
import { SUBJECT_PATH_TO_FILTER } from '../utils/subjectMapping';
import { SUBJECT_META } from '../content/subject-meta';

/** A page needs at least this many real teachers. The owner set 5 on 2026-09-30. */
export const MIN_LOCALITY_TEACHERS = 5;

const SUBJECT_SUFFIX = '-tuition-teachers-in-kolkata';

/** Subject pages that are an alias of another (same teachers, canonicalised to
 *  it in src/lib/canonical.ts) never get locality pages of their own. */
const EXCLUDED_SUBJECT_PATHS = new Set(['/commercial-studies-tuition-teachers-in-kolkata']);

export interface LocalityTeacher {
  slug: string;
  name: string;
  honorific: string;
  subjects: string;
  classes: string;
  area: string;
  boards: string;
}

export interface LocalityCombo {
  /** The subject page this sits under, e.g. /maths-tuition-teachers-in-kolkata */
  subjectPath: string;
  subjectLabel: string;
  area: string;
  /** /maths-tuition-teachers-in-salt-lake */
  path: string;
  count: number;
}

const splitList = (text: string | null | undefined, separators: RegExp): string[] =>
  (text ?? '').split(separators).map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);

/** A teacher's areas, canonicalised through the same alias map the search box
 *  uses, so "Salt lake" and "Bidhannagar" are one place. Unknown areas drop. */
export function normaliseAreas(raw: string | null | undefined): string[] {
  const found = new Set<string>();
  for (const token of splitList(raw, /[,/;]/)) {
    const area = AREA_NORMALIZATION[token.toLowerCase()];
    if (area && AREAS.includes(area)) found.add(area);
  }
  return [...found];
}

export const areaSlug = (area: string): string => area.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Every subject page a locality page may hang off. */
export function localitySubjectPaths(): string[] {
  return Object.keys(SUBJECT_PATH_TO_FILTER).filter(
    (p) => !EXCLUDED_SUBJECT_PATHS.has(p) && SUBJECT_META[p],
  );
}

export function localityPath(subjectPath: string, area: string): string {
  return `${subjectPath.replace(/-tuition-teachers-in-kolkata$/, '')}-tuition-teachers-in-${areaSlug(area)}`;
}

/** Inverse of localityPath for a pathname, or null when it is not one. */
export function parseLocalityPath(pathname: string): { subjectPath: string; area: string } | null {
  const m = /^\/(.+)-tuition-teachers-in-(.+)$/.exec(pathname);
  if (!m || m[2] === 'kolkata') return null;
  const subjectPath = `/${m[1]}${SUBJECT_SUFFIX}`;
  const area = AREAS.find((a) => areaSlug(a) === m[2]);
  if (!area || !SUBJECT_PATH_TO_FILTER[subjectPath] || EXCLUDED_SUBJECT_PATHS.has(subjectPath)) return null;
  return { subjectPath, area };
}

const SUBJECT_SYNONYMS: Record<string, string> = {
  computer: 'computers',
  accountancy: 'accounts',
};

const subjectKey = (s: string): string => {
  const k = s.toLowerCase().replace(/\s+/g, ' ').trim();
  return SUBJECT_SYNONYMS[k] ?? k;
};

/** Whole-token match against a subject page's filter value; a comma in the
 *  filter means OR (Science is Physics, Chemistry or Biology). */
export function teacherMatchesSubject(subjectsText: string | null | undefined, filterValue: string): boolean {
  const have = new Set(splitList(subjectsText, /[,;/]/).map(subjectKey));
  return filterValue.split(',').some((f) => have.has(subjectKey(f)));
}

/** Teachers for one subject page, across all of Kolkata. */
export function countSubjectTeachers(teachers: LocalityTeacher[], subjectPath: string): number | undefined {
  const filter = SUBJECT_PATH_TO_FILTER[subjectPath];
  return filter ? teachers.filter((t) => teacherMatchesSubject(t.subjects, filter)).length : undefined;
}

/** Teachers who teach one subject in one area. */
export function teachersFor(teachers: LocalityTeacher[], subjectPath: string, area: string): LocalityTeacher[] {
  const filter = SUBJECT_PATH_TO_FILTER[subjectPath];
  if (!filter) return [];
  return teachers.filter(
    (t) => normaliseAreas(t.area).includes(area) && teacherMatchesSubject(t.subjects, filter),
  );
}

/** Which (subject, area) pairs earn a page. Sorted for a stable output. */
export function computeLocalityCombos(teachers: LocalityTeacher[], min = MIN_LOCALITY_TEACHERS): LocalityCombo[] {
  const combos: LocalityCombo[] = [];
  for (const subjectPath of localitySubjectPaths()) {
    for (const area of AREAS) {
      const count = teachersFor(teachers, subjectPath, area).length;
      if (count >= min) {
        combos.push({
          subjectPath,
          subjectLabel: SUBJECT_META[subjectPath].label,
          area,
          path: localityPath(subjectPath, area),
          count,
        });
      }
    }
  }
  return combos.sort((a, b) => a.path.localeCompare(b.path));
}

// ---------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------

/** `{Subject} Home Tutor in {Area}, Kolkata: {N} Verified Teachers | Shikshaq` */
export function localitySeoTitle(subjectLabel: string, area: string, count: number): string {
  return `${subjectLabel} Home Tutor in ${area}, Kolkata: ${count} Verified Teachers | Shikshaq`;
}

export interface LocalityFacts {
  /** Boards and how many of these teachers cater to each, most first. */
  boards: Array<{ board: string; count: number }>;
  /** Class bands and how many of these teachers cover each, in class order. */
  bands: Array<{ band: string; count: number }>;
}

const BANDS: Array<{ band: string; lo: number; hi: number }> = [
  { band: 'Classes 1 to 5', lo: 1, hi: 5 },
  { band: 'Classes 6 to 8', lo: 6, hi: 8 },
  { band: 'Classes 9 and 10', lo: 9, hi: 10 },
  { band: 'Classes 11 and 12', lo: 11, hi: 12 },
];

const ROMAN: Record<string, number> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12,
};

const classNumber = (token: string): number | null => {
  const n = /^\d{1,2}$/.test(token) ? Number(token) : ROMAN[token];
  return n >= 1 && n <= 12 ? n : null;
};

/** "Class IX - XII, UG" -> [[9, 12]]. Text the parser cannot read yields none. */
export function classRanges(text: string | null | undefined): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const re = /\b(\d{1,2}|[IVX]+)\b(?:\s*(?:-|to)\s*\b(\d{1,2}|[IVX]+)\b)?/g;
  for (const m of (text ?? '').matchAll(re)) {
    const lo = classNumber(m[1]);
    if (lo === null) continue;
    const hi = m[2] ? classNumber(m[2]) : lo;
    if (hi === null) continue;
    ranges.push([Math.min(lo, hi), Math.max(lo, hi)]);
  }
  return ranges;
}

export function localityFacts(list: LocalityTeacher[]): LocalityFacts {
  const boardCounts = new Map<string, number>();
  for (const t of list) {
    for (const board of new Set(splitList(t.boards, /,/))) boardCounts.set(board, (boardCounts.get(board) ?? 0) + 1);
  }
  const boards = [...boardCounts.entries()]
    .map(([board, count]) => ({ board, count }))
    .sort((a, b) => b.count - a.count || a.board.localeCompare(b.board));

  const bands = BANDS.map(({ band, lo, hi }) => ({
    band,
    count: list.filter((t) => classRanges(t.classes).some(([a, b]) => a <= hi && b >= lo)).length,
  })).filter((b) => b.count > 0);

  return { boards, bands };
}

export function localityDescription(subjectLabel: string, area: string, count: number, facts: LocalityFacts): string {
  const boards = facts.boards.slice(0, 3).map((b) => b.board);
  const boardText = boards.length
    ? ` covering ${boards.length > 1 ? `${boards.slice(0, -1).join(', ')} and ${boards[boards.length - 1]}` : boards[0]}`
    : '';
  return `Find ${count} verified ${subjectLabel} tutors in ${area}, Kolkata${boardText}. `
    + 'Compare by class and board, then message the teacher directly on WhatsApp. Free.';
}
