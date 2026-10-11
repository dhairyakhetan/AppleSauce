/* Shared by PastPapers.tsx and Index.tsx: how a bank_papers row (already
   folded into the papers-surface `Paper` shape both pages use) is drawn on a
   PaperCover, and how a fixed number of slots (a home rail, "recently added")
   picks a set that doesn't read as ten copies of the same paper.

   Was two copies of coverPaper()/coverMeta() — PastPapers.tsx's original, and
   one duplicated into Index.tsx while that file was mid-edit by another
   agent. Consolidated here now that PastPapers.tsx is free, per product-owner
   review of the home shelf (2026-09-26): it also caught that the shelf, with
   no variety picker, was rendering ten near-identical "ICSE 2026 · Board · N
   questions" covers — the bank sorts undated/board papers first at the top
   of any given year, so a naive slice(0, 10) landed on ten of them. */

import { displaySchool } from '@/lib/school-display';

/** The minimal shape coverPaper()/coverMeta()/pickVariedRecent() need. Both
 *  PastPapers.tsx's merged `Paper` (papers-table rows AND bank rows folded
 *  into the same interface) and a bank row mapped straight for the home
 *  rail satisfy it. */
export interface CoverSourcePaper {
  id: string;
  title: string;
  school: string;
  subject: string;
  class: string;
  board: string;
  exam_type: string;
  year: number;
  /** Bank-only markers. Undefined on a real `papers`-table row, which is how
   *  coverPaper() tells the two apart — see its own note below. */
  _bankYear?: string;
  _questions?: number;
  _isBoard?: boolean;
  _needsReview?: boolean;
}

/** hasYear() from question-bank.ts, duplicated as a one-line predicate rather
 *  than imported: that module also owns the Supabase read path, which
 *  neither this module nor its test should need to know about. Same rule —
 *  "year-unknown" is the sentinel a null bank year round-trips as. */
const hasYear = (y: string | null | undefined): boolean => Boolean(y) && !String(y).startsWith('year-unknown');

/** How a bank paper is drawn on a cover. Three built-in slots, so: eyebrow
 *  carries board (+ year when the school is not the board), headline carries
 *  whatever distinguishes this paper from its shelf-mates — the school, or
 *  the year when the papers ARE the board's own — and the footer carries the
 *  exam and the question count. */
export function coverPaper<T extends CoverSourcePaper>(p: T): T {
  /* `_questions` is the honest test for "this came from the bank", and it is
     the only one available now that file_url is not anon-selectable. It is
     also more correct than the old `p.file_url !== null ||` term ever was: a
     papers-table row with no PDF uploaded has a null file_url too, so that
     check treated it as a bank paper and drew it with a bank cover. */
  if (p._questions === undefined) return p;
  const year = p._bankYear ?? '';
  /* "ICSE 2026" with no school IS the board's own paper. The year becomes
     the headline for those, because it is the only thing separating one
     board paper from the next. The database says which they are, so this no
     longer sniffs the display name for the words "board paper". */
  const schoolIsBoard = p._isBoard === true;
  return {
    ...p,
    subject: schoolIsBoard && hasYear(year) ? year : displaySchool(p.school),
    board: schoolIsBoard ? p.board : [p.board, hasYear(year) ? year : null].filter(Boolean).join(' · '),
    title: p.exam_type.replace(/ Examination$/, '').replace(/^Pre-board.*/, 'Pre-board'),
    year: `${p._questions} questions` as unknown as number,
  };
}

/** Everything a cover can say that its three built-in slots do not already:
 *  the subject and class always, and the school whenever the headline is
 *  showing the year instead (the board-published papers). No duplicates —
 *  a cover repeating "ICSE" three times tells the reader nothing. */
export function coverMeta(p: CoverSourcePaper): string[] {
  const out: string[] = [];
  const shown = coverPaper(p);
  /* Subject first and always. Once the headline became the school (so a
     shelf of Maths papers is distinguishable at all), nothing on the cover
     said what subject it was — the one fact a student filters on hardest. */
  const subject = String(p.subject ?? '').trim();
  if (subject && subject !== String(shown.subject ?? '')) out.push(subject);
  if (p.class) out.push(`Class ${p.class}`);
  const headline = String(shown.subject ?? '');
  const school = displaySchool(p.school);
  if (school && school !== headline && !String(shown.board ?? '').includes(school)) out.push(school);
  return out;
}

/**
 * A fixed-size selection that reads as a shelf, not ten copies of one paper.
 *
 * Sorted newest first (numeric year, undated as 0), with openable papers
 * (not needs_review) preferred over "coming soon" ones when years tie — the
 * shelf should lead with what a reader can actually open. Within that order,
 * greedily takes the first paper seen for each (subject, class, board)
 * combination; once every combination up to `limit` has contributed one, or
 * the source runs out, any still-empty slots are filled from what's left
 * (in the same order), so a thin bank still returns `limit` papers rather
 * than fewer.
 */
export function pickVariedRecent<T extends CoverSourcePaper>(papers: T[], limit: number): T[] {
  const sorted = [...papers].sort((a, b) => {
    const yearDiff = (b.year || 0) - (a.year || 0);
    if (yearDiff !== 0) return yearDiff;
    const openA = a._needsReview ? 1 : 0;
    const openB = b._needsReview ? 1 : 0;
    if (openA !== openB) return openA - openB;
    return a.school.localeCompare(b.school) || a.id.localeCompare(b.id);
  });

  const comboKey = (p: T) => `${p.subject}|${p.class}|${p.board}`;
  const seen = new Set<string>();
  const picked: T[] = [];
  const leftovers: T[] = [];

  for (const p of sorted) {
    const key = comboKey(p);
    if (picked.length < limit && !seen.has(key)) {
      seen.add(key);
      picked.push(p);
    } else {
      leftovers.push(p);
    }
  }
  for (const p of leftovers) {
    if (picked.length >= limit) break;
    picked.push(p);
  }
  return picked;
}
