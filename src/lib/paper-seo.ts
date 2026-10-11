/**
 * The one place a paper's search title, description and heading are built.
 *
 * Two writers used to disagree: scripts/prerender.ts (what a crawler that does
 * not run JavaScript reads) and src/pages/BankPaper.tsx (what the browser sets
 * after load) each spelled their own template, and they had already drifted
 * apart (one said "Mathematics", the other "Maths"; the descriptions differed).
 * Both now call this, with the raw database row, so they cannot differ.
 *
 * Pure on purpose: no browser or Supabase imports, so the Node prerender can
 * load it.
 *
 * Wording rules, from the owner-approved SEO brief of 2026-09-30:
 * - Board and exam are part of what people search ("ICSE Class 10 Maths
 *   Pre-board 2025"), so they belong in the title.
 * - Never "PDF" and never "Solved": there is no download and there are no
 *   solutions, so either word would mislead.
 * - A part is left out when its field is empty, when exam is "Unknown", or when
 *   board is the generic placeholder "Board".
 */

import { displaySchool, isRealSchoolLabel } from './school-display';
import { bankSubjectToSite } from './subject-vocabulary';
import { FREE_PREVIEW_QUESTIONS, FREE_PREVIEW_WORD } from './free-preview';

export const SITE_TITLE_SUFFIX = ' | Shikshaq';

/** Titles longer than this lose the suffix first, then words of the school. */
export const TITLE_SOFT_LIMIT = 65;

export interface PaperSeoRow {
  school: string | null | undefined;
  board: string | null | undefined;
  cls: string | null | undefined;
  subject: string | null | undefined;
  exam: string | null | undefined;
  year: string | null | undefined;
  questionCount: number;
}

export interface PaperSeo {
  title: string;
  description: string;
  /** The H1: the full school name and the board, no exam. */
  heading: string;
  /** The school label, or '' when the paper does not name a real school. */
  school: string;
}

function clean(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/** Years arrive as the string 'null' from older imports. */
function realYear(year: string | null | undefined): string {
  const y = clean(year);
  return y && y.toLowerCase() !== 'null' ? y : '';
}

function realExam(exam: string | null | undefined): string {
  const e = clean(exam);
  const lower = e.toLowerCase();
  return e && lower !== 'unknown' && lower !== 'null' ? e : '';
}

function realBoard(board: string | null | undefined): string {
  const b = clean(board);
  return b && b.toLowerCase() !== 'board' && b.toLowerCase() !== 'null' ? b : '';
}

function realClass(cls: string | null | undefined): string {
  const c = clean(cls);
  return c && c.toLowerCase() !== 'unknown' && c.toLowerCase() !== 'null' ? `Class ${c}` : '';
}

function join(parts: string[]): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Drop whole trailing words from a school name until the title fits, never
 * cutting inside a word and never going below two words (one if it only has
 * one). "St. Xavier's Collegiate School" becomes "St. Xavier's Collegiate".
 */
export function shortenSchool(school: string, fits: (candidate: string) => boolean): string {
  const words = school.split(/\s+/).filter(Boolean);
  let keep = words.length;
  while (keep > Math.min(2, words.length) && !fits(words.slice(0, keep).join(' '))) keep--;
  return words.slice(0, keep).join(' ');
}

/** schema.org educationalLevel, e.g. "ICSE Class X"; parts are omitted the
 *  same way as in the title. */
export function paperEducationalLevel(row: Pick<PaperSeoRow, 'board' | 'cls'>): string {
  return join([realBoard(row.board), realClass(row.cls)]);
}

export function buildPaperSeo(row: PaperSeoRow): PaperSeo {
  const schoolLabel = displaySchool(row.school);
  const school = isRealSchoolLabel(schoolLabel) ? schoolLabel : '';
  const board = realBoard(row.board);
  const cls = realClass(row.cls);
  const subject = bankSubjectToSite(row.subject);
  const exam = realExam(row.exam);
  const year = realYear(row.year);

  const titleWith = (schoolPart: string) =>
    join([schoolPart, board, cls, subject, exam, year, 'Question Paper']);

  const withSuffix = titleWith(school) + SITE_TITLE_SUFFIX;
  let title = withSuffix;
  if (title.length > TITLE_SOFT_LIMIT) {
    title = titleWith(school);
    if (title.length > TITLE_SOFT_LIMIT && school) {
      title = titleWith(shortenSchool(school, (s) => titleWith(s).length <= TITLE_SOFT_LIMIT));
    }
  }

  const label = join([school, board, cls, subject, exam, year]);
  const n = row.questionCount;
  // True for a signed-out reader too: only the free preview is open without an
  // account (owner, 2026-09-30). The word comes from the one free-preview source.
  const description = n <= FREE_PREVIEW_QUESTIONS
    ? `${n === 1 ? 'The' : 'All'} ${n} question${n === 1 ? '' : 's'} from the ${label} question paper, `
      + 'with marks and chapters, open to everyone.'
    : `All ${n} questions from the ${label} question paper, with marks and chapters. `
      + `First ${FREE_PREVIEW_WORD} open to everyone, the rest free with an account.`;

  return {
    title,
    description,
    heading: `${join([school, board, cls, subject, year])} question paper`,
    school,
  };
}
