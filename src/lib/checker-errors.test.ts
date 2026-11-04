import { describe, expect, it } from 'vitest';

import {
  checkerErrorAdvice,
  LOAD_FAILED_NOTE,
  LOAD_FAILED_TITLE,
  nextLoadProblem,
  PAPER_GONE_NOTE,
  PAPER_GONE_TITLE,
  requestSubjectsErrorMessage,
} from './checker-errors';

describe('requestSubjectsErrorMessage', () => {
  it('shows the server\'s own sentence when a subject has no papers (tracker bug, 2 Nov 2026)', () => {
    const sentence = 'No papers in Typing. Subjects with papers: English, History, Economics';
    expect(requestSubjectsErrorMessage({ code: '22023', message: `  ${sentence}  ` })).toBe(sentence);
  });

  it('says plainly when the account is not a checker, without the code', () => {
    const m = requestSubjectsErrorMessage({ code: '42501', message: 'Not authorized' });
    expect(m).toMatch(/cannot check papers/);
    expect(m).not.toMatch(/42501/);
  });

  it('keeps the generic line for a network failure or an empty refusal', () => {
    for (const e of [new TypeError('Failed to fetch'), { code: '22023', message: '   ' }, null]) {
      expect(requestSubjectsErrorMessage(e)).toBe('Could not send that. Try again in a moment.');
    }
  });
});

describe('checkerErrorAdvice', () => {
  it('moves on when the lease ran out, instead of blaming the internet', () => {
    const a = checkerErrorAdvice({ code: '42501', message: 'This question is not currently assigned to you' });
    expect(a.moveOn).toBe(true);
    expect(a.message).not.toMatch(/internet/);
  });

  it('says plainly when the paper itself is no longer assigned (12 Oct 2026: admin self-assign was swept away)', () => {
    const a = checkerErrorAdvice({ code: '42501', message: 'This paper is not assigned to you' });
    expect(a.moveOn).toBe(true);
    expect(a.message).toMatch(/no longer assigned to you/);
    expect(a.message).not.toMatch(/internet|42501/);
  });

  it('moves on for a question sent to the HOD, gone, or on a paper not open for checking', () => {
    for (const message of [
      'This question was sent to the HOD',
      'Question not found',
      'This paper is not eligible for checking',
    ]) {
      expect(checkerErrorAdvice({ code: '42501', message }).moveOn, message).toBe(true);
    }
  });

  it('moves on when someone else changed the question (40001)', () => {
    expect(checkerErrorAdvice({ code: '40001', message: 'stale question text, reload and retry' }).moveOn).toBe(true);
    expect(
      checkerErrorAdvice({ code: '40001', message: 'This question already has an unapplied split pending' }).moveOn,
    ).toBe(true);
  });

  it('explains a split point the server refused', () => {
    const a = checkerErrorAdvice({ code: 'P0001', message: 'Split point out of range' });
    expect(a.moveOn).toBe(false);
    expect(a.message).toMatch(/Tap inside the words/);
  });

  it('explains a refused blank pass', () => {
    const a = checkerErrorAdvice({ code: '22023', message: 'This question has no words; it cannot be passed' });
    expect(a.message).toMatch(/Ask the HOD/);
  });

  it('falls back to the internet message for a network failure', () => {
    const a = checkerErrorAdvice(new TypeError('Failed to fetch'));
    expect(a.moveOn).toBe(false);
    expect(a.message).toMatch(/internet/);
  });

  it('never shows a raw error, code or SQL text', () => {
    for (const e of [
      { code: '42501', message: 'Not authorized' },
      { code: 'XX000', message: 'relation "audit_questions" does not exist' },
      null,
      'boom',
    ]) {
      const m = checkerErrorAdvice(e).message;
      expect(m).not.toMatch(/42501|XX000|relation|audit_|null|boom/);
      expect(m).not.toMatch(/[–—]/);
    }
  });

  it('has load-failure copy with no dashes', () => {
    expect(`${LOAD_FAILED_TITLE} ${LOAD_FAILED_NOTE}`).not.toMatch(/[–—]/);
  });
});

describe('nextLoadProblem (a failed read of the next question)', () => {
  const notAssigned = { code: '42501', message: 'This paper is not assigned to you' };

  it('is not a problem when the paper was already finished: a closed paper refuses the next read, and the finished screen stays (Nov 2026: "asks me to sign in again after each paper")', () => {
    // The screen holds null = "Paper finished". Any activity on the live channel asks for the next
    // question again, and the paper, now closed, answers 42501 "not assigned to you".
    expect(nextLoadProblem(notAssigned, null)).toBe('none');
  });

  it('says the paper is gone when it was never loaded, or a question was still up', () => {
    expect(nextLoadProblem(notAssigned, undefined)).toBe('paper_gone');
    expect(nextLoadProblem(notAssigned, { id: 'q1' })).toBe('paper_gone');
  });

  it('keeps "sign in again" for a real refusal of the account, and the retry screen for the rest', () => {
    expect(nextLoadProblem({ code: '42501', message: 'Not authorized' }, undefined)).toBe('no_access');
    expect(nextLoadProblem(new TypeError('Failed to fetch'), undefined)).toBe('failed');
    expect(nextLoadProblem(new TypeError('Failed to fetch'), null)).toBe('failed');
  });

  it('is none when nothing failed', () => {
    expect(nextLoadProblem(null, undefined)).toBe('none');
  });

  it('has plain copy with no dashes and no sign-in wording', () => {
    expect(`${PAPER_GONE_TITLE} ${PAPER_GONE_NOTE}`).not.toMatch(/[–—]|sign in/i);
  });
});
