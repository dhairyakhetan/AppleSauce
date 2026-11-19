/* The question bank's SOURCE shape — IMPORT TIME ONLY.
 *
 * data/question-bank.json is the extraction output: one flat array of
 * questions, each carrying its paper's school/year/exam/class alongside its
 * own text. That shape is how the bank arrives, not how the app reads it.
 * The app reads bank_papers and bank_questions from Supabase, where the paper
 * facts have been lifted into their own row.
 *
 * This file used to live in src/lib/question-bank.ts, which meant every
 * visitor's browser downloaded the grouping logic for a file no browser
 * fetches any more. It runs here instead, once, at import time.
 *
 * ⚠ Question text is passed through untouched. Nothing here rewrites it.
 */

/** One question exactly as the extraction wrote it. */
export interface BankQuestion {
  i: string;              // stable id
  p: string;              // paper id
  n: string | null;       // printed number
  t: string;              // text, verbatim
  m: number | null;       // marks
  c: string | null;       // chapter
  s: string | null;       // school, as the source filename had it
  y: string | null;       // year
  e: string | null;       // exam type
  k: string | null;       // class
  ty: string | null;      // short | long | MCQ
  pg?: number;            // source page
  f?: string;             // figure filename
  o?: string[];           // options
  subj?: string;          // subject; absent on the original maths bank
}

export interface BankPaper {
  id: string;
  school: string;
  year: string;
  exam: string;
  cls: string;
  /* Was the literal 'Mathematics'. bank_papers.subject has always been a
     plain text column (default 'Mathematics'), so widening this needs no
     migration - it only stops the pipeline from overwriting every paper's
     real subject with the one the type happened to name. */
  subject: string;
  board: string;
  questionCount: number;
  marks: number;
}

/* Several papers carry the bank's placeholder year, and not always in the same
   shape — "year-unknown" and "year-unknown (2)" both occur. Anything starting
   with it is treated as no year at all rather than shown to a reader. */
export const hasYear = (y: string | null | undefined): boolean =>
  Boolean(y) && !String(y).startsWith('year-unknown');

/** The school column doubles as the board for board-published papers.
    The exam type is never a board: "Pre-board Examination" once made 297
    papers' board the literal word 'Board'. Without a board name, fall back
    the way the PDF sorter does: XI and XII are ISC, every other class ICSE. */
export function boardOf(school: string | null, cls?: string | null): string {
  const s = (school ?? '').trim();
  if (/^(ICSE|ISC|CBSE|IGCSE|IB)$/i.test(s)) return s.toUpperCase();
  return /^(XI|XII)$/i.test((cls ?? '').trim()) ? 'ISC' : 'ICSE';
}

/** Groups the questions into their papers, newest first, undated last. */
export function papersOf(bank: BankQuestion[]): BankPaper[] {
  const map = new Map<string, BankPaper>();
  bank.forEach((row) => {
    let p = map.get(row.p);
    if (!p) {
      p = {
        id: row.p,
        school: row.s ?? 'Unknown school',
        year: row.y ?? '',
        exam: row.e ?? '',
        cls: row.k ?? 'X',
        subject: row.subj ?? 'Mathematics',
        board: boardOf(row.s, row.k),
        questionCount: 0,
        marks: 0,
      };
      map.set(row.p, p);
    }
    p.questionCount += 1;
    p.marks += row.m ?? 0;
  });
  return [...map.values()].sort((a, b) => {
    const ay = hasYear(a.year);
    const by = hasYear(b.year);
    if (ay !== by) return ay ? -1 : 1;
    return b.year.localeCompare(a.year) || a.school.localeCompare(b.school);
  });
}
