import { describe, expect, it } from 'vitest';
import {
  answeredElsewhere,
  canUndoNow,
  forgetAnswered,
  KEPT_WORDS_NOTE,
  mayBeMyOtherTabAnswering,
  recordAnswered,
  SKIPPED_SOME_NOTE,
  skippedLeftState,
  typedWordsOfVerdict,
  typedWordsOnScreen,
  undoTitle,
  ANSWERED_ELSEWHERE_NOTE,
  UNDO_TITLE_HELD,
  type AnsweredEntry,
} from '@/lib/checker-aftermath';

// en and em dashes are not allowed in student copy (built without typing them here)
const DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

describe('B: Undo follows what the server took (not the buttons pressed)', () => {
  const none: AnsweredEntry[] = [];

  it('an answer made in this visit turns Undo on', () => {
    expect(canUndoNow(recordAnswered(none, 'q4', 'pass'), 0, false)).toBe(true);
  });

  it('a refused Pass leaves the list as it was, and Undo is held off until the next answer', () => {
    const afterQ4 = recordAnswered(none, 'q4', 'pass');
    const afterQ5 = recordAnswered(afterQ4, 'q5', 'pass');
    const afterRefusal = forgetAnswered(afterQ5, 'q5');
    expect(afterRefusal).toEqual(afterQ4);
    // held: Undo would point at q4, which the student did not just answer
    expect(canUndoNow(afterRefusal, 4, true)).toBe(false);
    // the next real answer releases it, and the list ends with that answer
    const afterQ6 = recordAnswered(afterRefusal, 'q6', 'fix');
    expect(canUndoNow(afterQ6, 5, false)).toBe(true);
    expect(afterQ6.at(-1)?.questionId).toBe('q6');
  });

  it('forgetting an answer that is not in the list changes nothing', () => {
    const list = recordAnswered(none, 'q1', 'skip');
    expect(forgetAnswered(list, 'zzz')).toEqual(list);
  });

  it('after a refresh the list is empty but a paper with done questions can still be undone', () => {
    expect(canUndoNow(none, 3, false)).toBe(true);
    expect(canUndoNow(none, 0, false)).toBe(false);
    expect(canUndoNow(none, undefined, false)).toBe(false);
    expect(canUndoNow(none, null, false)).toBe(false);
  });

  it('the button says why it is off', () => {
    expect(undoTitle(false, false)).toBe('Nothing to undo yet');
    expect(undoTitle(false, true)).toBe(UNDO_TITLE_HELD);
    expect(undoTitle(true, false)).toBe('Take back your last answer');
  });
});

describe('C: skipping the last question never claims the paper is finished', () => {
  const base = { includeSkipped: false, skippedCount: 0, remaining: 1, skippedLastAt: null, listReadAt: 0 };

  it('the list still says skipped 0 right after the skip: the skipped screen shows, without a made-up number', () => {
    const s = skippedLeftState({ ...base, skippedLastAt: 1000, listReadAt: 900 });
    expect(s).toEqual({ show: true, count: null });
  });

  it('the list failed to refetch (never newer than the skip): still the truth, no number', () => {
    expect(skippedLeftState({ ...base, skippedLastAt: 1000, listReadAt: 0, remaining: null })).toEqual({ show: true, count: null });
  });

  it('a list read after the skip gives the real number', () => {
    expect(skippedLeftState({ ...base, skippedLastAt: 1000, listReadAt: 2000, skippedCount: 3, remaining: 3 })).toEqual({ show: true, count: 3 });
  });

  it('a list read after the skip that still says 0 is not trusted over the skip', () => {
    expect(skippedLeftState({ ...base, skippedLastAt: 1000, listReadAt: 2000, skippedCount: 0 })).toEqual({ show: true, count: null });
  });

  it('without a skip just now, the list decides as before', () => {
    expect(skippedLeftState({ ...base, skippedCount: 2, remaining: 2 })).toEqual({ show: true, count: 2 });
    expect(skippedLeftState({ ...base, skippedCount: 0, remaining: 0 })).toEqual({ show: false, count: null });
    // some questions remain that are not skipped (with a colleague): not "only skipped"
    expect(skippedLeftState({ ...base, skippedCount: 1, remaining: 4 })).toEqual({ show: false, count: null });
  });

  it('going through the skipped ones turns the screen off', () => {
    expect(skippedLeftState({ ...base, includeSkipped: true, skippedLastAt: 1000 })).toEqual({ show: false, count: null });
  });

  it('the copy has no dashes and is plain', () => {
    expect(SKIPPED_SOME_NOTE).not.toMatch(DASH);
  });
});

describe('A and E: typed words are kept in view', () => {
  it('a refused fix hands back the words it carried', () => {
    expect(typedWordsOfVerdict('fix', { patch: { body: 'my long edit' }, version: 1 })).toBe('my long edit');
  });

  it('nothing to keep for a pass, a skip, a marks-only fix or blank words', () => {
    expect(typedWordsOfVerdict('pass', { version: 1 })).toBeNull();
    expect(typedWordsOfVerdict('skip', {})).toBeNull();
    expect(typedWordsOfVerdict('fix', { patch: { body: null, marks: 2 } })).toBeNull();
    expect(typedWordsOfVerdict('fix', { patch: { body: '   ' } })).toBeNull();
    expect(typedWordsOfVerdict('ask_help', { reason: 'x' })).toBeNull();
  });

  it('words on screen count only when they differ from the stored ones', () => {
    expect(typedWordsOnScreen('old', 'new words')).toBe('new words');
    expect(typedWordsOnScreen('same', 'same')).toBeNull();
    expect(typedWordsOnScreen(null, '')).toBeNull();
    expect(typedWordsOnScreen('old', '  ')).toBeNull();
  });

  it('the copy has no dashes', () => {
    for (const t of [KEPT_WORDS_NOTE, ANSWERED_ELSEWHERE_NOTE]) expect(t).not.toMatch(DASH);
  });
});

describe('A: the same person answered the open question from another tab', () => {
  const ev = (over: object = {}) => ({ action: 'checker_pass', questionId: 'q5', actorUserId: 'me', ...over });

  it('my own pass, fix or ask-the-HOD on the open question means: go and look', () => {
    for (const action of ['checker_pass', 'checker_fix', 'checker_printed_typo', 'checker_ask_help']) {
      expect(mayBeMyOtherTabAnswering(ev({ action }), 'q5', 'me')).toBe(true);
    }
  });

  it('not for another question, another person, a split, an undo, or nothing open', () => {
    expect(mayBeMyOtherTabAnswering(ev({ questionId: 'q6' }), 'q5', 'me')).toBe(false);
    expect(mayBeMyOtherTabAnswering(ev({ actorUserId: 'admin' }), 'q5', 'me')).toBe(false);
    expect(mayBeMyOtherTabAnswering(ev({ actorUserId: null }), 'q5', 'me')).toBe(false);
    expect(mayBeMyOtherTabAnswering(ev({ action: 'checker_split' }), 'q5', 'me')).toBe(false);
    expect(mayBeMyOtherTabAnswering(ev({ action: 'verifier_undo' }), 'q5', 'me')).toBe(false);
    expect(mayBeMyOtherTabAnswering(ev(), null, 'me')).toBe(false);
    expect(mayBeMyOtherTabAnswering(ev(), 'q5', null)).toBe(false);
  });

  it('only a list that shows the question done or with the HOD moves the screen', () => {
    expect(answeredElsewhere({ state: 'done' })).toBe(true);
    expect(answeredElsewhere({ state: 'with_hod' })).toBe(true);
    expect(answeredElsewhere({ state: 'to_verify' })).toBe(false);
    expect(answeredElsewhere(undefined)).toBe(false);
    expect(answeredElsewhere(null)).toBe(false);
  });
});
