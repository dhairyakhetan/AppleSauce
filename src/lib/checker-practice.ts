/**
 * The practice round for new student checkers: made-up questions, each with
 * ONE planted mistake of a kind students really meet, and the fake API that
 * marks the answers.
 *
 * THE GUARANTEE. This file, the practice page and everything they import
 * stay clear of Supabase and of src/lib/checker-api.ts, so nothing a student
 * does in a practice round can reach the real queue, a real question or the
 * checker log. src/lib/checker-practice.test.ts walks the import graph to
 * prove it, so a later edit that wires a real call in fails CI.
 *
 * The question text here is invented for practice. None of it is copied
 * from a real paper.
 */

import { canSplitAt } from '@/lib/checker-body';

export type PracticeAction = 'pass' | 'fix' | 'split' | 'help' | 'skip' | 'or_only';

export interface PracticeQuestion {
  id: string;
  /** What the printed page says, one entry per line (drawn as the picture). */
  printed: string[];
  /** Draw the picture smudged, as a bad scan. */
  blurry?: boolean;
  /** What the computer typed. */
  body: string;
  /** The marks the computer typed, or null for none. */
  marks: number | null;
  /** The computer's first raw reading and its change log, when the lesson is
   *  about them (the "What the computer changed" section). */
  rawOcr?: string;
  editLog?: { kind: string; from: string; to: string }[];
  /** Split here is offered on this question (it looks like two). */
  offersSplit: boolean;
  /** The right move. */
  correct: PracticeAction;
  /** Fix: what the typed words must become, and the marks. */
  fixedBody?: string;
  fixedMarks?: number | null;
  /** Split: the second question starts at this code point offset (a tap one
   *  place before it is accepted too, because the space sits between). */
  splitAt?: number;
  /** Other cut points accepted for a Split (a tap either side of an OR). */
  splitAlso?: number[];
  /** After a skip the question waits on the paper. When the student comes
   *  back to it, this is the right move instead (and its lesson). */
  revisitCorrect?: PracticeAction;
  revisitLesson?: string;
  /** What the student should notice, in a sentence. Shown after answering. */
  lesson: string;
  /** Names the planted mistake, for the summary. */
  planted: string;
}

export type PracticeAnswer =
  | { action: 'pass' }
  | { action: 'fix'; body: string; marks: number | null }
  | { action: 'split'; at: number | null }
  | { action: 'help' }
  | { action: 'skip' }
  | { action: 'or_only' };

export interface PracticeResult {
  correct: boolean;
  /** One line: "Right." or "Not quite." */
  headline: string;
  /** What was right or wrong, and why. */
  explanation: string;
}

export const ACTION_NAMES: Record<PracticeAction, string> = {
  pass: 'Looks right',
  fix: 'Fix it',
  split: 'Split into two questions',
  help: 'Ask the HOD',
  skip: 'Skip this question',
  or_only: 'This is just the OR',
};

const OR_JOINED = '9. Describe one cause of the French Revolution. OR Explain one result of the French Revolution.';
const FUSED = '4. State the SI unit of force. 5. Name the force that pulls objects towards the Earth.';

export const PRACTICE_QUESTIONS: PracticeQuestion[] = [
  {
    id: 'practice-1',
    printed: ["1. Write the plural of 'child'.   [1]"],
    body: "1. Write the plural of 'child'.",
    marks: 1,
    offersSplit: false,
    correct: 'pass',
    lesson:
      'The typed words and the marks match the printed page exactly, so there is nothing to fix. Most real questions are like this.',
    planted: 'A clean question that only needs Looks right',
  },
  {
    id: 'practice-2',
    printed: ['2. Find the HCF of 18 and 24.   [2]'],
    body: '2. Find the HCF of 18 and 24.',
    marks: 3,
    offersSplit: false,
    correct: 'fix',
    fixedBody: '2. Find the HCF of 18 and 24.',
    fixedMarks: 2,
    lesson:
      'The words are right, but the printed page says [2] and the typed marks say 3. Press Fix it, change only the marks, and leave the words alone.',
    planted: 'Wrong marks',
  },
  {
    id: 'practice-3',
    printed: ['3. Name the largest planet in the solar system.   [1]'],
    body: '3. Name the largest planet in the system.',
    marks: 1,
    offersSplit: false,
    correct: 'fix',
    fixedBody: '3. Name the largest planet in the solar system.',
    fixedMarks: 1,
    lesson: 'The word "solar" is on the printed page but missing from the typed text. Press Fix it and add just that word.',
    planted: 'A missing word',
  },
  {
    id: 'practice-4',
    printed: ['4. State the SI unit of force.   [1]', '5. Name the force that pulls objects towards the Earth.   [1]'],
    body: FUSED,
    marks: null,
    offersSplit: true,
    correct: 'split',
    splitAt: Array.from(FUSED.slice(0, FUSED.indexOf('5.'))).length,
    lesson:
      'The printed page shows two separate questions, 4 and 5, but the computer joined them into one. Press Split into two questions, tap just before "5." and press Split here.',
    planted: 'Two questions joined into one (needs Split)',
  },
  {
    id: 'practice-5',
    printed: ['6. Name the gas that plants take in for photosynthesis.   [1]'],
    body: '6. Nme th# g@s tha7 pl^nts t4ke 1n f0r phot0syn+hesis.',
    marks: 1,
    offersSplit: false,
    correct: 'help',
    lesson:
      'The typed words are scrambled. Do not try to retype a whole question from the picture. Press Ask the HOD and your HOD will sort it out.',
    planted: 'Scrambled words, too broken to fix',
  },
  {
    id: 'practice-6',
    printed: ['7. Whcih river flows through Kolkata? Write its name.   [1]'],
    body: '7. Whcih river flows through Kolkata? Write its name.',
    marks: 1,
    offersSplit: false,
    correct: 'pass',
    lesson:
      'The paper itself misprints "Which", and the typed text copies the paper exactly. We check against the page, so Looks right is correct. Do not tidy the spelling.',
    planted: 'A typo that is in the printed paper itself',
  },
  {
    id: 'practice-7',
    printed: ['8. Find the area of the shaded region.   [3]', '   (a) Write down the formula you use.'],
    blurry: true,
    body: '8. Find the area of the shaded region.',
    marks: 3,
    offersSplit: false,
    correct: 'skip',
    lesson:
      'The picture is too blurry to read, so you cannot honestly say the words match. Press Skip this question. It stays on the paper for later, and you can go on to the next question. Never guess from a picture you cannot read.',
    revisitCorrect: 'help',
    revisitLesson:
      'You came back to a question you skipped earlier, and the picture is still too blurry to read. Do not skip it again and do not guess. Press Ask the HOD.',
    planted: 'A picture too blurry to read (skipped, then come back to)',
  },
  {
    id: 'practice-8',
    printed: [
      '9. Describe one cause of the French Revolution.   [3]',
      'OR',
      'Explain one result of the French Revolution.   [3]',
    ],
    body: OR_JOINED,
    marks: null,
    offersSplit: true,
    correct: 'split',
    splitAt: Array.from(OR_JOINED.slice(0, OR_JOINED.indexOf('OR '))).length,
    splitAlso: [
      Array.from(OR_JOINED.slice(0, OR_JOINED.indexOf('OR ') + 2)).length,
      Array.from(OR_JOINED.slice(0, OR_JOINED.indexOf('OR ') + 3)).length,
    ],
    lesson:
      'The page gives a choice of two questions with the word OR between them. Press Split into two questions, tap just before or just after the OR and press Split here. The OR is left out and the two questions are kept together as an either/or pair.',
    planted: 'Two questions joined by OR (Split at the OR)',
  },
  {
    id: 'practice-9',
    printed: ['OR'],
    body: 'OR',
    marks: null,
    offersSplit: false,
    correct: 'or_only',
    lesson:
      'This row is only the word OR. It is not a question, it is the OR between the question above and the one below. Press "This is just the OR": the row is set aside and the questions around it are linked as an either/or pair.',
    planted: 'A row that is only the word OR',
  },
  {
    id: 'practice-10',
    printed: ['10. Name the capital of India.   [1]'],
    body: '10. Name the capital of India. [1]',
    marks: null,
    offersSplit: false,
    correct: 'fix',
    fixedBody: '10. Name the capital of India.',
    fixedMarks: 1,
    lesson:
      'The marks, [1], were typed inside the words. They belong in the Marks box. Press Fix it, then Move marks out, and the [1] leaves the words and the Marks box says 1. Change nothing else.',
    planted: 'Marks left inside the words',
  },
  {
    id: 'practice-11',
    printed: ['11. Solve:  x\u00b2 \u2212 5x + 6 = 0   [2]'],
    body: '11. Solve: $x^2 - 5x + 6 = 6$',
    marks: 2,
    rawOcr: '11. Solve: x2 - 5x + 6 = O\n[2]',
    editLog: [
      { kind: 'fixed_ocr_word', from: 'O', to: '6' },
      { kind: 'moved_marks', from: '[2]', to: '' },
    ],
    offersSplit: false,
    correct: 'fix',
    fixedBody: '11. Solve: $x^2 - 5x + 6 = 0$',
    fixedMarks: 2,
    lesson:
      'The page says the equation equals 0, but the computer typed 6. Open "What the computer changed": it turned the letter O into a 6, which is a wrong change. Press Edit a formula and change the 6 back to 0. The list of changes shows you where the computer may have gone wrong.',
    planted: 'A formula the computer got wrong (see What the computer changed)',
  },
];

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** The formula keypad writes its own spacing and braces ("x^{2}" for "x^2"), so
 *  two bodies that hold a formula are compared with the spaces and those braces left out. */
function squashMaths(s: string): string {
  return s.replace(/\s+/g, '').replace(/\^\{(\w)\}/g, '^$1').replace(/_\{(\w)\}/g, '_$1');
}

export function sameBody(a: string, b: string): boolean {
  if (norm(a) === norm(b)) return true;
  return b.includes('$') && squashMaths(a) === squashMaths(b);
}

function right(explanation: string): PracticeResult {
  return { correct: true, headline: 'Right.', explanation };
}

function wrong(explanation: string): PracticeResult {
  return { correct: false, headline: 'Not quite.', explanation };
}

/** Marks one answer. Pure: the same question and answer give the same result. */
export function evaluatePracticeAnswer(base: PracticeQuestion, a: PracticeAnswer, revisit = false): PracticeResult {
  // A skipped question that is gone back to has a different right move.
  const q: PracticeQuestion =
    revisit && base.revisitCorrect
      ? { ...base, correct: base.revisitCorrect, lesson: base.revisitLesson ?? base.lesson }
      : base;
  if (a.action !== q.correct) {
    return wrong(`You pressed ${ACTION_NAMES[a.action]}, but ${ACTION_NAMES[q.correct]} was the right move here. ${q.lesson}`);
  }
  if (q.correct === 'fix' && a.action === 'fix') {
    const bodyOk = sameBody(a.body, q.fixedBody ?? q.body);
    const marksOk = (a.marks ?? null) === (q.fixedMarks ?? null);
    if (!bodyOk && !marksOk) {
      return wrong(
        `Fix it was right, but the words and the marks still differ from the page. The words should read: ${q.fixedBody} The marks should be ${q.fixedMarks}. ${q.lesson}`,
      );
    }
    if (!bodyOk) {
      return wrong(`Fix it was right, but the words still differ from the page. They should read: ${q.fixedBody} ${q.lesson}`);
    }
    if (!marksOk) {
      return wrong(`Fix it was right, but the marks still differ from the page. They should be ${q.fixedMarks}. ${q.lesson}`);
    }
    return right(q.lesson);
  }
  if (q.correct === 'split' && a.action === 'split') {
    const want = q.splitAt ?? -1;
    const at = a.at;
    if (at === null || !canSplitAt(q.body, at) || (at !== want && at !== want - 1 && !(q.splitAlso ?? []).includes(at))) {
      return wrong(`Split here was right, but the cut is in the wrong place. ${q.lesson}`);
    }
    return right(q.lesson);
  }
  return right(q.lesson);
}

export interface PracticeCall {
  id: string;
  action: PracticeAction;
}

export interface PracticeApi {
  questions(): PracticeQuestion[];
  /** `revisit` is true when the student has come back to a question they skipped. */
  answer(id: string, a: PracticeAnswer, revisit?: boolean): PracticeResult;
  /** Undo last: take back the most recent answer (practice only remembers it for tests). */
  undo(id: string): void;
  /** Every answer given, for tests. */
  calls: PracticeCall[];
  /** Every question id whose answer was taken back, for tests. */
  undone: string[];
}

/** The fake API the practice page talks to. In memory, no network. */
export function createPracticeApi(): PracticeApi {
  const calls: PracticeCall[] = [];
  const undone: string[] = [];
  return {
    calls,
    undone,
    undo(id) {
      undone.push(id);
    },
    questions: () => PRACTICE_QUESTIONS.map((q) => ({ ...q })),
    answer(id, a, revisit = false) {
      const q = PRACTICE_QUESTIONS.find((x) => x.id === id);
      if (!q) throw new Error(`No practice question ${id}`);
      calls.push({ id, action: a.action });
      return evaluatePracticeAnswer(q, a, revisit);
    },
  };
}

/** The printed-page picture, drawn as SVG so no image file ships. */
export function practicePictureDataUrl(lines: string[], blurry = false): string {
  const width = 520;
  const height = 28 + lines.length * 28;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const text = lines
    .map(
      (l, i) =>
        `<text x="16" y="${34 + i * 28}" font-family="Times New Roman, serif" font-size="18" fill="#222" xml:space="preserve">${esc(l)}</text>`,
    )
    .join('');
  const filter = blurry ? '<filter id="b"><feGaussianBlur stdDeviation="3.2"/></filter>' : '';
  const group = blurry ? `<g filter="url(#b)">${text}</g>` : text;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${filter}<rect width="100%" height="100%" fill="#fbfaf6"/>${group}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
