/**
 * Pure helpers about a question's text, for the paper checker (Kid Mode).
 *
 * Nothing here edits question text. Every function reads a body and returns
 * a decision about it; the body the page shows and sends back is the one the
 * database gave it (D76: questions are a one-to-one copy of the printed
 * paper, and only OCR reading mistakes may be corrected).
 */

/** True when there is nothing to check: null, empty, or only whitespace.
 *  104 of the 840 kid-queue rows on 2026-09-28 were blank (96 of them the
 *  empty half of an "ocr_fused" group whose words sit on another row).
 *  "Looks right" on one of those would pass an empty question. */
export function isBlankBody(body: string | null | undefined): boolean {
  return !body || body.trim().length === 0;
}

/* Subjects whose text is full of one-letter variables (x, y, a, b) and
   formulae; the scrambled-text heuristic below would misfire on them. */
const FORMULA_SUBJECT = /math|physic|chem|account|computer|statist|economic|business|commerc/i;

/* Short words that are real English. Anything else of one or two letters
   in a prose paper is usually a torn word ("p rt o your h o urri ulum"). */
const SHORT_WORDS = new Set([
  'a', 'i', 'am', 'an', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'if', 'in', 'is', 'it', 'me', 'my',
  'no', 'of', 'oh', 'ok', 'on', 'or', 'so', 'to', 'up', 'us', 'we', 'mr', 'dr', 'st', 'vs', 'eg', 'ie',
  'th', 'nd', 'rd', 'pm', 'km', 'cm', 'mm', 'kg', 'rs', 'ii', 'iv', 'vi', 'ix', 'xi', 'x', 'v', 'ad', 'bc',
]);

/* Letters a legacy Indian-language font turns into when its text is read
   as Latin ("ImØncn°p∂Xv"). One or two can be real; a run cannot. */
const MOJIBAKE = /[∂ƒ≠Ø∏ª¬≈‰Æ≥≤]/g;

export interface GarbleVerdict {
  garbled: boolean;
  /** Share of words that are torn fragments (0..1), for tests and tuning. */
  fragmentShare: number;
}

/**
 * Whether a body reads as scrambled OCR that no student could check, like
 * the one the owner was served on 2026-09-28:
 *   "\ling p p r b g a a part f our f gi ing nd h , u r a\iz d elect any on..."
 * Conservative on purpose: only prose subjects, only with at least 12 words,
 * and only when over a quarter of them are torn fragments, or when the text
 * carries a run of legacy-font letters. Maths-heavy subjects never trip it.
 */
export function looksGarbled(body: string | null | undefined, subject?: string | null): GarbleVerdict {
  const text = body ?? '';
  const mojibake = (text.match(MOJIBAKE) ?? []).length;
  if (mojibake >= 4) return { garbled: true, fragmentShare: 0 };
  if (subject && FORMULA_SUBJECT.test(subject)) return { garbled: false, fragmentShare: 0 };
  // Maths spans and option labels like "(a)" are not prose.
  const prose = text
    .replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g, ' ')
    .replace(/\(\s*[a-z]{1,4}\s*\)/gi, ' ')
    .replace(/(^|\s)[a-z]{1,4}[.)](?=\s)/gi, ' ');
  const words = prose.match(/[A-Za-z]+/g) ?? [];
  if (words.length < 12) return { garbled: false, fragmentShare: 0 };
  const fragments = words.filter((w) => w.length <= 2 && !SHORT_WORDS.has(w.toLowerCase())).length;
  const share = fragments / words.length;
  return { garbled: share >= 0.25, fragmentShare: share };
}

/**
 * A textarea reports a caret position in UTF-16 code units; Postgres left()
 * and substring() in checker_split_question count characters (code points).
 * They differ by one for every character outside the Basic Multilingual
 * Plane before the caret (maths italic letters such as U+1D465 appear in
 * two kid-queue bodies), so the raw caret would split one character late
 * per such letter. Converts, and never lands inside a surrogate pair.
 */
export function codePointOffset(text: string, utf16Index: number): number {
  const end = Math.max(0, Math.min(utf16Index, text.length));
  let count = 0;
  for (let i = 0; i < end; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        if (i + 1 >= end) break; // caret between a pair: keep the whole character in the second half
        i++;
      }
    }
    count++;
  }
  return count;
}

/** The two halves a split would produce, as the server will cut them
 *  (at a code-point offset), for the preview under the split box. */
export function splitHalves(text: string, codePoints: number): { first: string; second: string } {
  const chars = Array.from(text);
  return { first: chars.slice(0, codePoints).join(''), second: chars.slice(codePoints).join('') };
}

/* The word OR between two questions (20261008150000). "OR" or "Or", with the
   comma or full stop it may carry, standing alone: never a lower case "or"
   inside a sentence, never part of a longer word ("ORANGE", "FOR"). The white
   space class is spelled out so it matches the database exactly. */
const OR_AT_START = /^[ \t\n\r\f\v]*(?:OR|Or)[,.]?(?:[ \t\n\r\f\v]+|$)/;
const OR_AT_END = /(?:^|[ \t\n\r\f\v]+)(?:OR|Or)[,.]?[ \t\n\r\f\v]*$/;
const OR_ONLY = /^[ \t\n\r\f\v]*(?:OR|Or)[,.]?[ \t\n\r\f\v]*$/;

/** Said under the split preview when the cut sits at an OR. */
export const SPLIT_OR_NOTE =
  'The word OR is left out of both parts. The two questions are kept together as an either/or pair, and the library shows OR between them.';

/** The one-tap action on a row that is only the word OR. */
export const OR_ONLY_TITLE = 'This row is only the word OR';
export const OR_ONLY_NOTE =
  'It is the OR between two questions, not a question. Set it aside and the questions on either side are kept together as an either/or pair.';
export const OR_ONLY_BUTTON = 'This is just the OR between two questions';
export const OR_ONLY_DONE = 'Set aside. The questions around it are now an either/or pair.';

/** True when the whole row is just the OR between two questions. */
export function isOrOnlyBody(body: string | null | undefined): boolean {
  return OR_ONLY.test(body ?? '');
}

/** The two halves a split makes, as the database makes them: when the cut sits
 *  at an OR (starting the second half or ending the first) that separator is
 *  dropped and `orSeparator` says the two become alternatives. Every other
 *  character is kept. Mirrors split_or_separator() in 20261008150000. */
export function splitOrPlan(
  text: string,
  codePoints: number,
): { first: string; second: string; orSeparator: boolean } {
  const { first, second } = splitHalves(text, codePoints);
  const atStart = OR_AT_START.exec(second);
  if (atStart) return { first, second: second.slice(atStart[0].length), orSeparator: true };
  const atEnd = OR_AT_END.exec(first);
  if (atEnd) return { first: first.slice(0, atEnd.index), second, orSeparator: true };
  return { first, second, orSeparator: false };
}

/** Whether a split at this code-point offset is one the server will accept
 *  (it refuses 0 and anything at or past the end), and leaves words on both
 *  sides once an OR separator at the cut is taken out. */
export function canSplitAt(text: string, codePoints: number | null): boolean {
  if (codePoints === null) return false;
  const length = Array.from(text).length;
  if (codePoints <= 0 || codePoints >= length) return false;
  const { first, second } = splitOrPlan(text, codePoints);
  return first.trim().length > 0 && second.trim().length > 0;
}

/* ---------------------------------------------------------------------------
   D76: only OCR reading mistakes may be corrected. A misread fixes a letter
   or a word here and there; rewording, paraphrasing or "improving" a
   question changes far more. editSize() measures how much an edit changed,
   and bigEdit() says when to WARN (never block: a whole missing line is a
   legitimate fix too). */

/** Edit distance (insert/delete/replace, per character) between two texts.
 *  The common start and end are trimmed first, so a typical small fix is
 *  cheap even on a 3,000-character body; a changed middle longer than
 *  `cap` characters on both sides is not compared letter by letter (the
 *  longer middle's length is returned, which is the most it could be). */
export function editSize(before: string, after: string, cap = 600): number {
  const a = Array.from(before);
  const b = Array.from(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  if (x.length === 0) return y.length;
  if (y.length === 0) return x.length;
  if (x.length > cap && y.length > cap) return Math.max(x.length, y.length);
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

/** True when an edit changed more than a reading fix usually does: more
 *  than 12 characters AND more than 15% of the original. Removing text and
 *  nothing else (a typed-in answer, "Page 2 of 9") never warns: that is a
 *  flag this screen asks the checker to act on. */
export function bigEdit(before: string, after: string): boolean {
  const size = editSize(before, after);
  const beforeLength = Array.from(before).length;
  const afterLength = Array.from(after).length;
  if (afterLength < beforeLength && size === beforeLength - afterLength) return false;
  return size > 12 && size / Math.max(beforeLength, 1) > 0.15;
}

/* ---------------------------------------------------------------------------
   Owner: "the number lives in the number box only". A body that repeats its
   own printed number ("15. Solve for x...", display_number "15") shows that
   number twice: once in the number box/badge, once as the first word of the
   text. This never touches storage -- it only says whether the very start of
   a body is that same number dressed as a prefix, so the checker can strip it
   on save (a logged, leading-only removal) and the public page can hide it at
   render time (5,734 live bodies, no data change). */

/** "15", "(a)", "Q15", "4(ii)" -> the bare alphanumeric core, for comparing a
 *  display_number against text that may wrap it differently. */
function numberCore(s: string): string {
  return s
    .trim()
    .replace(/^q\s*/i, '')
    .replace(/[().\s]/g, '')
    .toLowerCase();
}

export interface NumberPrefixMatch {
  /** The exact leading slice of `body` that repeats the number (whitespace after it included). */
  prefix: string;
  /** `body` with that slice removed, otherwise byte-identical. */
  rest: string;
}

/**
 * Whether `body` starts by re-printing `displayNumber` as a numbering prefix
 * -- "15.", "15)", "(15)", "Q15", "Q15.", "(a)", "4(ii)" -- immediately
 * followed by a real word break, not by another digit (so "1.5" is never
 * mistaken for prefix "1." before "5") and not by nothing but more of the
 * same token (so "15 marks" is left alone: no punctuation glues the number
 * to the text, which is the same test a human uses to tell a number label
 * from a number that is just part of the sentence).
 *
 * Only ever matches at the very start of `body`, and only when the matched
 * core equals `displayNumber`'s core exactly -- "(a) and (b) ..." is left
 * alone unless this question's own display_number really is "(a)"/"a".
 */
export function matchLeadingNumberPrefix(
  body: string | null | undefined,
  displayNumber: string | null | undefined,
): NumberPrefixMatch | null {
  const text = body ?? '';
  const wanted = (displayNumber ?? '').trim();
  if (!text || !wanted) return null;
  const wantedCore = numberCore(wanted);
  if (!wantedCore) return null;

  // Candidate leading tokens, longest / most specific first, each capturing
  // the punctuation that must glue it to the text (group 1) and requiring
  // whitespace or end-of-string right after (never another digit/letter of
  // the same run, which is what makes "1.5" and "15 marks" safe).
  const patterns = [
    /^\(\s*[A-Za-z0-9]{1,4}\s*\)(?=\s|$)/, // "(a)", "(15)"
    /^Q\s*[0-9]{1,4}\s*[.)](?=\s|$)/i, // "Q15.", "Q15)"
    /^Q\s*[0-9]{1,4}(?=\s)/i, // "Q15 "
    /^[0-9]{1,4}\s*[.)](?!\d)(?=\s|$)/, // "15.", "15)" -- not "1.5"
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    const matched = m[0];
    if (numberCore(matched) !== wantedCore) continue;
    // Absorb one run of spaces after the token so the visible text does not
    // start with a stray leading space.
    const afterSpaces = text.slice(matched.length).match(/^\s+/);
    const prefix = matched + (afterSpaces ? afterSpaces[0] : '');
    return { prefix, rest: text.slice(prefix.length) };
  }
  return null;
}

/** Strips only that leading prefix (a no-op, byte-identical result, when
 *  there is none) -- for the checker's save, never a general rewrite. */
export function stripLeadingNumberPrefix(
  body: string,
  displayNumber: string | null | undefined,
): { stripped: string; removed: string | null } {
  const match = matchLeadingNumberPrefix(body, displayNumber);
  if (!match) return { stripped: body, removed: null };
  return { stripped: match.rest, removed: match.prefix };
}

/** For BankPaper.tsx: the text to show under the number badge, with a
 *  self-repeating leading number hidden. Render-only -- `row.t` in storage
 *  is untouched. */
export function displayBodyWithoutDuplicateNumber(
  body: string,
  shownBadge: string | null | undefined,
): string {
  if (!shownBadge) return body;
  const match = matchLeadingNumberPrefix(body, shownBadge);
  return match ? match.rest : body;
}

export const FIX_RULE_TITLE = 'Only fix what the computer read wrong';
export const FIX_RULE_NOTE =
  'Make it match the printed paper exactly: fix wrong letters, numbers or symbols, and add words that are missing. Do not reword it, fix its grammar or make it better, even if the paper has a mistake.';
export const BIG_EDIT_WARNING =
  "You changed a lot. Only fix reading mistakes so it matches the paper exactly. If the words are too broken to fix, press Ask the HOD instead.";

/* ---------------------------------------------------------------------------
   Marks left inside the text. The pipeline is meant to lift "[3]" out of the
   words and into the Marks box, but some rows still carry it ("Find x. [3]",
   "(2 marks)", "$[1 \times 10 = 10]$"). Owner, 11 Oct 2026: "the marks is right
   there in the square bracket ... these are patterns that you need to fix".

   Nothing here rewrites words. findMarksInBody() only recognises ONE marks
   token at the very end of the text, and moveMarksOut() cuts exactly those
   characters out; every other character stays, which the tests prove by
   putting the token back. Anything unclear (two tokens, a token in the middle,
   a word glued to the bracket as in the code "a[5]") is left alone. */

const MARKS_NUM = String.raw`\d{1,3}(?:\.\d{1,2})?`;
const MARKS_TIMES = String.raw`(?:x|X|×|\\times|\\cdot|\*)`;
// The printed shapes, each with the number that is the marks in a capture group.
const MARKS_PLAIN = [
  String.raw`\[\s*(${MARKS_NUM})\s*(?:marks?)?\s*\]`,
  String.raw`\(\s*(${MARKS_NUM})\s*marks?\s*\)`,
  String.raw`\[\s*${MARKS_NUM}\s*${MARKS_TIMES}\s*${MARKS_NUM}\s*=\s*(${MARKS_NUM})\s*\]`,
];
// Each shape may be wrapped in maths delimiters: $[3]$ or \([3]\).
const MARKS_SHAPES = MARKS_PLAIN.flatMap((p) => [
  String.raw`\$\s*${p}\s*\$`,
  String.raw`\\\(\s*${p}\s*\\\)`,
  p,
]);

export interface MarksInBody {
  /** The marks the token states. */
  marks: number;
  /** The exact characters of the token, delimiters included. */
  token: string;
  /** Code unit range of the token in the body (slice-ready). */
  start: number;
  end: number;
}

/** The single marks token at the end of a body, or null. Null as well when the
 *  body holds more than one marks-looking token (marks per part: leave them),
 *  when the token is not the last thing in the text, or when it is glued to a
 *  word like code (a[5]). */
export function findMarksInBody(body: string | null | undefined): MarksInBody | null {
  const text = body ?? '';
  if (!text) return null;
  const re = new RegExp(MARKS_SHAPES.join('|'), 'g');
  const found: { start: number; end: number; marks: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    // The marks number is whichever capture group matched.
    const raw = m.slice(1).find((g) => g !== undefined);
    found.push({ start: m.index, end: m.index + m[0].length, marks: raw === undefined ? NaN : Number(raw) });
  }
  if (found.length !== 1) return null;
  const hit = found[0];
  if (!Number.isFinite(hit.marks) || !(hit.marks > 0) || hit.marks > 200) return null;
  if (text.slice(hit.end).trim() !== '') return null; // must be the last thing
  const before = hit.start > 0 ? text[hit.start - 1] : '';
  if (before && /[A-Za-z0-9_\])]/.test(before)) return null; // a[5], f(x)[2]: not marks
  return { marks: hit.marks, token: text.slice(hit.start, hit.end), start: hit.start, end: hit.end };
}

/** True when a body still carries its marks inside the words. */
export function hasMarksInBody(body: string | null | undefined): boolean {
  return findMarksInBody(body) !== null;
}

/** The body with just the marks token cut out, and the marks it stated.
 *  `body` is the original with exactly `token` removed: nothing else moves. */
export function moveMarksOut(body: string): { body: string; marks: number; token: string } | null {
  const hit = findMarksInBody(body);
  if (!hit) return null;
  return { body: body.slice(0, hit.start) + body.slice(hit.end), marks: hit.marks, token: hit.token };
}

export const MARKS_INSIDE_HINT = 'The marks are inside the text. Move them to the Marks box.';
export const MARKS_MOVE_BUTTON = 'Move marks out';
