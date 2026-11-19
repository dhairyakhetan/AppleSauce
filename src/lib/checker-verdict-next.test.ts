import { describe, expect, it } from 'vitest';

import { TYPO_NEEDS_VERSION } from '@/lib/checker-save';
import { normaliseVerdictAndNext, verdictAndNextArgs } from '@/lib/checker-verdict-next';

describe('verdictAndNextArgs', () => {
  it('builds the pass call the server expects', () => {
    expect(verdictAndNextArgs({ action: 'pass', questionId: 'q1', paperId: 'p1', version: 3 })).toEqual({
      p_action: 'pass',
      p_question_id: 'q1',
      p_paper_id: 'p1',
      p_expected_version: 3,
      p_body: null,
      p_display_number: null,
      p_marks: null,
      p_printed_typo: false,
      p_typo_note: null,
      p_reason: null,
      p_include_skipped: false,
    });
  });

  it('carries a fix patch, the typo flag and a trimmed note, with the words untouched', () => {
    const body = '  Find  the value of x.\n';
    const args = verdictAndNextArgs({
      action: 'fix',
      questionId: 'q1',
      paperId: 'p1',
      version: 2,
      patch: { body, display_number: '4', marks: 2 },
      printedTypo: true,
      typoNote: '  wrote 5 for 6  ',
    });
    expect(args.p_body).toBe(body);
    expect(args.p_display_number).toBe('4');
    expect(args.p_marks).toBe(2);
    expect(args.p_printed_typo).toBe(true);
    expect(args.p_typo_note).toBe('wrote 5 for 6');
  });

  it('carries the reason for ask_help and the skipped mode', () => {
    const args = verdictAndNextArgs({ action: 'ask_help', questionId: 'q1', paperId: 'p1', reason: 'cut off', includeSkipped: true });
    expect(args.p_reason).toBe('cut off');
    expect(args.p_include_skipped).toBe(true);
    expect(args.p_expected_version).toBeNull();
  });

  it('refuses a printed-typo fix without a version before any network call, like checkerFixQuestion', () => {
    expect(() =>
      verdictAndNextArgs({ action: 'fix', questionId: 'q1', paperId: 'p1', printedTypo: true, patch: { body: 'x' } }),
    ).toThrow(TYPO_NEEDS_VERSION);
  });

  it('rejects an unknown action', () => {
    expect(() => verdictAndNextArgs({ action: 'nope' as never, questionId: 'q1', paperId: 'p1' })).toThrow(/Unknown verdict/);
  });
});

describe('normaliseVerdictAndNext', () => {
  const next = { id: 'q2', paper_id: 'p1', ord: 2, body: 'Second  question\n', context: [{ id: 'q2', ord: 2 }] };

  it('returns the next question with its context, byte for byte', () => {
    const out = normaliseVerdictAndNext({ verdict_ok: true, verdict: 'pass', verdict_version: 3, next, next_paper_id: 'p1' });
    expect(out.verdict_ok).toBe(true);
    expect(out.verdict_version).toBe(3);
    expect(out.next?.id).toBe('q2');
    expect(out.next?.body).toBe('Second  question\n');
    expect(out.next?.context).toHaveLength(1);
    expect(out.next_paper_id).toBe('p1');
  });

  it('accepts a one-element array, as PostgREST can wrap it', () => {
    const out = normaliseVerdictAndNext([{ verdict_ok: true, verdict: 'skip', verdict_version: null, next: null, next_paper_id: null }]);
    expect(out.next).toBeNull();
    expect(out.verdict_version).toBeNull();
  });

  it('gives an empty context when the server sent none, and null when nothing is left', () => {
    const out = normaliseVerdictAndNext({ verdict_ok: true, verdict: 'pass', verdict_version: 1, next: { id: 'q9', body: 'x' }, next_paper_id: 'p1' });
    expect(out.next?.context).toEqual([]);
    const last = normaliseVerdictAndNext({ verdict_ok: true, verdict: 'pass', verdict_version: 1, next: null, next_paper_id: 'p1' });
    expect(last.next).toBeNull();
    expect(last.next_paper_id).toBeNull();
  });

  it('throws when the server did not confirm the verdict', () => {
    expect(() => normaliseVerdictAndNext(null)).toThrow();
    expect(() => normaliseVerdictAndNext({})).toThrow();
    expect(() => normaliseVerdictAndNext({ verdict_ok: false })).toThrow();
  });
});
