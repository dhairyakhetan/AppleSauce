/**
 * Turns a casual free-text papers search ("12 math cbse") into the same
 * facets PaperResults.tsx already filters on: subject, class, board, year,
 * plus whatever text is left over (usually a school name or a typo Fuse
 * should still fuzzy-match).
 *
 * Root cause this exists to fix: SearchControl's overlay counted papers with
 * Fuse.js, and PaperResults' `q` search ran a single ilike OR clause against
 * title/school/subject -- both treat the WHOLE query as one string to match
 * against ONE field. "12 math cbse" never appears verbatim in any title,
 * school or subject column, so both paths returned zero however many CBSE
 * Class 12 Maths papers exist. Splitting the query into facets first (this
 * file), then letting only the genuine leftover (a school name, a typo) fall
 * through to a substring/fuzzy match, is what makes a combined query work.
 *
 * Deliberately pure and DB-free so it is unit-testable without Supabase: it
 * knows nothing about which schools exist, so a school name is never
 * "extracted" here -- it is simply not recognised as a class/subject/board/
 * year token and therefore survives into `freeText`, where the existing
 * ilike-against-school-column behaviour already finds it.
 */
import { BASE_SUBJECT_NORMALIZATION } from '@/utils/searchKeywordExtractor';
import { SUBJECTS, BOARDS } from '@/utils/searchFacets';

export interface ParsedPaperQuery {
  subjects: string[];
  classes: string[];
  boards: string[];
  years: number[];
  /** Whatever wasn't recognised as a facet -- a school name, a typo, junk. */
  freeText: string;
}

/** Every subject this file can resolve to, restricted to the papers facet
 *  vocabulary (searchFacets.ts SUBJECTS) so a matched alias always lines up
 *  with a real `filter_subjects` chip. */
const SUBJECT_SET = new Set(SUBJECTS);
export const PAPER_SUBJECT_ALIASES: Record<string, string> = Object.fromEntries(
  Object.entries(BASE_SUBJECT_NORMALIZATION).filter(([, site]) => SUBJECT_SET.has(site)),
);

/**
 * Board aliases. "wb" / "wbbse" / "wbchse" / "west bengal (board)" all mean
 * the West Bengal board, which searchFacets.ts's BOARDS calls 'State' -- the
 * same label FilterPanel/Browse already use, so a query that says "wb" lines
 * up with the same chip a signed-in filter click would produce.
 */
export const PAPER_BOARD_ALIASES: Record<string, string> = {
  cbse: 'CBSE',
  'central board': 'CBSE',
  'central board of secondary education': 'CBSE',
  icse: 'ICSE',
  'indian certificate of secondary education': 'ICSE',
  isc: 'ISC',
  'indian school certificate': 'ISC',
  igcse: 'IGCSE',
  cambridge: 'IGCSE',
  ib: 'IB',
  'international baccalaureate': 'IB',
  state: 'State',
  wb: 'State',
  wbbse: 'State',
  wbchse: 'State',
  'west bengal': 'State',
  'west bengal board': 'State',
};

/** Multi-word phrases resolved before the single-token pass, longest first
 *  so e.g. "west bengal board" is consumed whole rather than leaving "board"
 *  behind as junk once "west bengal" is stripped. */
const MULTI_WORD_BOARD_PHRASES = Object.keys(PAPER_BOARD_ALIASES)
  .filter((k) => k.includes(' '))
  .sort((a, b) => b.length - a.length);
const MULTI_WORD_SUBJECT_PHRASES = Object.keys(PAPER_SUBJECT_ALIASES)
  .filter((k) => k.includes(' '))
  .sort((a, b) => b.length - a.length);

const CLASS_WORDS = new Set(['class', 'grade', 'std', 'standard']);

/* Roman numerals I-XII as standalone class tokens. Deliberately whitelisted
 * (not a general roman-numeral parser) and case-insensitive on the RAW token,
 * since this is a short structured query (a papers search), not prose, and
 * the brief explicitly asks for "x maths" to resolve to Class 10. "i"/"ii"
 * are included too -- ambiguity with the pronoun "I" barely matters here
 * because the moment neither a subject, board, nor any other class token is
 * present, the query is short and this is genuinely the most useful reading. */
const ROMAN_CLASS: Record<string, string> = {
  i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6',
  vii: '7', viii: '8', ix: '9', x: '10', xi: '11', xii: '12',
};

/* Words that mean nothing on their own once the facets around them are
 * pulled out -- dropped rather than left to pollute freeText, where they'd
 * otherwise turn "cbse class 12 papers" into leftover text "papers" and ilike
 * for a literal school/title/subject called "papers". */
const FILLER_WORDS = new Set([
  'papers', 'paper', 'question', 'questions', 'previous', 'prelim', 'prelims',
  'board', 'exam', 'exams', 'test', 'the', 'a', 'an', 'of', 'in', 'for', 'and',
]);

function stripPhrase(text: string, phrase: string): string {
  return text.replace(new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), ' ');
}

export function parsePaperQuery(query: string): ParsedPaperQuery {
  const subjects = new Set<string>();
  const boards = new Set<string>();
  const classes = new Set<string>();
  const years = new Set<number>();

  if (!query || !query.trim()) {
    return { subjects: [], classes: [], boards: [], years: [], freeText: '' };
  }

  let text = query
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // --- Multi-word phrases first ---
  for (const phrase of MULTI_WORD_BOARD_PHRASES) {
    if (text.includes(phrase)) {
      boards.add(PAPER_BOARD_ALIASES[phrase]);
      text = stripPhrase(text, phrase);
    }
  }
  for (const phrase of MULTI_WORD_SUBJECT_PHRASES) {
    if (text.includes(phrase)) {
      subjects.add(PAPER_SUBJECT_ALIASES[phrase]);
      text = stripPhrase(text, phrase);
    }
  }
  // "class 12", "grade 10", "std 9", "standard 7"
  text = text.replace(/\b(class|grade|std|standard)\s+(\d{1,2})\b/g, (_m, _w, num) => {
    const n = parseInt(num, 10);
    if (n >= 1 && n <= 12) classes.add(String(n));
    return ' ';
  });

  text = text.replace(/\s+/g, ' ').trim();
  const words = text.split(' ').filter(Boolean);
  const leftover: string[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    if (CLASS_WORDS.has(word)) continue; // a stray "class"/"grade" with no number nearby
    if (FILLER_WORDS.has(word)) continue;

    // "12th" / "10nd" / "9st" -- ordinal class
    const ordinal = word.match(/^(\d{1,2})(st|nd|rd|th)$/);
    if (ordinal) {
      const n = parseInt(ordinal[1], 10);
      if (n >= 1 && n <= 12) { classes.add(String(n)); continue; }
    }

    // Bare year: 4 digits, plausible exam year range.
    if (/^(19|20)\d{2}$/.test(word)) {
      const y = parseInt(word, 10);
      if (y >= 1990 && y <= 2035) { years.add(y); continue; }
    }

    // Bare 1-2 digit number -- a class, unless it's a 2-digit year fragment
    // (handled above) or an ADDRESS_INDICATORS-style false positive; papers
    // search has no address context, so any 1-12 number is treated as a class.
    if (/^\d{1,2}$/.test(word)) {
      const n = parseInt(word, 10);
      if (n >= 1 && n <= 12) { classes.add(String(n)); continue; }
    }

    // Roman numeral class ("x", "xii", "ix" ...)
    if (ROMAN_CLASS[word]) { classes.add(ROMAN_CLASS[word]); continue; }

    // Board alias (single word)
    if (PAPER_BOARD_ALIASES[word]) { boards.add(PAPER_BOARD_ALIASES[word]); continue; }
    const boardExact = BOARDS.find((b) => b.toLowerCase() === word);
    if (boardExact) { boards.add(boardExact); continue; }

    // Subject alias (single word)
    if (PAPER_SUBJECT_ALIASES[word]) { subjects.add(PAPER_SUBJECT_ALIASES[word]); continue; }
    const subjectExact = SUBJECTS.find((s) => s.toLowerCase() === word);
    if (subjectExact) { subjects.add(subjectExact); continue; }

    leftover.push(word);
  }

  /* ICSE class XI/XII is administered as ISC, not ICSE -- CLAUDE.md's own
   * framing of this bug. A casual "icse 12 physics" almost always means the
   * ISC paper, since no ICSE (up-to-Class-X) exam exists for Class 12. Widen
   * to both boards rather than silently rewriting ICSE -> ISC, so an
   * explicit "icse" still shows as ICSE in the result heading/chips and nothing
   * is lost if the data does carry a literal "ICSE" row for that class. This
   * is a one-way widen: an explicit "isc" query is never widened back down to
   * ICSE, since ISC classes (XI/XII) have no ICSE equivalent. */
  if (boards.has('ICSE') && (classes.has('11') || classes.has('12'))) {
    boards.add('ISC');
  }

  return {
    subjects: Array.from(subjects),
    classes: Array.from(classes),
    boards: Array.from(boards),
    years: Array.from(years),
    freeText: leftover.join(' ').trim(),
  };
}

export function paperQueryHasFacets(parsed: ParsedPaperQuery): boolean {
  return parsed.subjects.length > 0 || parsed.classes.length > 0 || parsed.boards.length > 0 || parsed.years.length > 0;
}

/**
 * Whether an Arabic-numeral class value ("10", from a `filter_classes`/parsed
 * facet) matches a paper's own class column -- which is Arabic-native for the
 * 18-row `papers` table but Roman-numeral for `bank_papers` (see
 * romanNumerals.ts's bankClassMatches, which this mirrors but accepts either
 * representation on the paper side since PaperHit/Paper merge both sources
 * into one shape).
 */
export function paperClassMatches(filterValue: string, paperClass: string): boolean {
  const want = filterValue.trim();
  const have = paperClass.trim();
  if (want.toLowerCase() === have.toLowerCase()) return true;
  const wantNum = parseInt(want, 10);
  const haveRoman = ROMAN_CLASS_TO_NUM[have.toLowerCase()];
  if (!Number.isNaN(wantNum) && haveRoman != null) return wantNum === haveRoman;
  return false;
}

const ROMAN_CLASS_TO_NUM: Record<string, number> = Object.fromEntries(
  Object.entries(ROMAN_CLASS).map(([roman, num]) => [roman, parseInt(num, 10)]),
);

/** Board equality, case-insensitive -- boards are short fixed codes, no
 *  aliasing needed at match time (aliases are already resolved by the parser). */
export function paperBoardMatches(filterValue: string, paperBoard: string): boolean {
  return filterValue.trim().toLowerCase() === paperBoard.trim().toLowerCase();
}

export interface MatchablePaper {
  title: string;
  school: string;
  subject: string;
  class: string;
  board: string;
  year: number;
}

/**
 * True when `paper` satisfies every facet `parsed` extracted, plus its
 * leftover free text (matched as a case-insensitive substring against
 * title/school/subject -- the same three columns PaperResults' ilike clause
 * already searches). Shared by useSearchIndex's overlay preview and
 * PaperResults' own filtering so the two counts agree.
 */
export function paperMatchesParsedQuery(paper: MatchablePaper, parsed: ParsedPaperQuery): boolean {
  if (parsed.subjects.length && !parsed.subjects.some((s) => s.toLowerCase() === paper.subject.toLowerCase())) {
    return false;
  }
  if (parsed.classes.length && !parsed.classes.some((c) => paperClassMatches(c, paper.class))) {
    return false;
  }
  if (parsed.boards.length && !parsed.boards.some((b) => paperBoardMatches(b, paper.board))) {
    return false;
  }
  if (parsed.years.length && !parsed.years.includes(paper.year)) {
    return false;
  }
  const needle = parsed.freeText.trim().toLowerCase();
  if (needle) {
    const hit =
      paper.title.toLowerCase().includes(needle) ||
      paper.school.toLowerCase().includes(needle) ||
      paper.subject.toLowerCase().includes(needle);
    if (!hit) return false;
  }
  return true;
}
