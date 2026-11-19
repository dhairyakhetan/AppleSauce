import { describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/* The practice round must NEVER reach Supabase. Two proofs:
   1. the import graph: walk every module the practice page and its fake API
      import (transitively) and fail if one is Supabase or checker-api.ts;
   2. a runtime tripwire: the Supabase client is replaced by one that throws
      on any use, and a full round is played through the fake API. */

const supabaseTripwire = vi.hoisted(() => ({ touched: [] as string[] }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: new Proxy(
    {},
    {
      get(_t, prop) {
        supabaseTripwire.touched.push(String(prop));
        throw new Error(`Practice touched Supabase: ${String(prop)}`);
      },
    },
  ),
}));

import { findMarksInBody, moveMarksOut } from '@/lib/checker-body';
import {
  ACTION_NAMES,
  PRACTICE_QUESTIONS,
  createPracticeApi,
  evaluatePracticeAnswer,
  practicePictureDataUrl,
  type PracticeAnswer,
  type PracticeQuestion,
} from '@/lib/checker-practice';

const SRC = resolve(__dirname, '..');

/** Value imports only (not `import type`), relative or `@/` paths and bare packages. */
function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const out: string[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;]*?)\s*from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[2]) continue; // import type / export type: erased at build time
    out.push(m[4]);
  }
  const bare = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  while ((m = bare.exec(text))) out.push(m[1]);
  const dyn = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dyn.exec(text))) out.push(m[1]);
  return out;
}

function resolveLocal(spec: string, from: string): string | null {
  let base: string | null = null;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(from, '..', spec);
  if (!base) return null;
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const p = base + ext;
    if (existsSync(p) && /\.(ts|tsx)$/.test(p)) return p;
  }
  return null;
}

function graphOf(entries: string[]): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [...entries];
  while (queue.length) {
    const f = queue.pop()!;
    if (files.has(f)) continue;
    files.add(f);
    for (const spec of importsOf(f)) {
      const local = resolveLocal(spec, f);
      if (local) queue.push(local);
      else if (!spec.startsWith('.') && !spec.startsWith('@/')) packages.add(spec);
      else throw new Error(`Could not resolve ${spec} from ${f}`);
    }
  }
  return { files, packages };
}

const ENTRIES = [
  join(SRC, 'pages/CheckerPractice.tsx'),
  join(SRC, 'lib/checker-practice.ts'),
];

describe('practice round never reaches Supabase', () => {
  const { files, packages } = graphOf(ENTRIES);
  const rel = [...files].map((f) => f.slice(SRC.length + 1).replace(/\\/g, '/'));

  it('walks a real graph (the walk itself is not empty)', () => {
    expect(rel).toContain('pages/CheckerPractice.tsx');
    expect(rel).toContain('lib/checker-practice.ts');
    expect(rel).toContain('lib/checker-body.ts');
    expect(rel.length).toBeGreaterThan(6);
  });

  it('imports no Supabase client and no checker-api, directly or through anything it imports', () => {
    const bad = rel.filter((f) => /supabase|checker-api|checker-admin-api|checker-log-api|admin-queue-api/i.test(f));
    expect(bad).toEqual([]);
    expect([...packages].filter((p) => /supabase/i.test(p))).toEqual([]);
  });

  it('imports no auth context or data-fetching hook either', () => {
    expect(rel.filter((f) => /auth-context|useSiteCounts|react-query/i.test(f))).toEqual([]);
    expect([...packages].filter((p) => /tanstack/i.test(p))).toEqual([]);
  });

  it('plays a whole round through the fake API without touching the Supabase tripwire', () => {
    const api = createPracticeApi();
    for (const q of api.questions()) {
      const r = api.answer(q.id, rightAnswer(q));
      expect(r.correct).toBe(true);
    }
    expect(api.calls).toHaveLength(PRACTICE_QUESTIONS.length);
    expect(supabaseTripwire.touched).toEqual([]);
  });
});

function rightAnswer(q: PracticeQuestion): PracticeAnswer {
  switch (q.correct) {
    case 'fix':
      return { action: 'fix', body: q.fixedBody ?? q.body, marks: q.fixedMarks ?? null };
    case 'split':
      return { action: 'split', at: q.splitAt ?? null };
    default:
      return { action: q.correct };
  }
}

describe('practice questions', () => {
  it('has 5 to 12 questions, each with its own id', () => {
    expect(PRACTICE_QUESTIONS.length).toBeGreaterThanOrEqual(5);
    expect(PRACTICE_QUESTIONS.length).toBeLessThanOrEqual(12);
    expect(new Set(PRACTICE_QUESTIONS.map((q) => q.id)).size).toBe(PRACTICE_QUESTIONS.length);
  });

  it('plants the mistakes students really meet', () => {
    const correct = PRACTICE_QUESTIONS.map((q) => q.correct);
    expect(correct).toContain('pass'); // a clean one
    expect(correct).toContain('fix'); // wrong mark and missing word
    expect(correct).toContain('split'); // a fused question
    expect(correct).toContain('help'); // ask for help is right
    expect(correct).toContain('skip'); // unreadable picture
    expect(correct).toContain('or_only'); // a row that is only the word OR
    const fixes = PRACTICE_QUESTIONS.filter((q) => q.correct === 'fix');
    expect(fixes.some((q) => q.fixedMarks !== q.marks)).toBe(true); // wrong mark
    expect(fixes.some((q) => q.fixedBody !== q.body)).toBe(true); // missing word
  });

  it('the typed text really differs from the printed page only where the lesson says', () => {
    const printedText = (q: PracticeQuestion) => q.printed.map((l) => l.replace(/\s*\[\d+\]\s*$/, '')).join(' ').replace(/\s+/g, ' ');
    const clean = PRACTICE_QUESTIONS.filter((q) => q.correct === 'pass');
    for (const q of clean) expect(q.body.replace(/\s+/g, ' ')).toBe(printedText(q));
    const missing = PRACTICE_QUESTIONS.find((q) => q.id === 'practice-3')!;
    expect(missing.fixedBody).toBe(printedText(missing));
  });

  it('every right answer is marked right, and a wrong move is marked wrong with the reason', () => {
    for (const q of PRACTICE_QUESTIONS) {
      expect(evaluatePracticeAnswer(q, rightAnswer(q)).correct).toBe(true);
      const wrongAction = q.correct === 'pass' ? 'skip' : 'pass';
      const r = evaluatePracticeAnswer(q, { action: wrongAction });
      expect(r.correct).toBe(false);
      expect(r.explanation).toContain(ACTION_NAMES[q.correct]);
      expect(r.explanation).toContain(q.lesson);
    }
  });

  it('Fix it with the planted mistake still in place is wrong, and says what differs', () => {
    const marks = PRACTICE_QUESTIONS.find((q) => q.id === 'practice-2')!;
    const stillWrong = evaluatePracticeAnswer(marks, { action: 'fix', body: marks.body, marks: marks.marks });
    expect(stillWrong.correct).toBe(false);
    expect(stillWrong.explanation).toMatch(/marks/);
    const word = PRACTICE_QUESTIONS.find((q) => q.id === 'practice-3')!;
    const reworded = evaluatePracticeAnswer(word, { action: 'fix', body: 'Which planet is the biggest?', marks: 1 });
    expect(reworded.correct).toBe(false);
    expect(reworded.explanation).toContain(word.fixedBody!);
  });

  it('Split must cut at the second question, not anywhere', () => {
    const q = PRACTICE_QUESTIONS.find((x) => x.correct === 'split')!;
    expect(evaluatePracticeAnswer(q, { action: 'split', at: q.splitAt! }).correct).toBe(true);
    expect(evaluatePracticeAnswer(q, { action: 'split', at: q.splitAt! - 1 }).correct).toBe(true);
    expect(evaluatePracticeAnswer(q, { action: 'split', at: 5 }).correct).toBe(false);
    expect(evaluatePracticeAnswer(q, { action: 'split', at: null }).correct).toBe(false);
  });

  it('has a question with two questions joined by OR, and Split accepts a tap either side of the OR', () => {
    const q = PRACTICE_QUESTIONS.find((x) => x.id === 'practice-8')!;
    expect(q.correct).toBe('split');
    expect(q.body).toContain(' OR ');
    for (const at of [q.splitAt!, q.splitAt! - 1, ...q.splitAlso!]) {
      expect(evaluatePracticeAnswer(q, { action: 'split', at }).correct, String(at)).toBe(true);
    }
    expect(evaluatePracticeAnswer(q, { action: 'split', at: 5 }).correct).toBe(false);
  });

  it('has a row that is only the word OR, answered by This is just the OR', () => {
    const q = PRACTICE_QUESTIONS.find((x) => x.correct === 'or_only')!;
    expect(q.body).toBe('OR');
    expect(evaluatePracticeAnswer(q, { action: 'or_only' }).correct).toBe(true);
    const wrong = evaluatePracticeAnswer(q, { action: 'pass' });
    expect(wrong.correct).toBe(false);
    expect(wrong.explanation).toContain(ACTION_NAMES.or_only);
  });

  it('a skipped question waits and, when gone back to, the right move is to ask the HOD', () => {
    const q = PRACTICE_QUESTIONS.find((x) => x.correct === 'skip')!;
    expect(q.revisitCorrect).toBe('help');
    expect(evaluatePracticeAnswer(q, { action: 'skip' }).correct).toBe(true);
    expect(evaluatePracticeAnswer(q, { action: 'skip' }, true).correct).toBe(false);
    expect(evaluatePracticeAnswer(q, { action: 'help' }, true).correct).toBe(true);
  });

  it('teaches Move marks out: marks typed inside the words are a Fix it, and both must be put right', () => {
    const q = PRACTICE_QUESTIONS.find((x) => x.id === 'practice-10')!;
    expect(q.correct).toBe('fix');
    expect(findMarksInBody(q.body)?.marks).toBe(q.fixedMarks);
    // What the Move marks out button produces is exactly the right answer.
    const moved = moveMarksOut(q.body)!;
    expect(evaluatePracticeAnswer(q, { action: 'fix', body: moved.body, marks: moved.marks }).correct).toBe(true);
    // Only the words fixed, marks box still empty: wrong, and it names the marks.
    const half = evaluatePracticeAnswer(q, { action: 'fix', body: moved.body, marks: null });
    expect(half.correct).toBe(false);
    expect(half.explanation).toMatch(/marks/);
    // Only the marks typed, token still in the words: wrong, and it names the words.
    const other = evaluatePracticeAnswer(q, { action: 'fix', body: q.body, marks: 1 });
    expect(other.correct).toBe(false);
    expect(other.explanation).toContain(q.fixedBody!);
  });

  it('teaches What the computer changed and Edit a formula: a wrong change in the list, a formula to put right', () => {
    const q = PRACTICE_QUESTIONS.find((x) => x.id === 'practice-11')!;
    expect(q.rawOcr).toBeTruthy();
    expect(q.editLog?.some((e) => e.kind === 'fixed_ocr_word')).toBe(true);
    expect(q.body).toContain('$');
    expect(evaluatePracticeAnswer(q, rightAnswer(q)).correct).toBe(true);
    // The keypad rewrites spacing and braces; that is still the same formula.
    const keypad = evaluatePracticeAnswer(q, { action: 'fix', body: '11. Solve: $x^{2}-5x+6=0$', marks: 2 });
    expect(keypad.correct).toBe(true);
    // The wrong formula left as it is stays wrong.
    expect(evaluatePracticeAnswer(q, { action: 'fix', body: q.body, marks: 2 }).correct).toBe(false);
  });

  it('Undo last is local: the fake only remembers which answer was taken back', () => {
    const api = createPracticeApi();
    api.answer('practice-1', { action: 'pass' });
    api.undo('practice-1');
    expect(api.undone).toEqual(['practice-1']);
    expect(supabaseTripwire.touched).toEqual([]);
  });

  it('keeps the made-up copy free of em and en dashes', () => {
    const text = JSON.stringify(PRACTICE_QUESTIONS.map((q) => [q.lesson, q.planted]));
    expect(text).not.toMatch(/[–—]/);
  });

  it('draws a picture for every question, blurred when asked', () => {
    for (const q of PRACTICE_QUESTIONS) {
      const url = practicePictureDataUrl(q.printed, q.blurry);
      expect(url.startsWith('data:image/svg+xml')).toBe(true);
      expect(decodeURIComponent(url).includes('feGaussianBlur')).toBe(Boolean(q.blurry));
    }
  });

  it('rejects an unknown question id instead of inventing a result', () => {
    expect(() => createPracticeApi().answer('nope', { action: 'pass' })).toThrow();
  });
});
