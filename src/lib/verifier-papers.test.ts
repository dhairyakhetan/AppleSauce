import { describe, expect, it } from 'vitest';
import {
  formatGrade,
  formatValidUntil,
  normaliseMyPapers,
  normalisePaperQuestions,
  normaliseProfile,
  paperCardProgress,
  parseSubjectList,
  profileNotice,
  profileStatus,
  questionLabel,
  sortPapers,
  stateCounts,
  stateSummary,
  QUESTION_STATE_LABEL,
} from '@/lib/verifier-papers';

describe('verifier_my_papers mapping', () => {
  const list = normaliseMyPapers([
    { assignment_id: '3', paper_id: 'p1', subject: 'Maths', cls: 'X', total: 12, done: 4, remaining: 8, with_hod: 1, given_by_hod: true },
    { paper_id: 'p2', total: '5', done: '5', remaining: 0 },
    { subject: 'no paper' },
  ]);

  it('maps rows and drops the one with no paper', () => {
    expect(list).toHaveLength(2);
    expect(list[0].assignment_id).toBe(3);
    expect(list[0].given_by_hod).toBe(true);
    expect(list[0].with_hod).toBe(1);
    expect(list[1].given_by_hod).toBe(false);
  });

  it('tolerates a non-array', () => {
    expect(normaliseMyPapers(null)).toEqual([]);
  });

  it('works out card progress', () => {
    expect(paperCardProgress(list[0])).toEqual({ label: '4 of 12 done', percent: 33, finished: false });
    expect(paperCardProgress(list[1])).toEqual({ label: '5 of 5 done', percent: 100, finished: true });
    expect(paperCardProgress({ total: 0, done: 0, remaining: 0 }).percent).toBe(0);
  });

  it('counts the whole paper on the card when the server sends it (owner, 8 Nov 2026: "if others were passed it should show full")', () => {
    // 30 questions, the computer passed 29, one is left for this verifier: it must read 29 of 30, not 0 of 1.
    const [row] = normaliseMyPapers([
      { paper_id: 'econ', total: 1, done: 0, remaining: 1, with_hod: 0, paper_total: 30, paper_passed: 29 },
    ]);
    expect(row.paper_total).toBe(30);
    expect(row.paper_passed).toBe(29);
    expect(paperCardProgress(row)).toEqual({ label: '29 of 30 done', percent: 97, finished: false });
    // `done` is untouched: the undo button and the Start / Keep verifying button read it.
    expect(row.done).toBe(0);
    expect(row.total).toBe(1);
  });

  it('shows a finished paper as whole, and keeps the old own-share reading when the server sends no whole-paper counts', () => {
    expect(paperCardProgress({ total: 52, done: 51, remaining: 0, paper_total: 52, paper_passed: 52 })).toEqual({ label: '52 of 52 done', percent: 100, finished: true });
    expect(paperCardProgress({ total: 12, done: 4, remaining: 8, paper_total: 0, paper_passed: 0 }).label).toBe('4 of 12 done');
    // A whole-paper count that is smaller than passed + left can never show more done than total.
    expect(paperCardProgress({ total: 3, done: 0, remaining: 3, paper_total: 2, paper_passed: 1 }).label).toBe('1 of 4 done');
  });

  it('puts unfinished papers first in hand-out order, finished last', () => {
    const sorted = sortPapers([
      { ...list[1], paper_id: 'done', remaining: 0, assigned_at: '2026-11-01T09:00:00Z' },
      { ...list[0], paper_id: 'second', remaining: 2, assigned_at: '2026-11-02T09:00:00Z' },
      { ...list[0], paper_id: 'first', remaining: 20, assigned_at: '2026-11-01T10:00:00Z' },
    ]);
    expect(sorted.map((p) => p.paper_id)).toEqual(['first', 'second', 'done']);
  });

  it('does not reshuffle the cards when answers change how many questions are left', () => {
    const base = [
      { ...list[0], assignment_id: 1, paper_id: 'a', remaining: 9, assigned_at: '2026-11-01T09:00:00Z' },
      { ...list[0], assignment_id: 2, paper_id: 'b', remaining: 5, assigned_at: '2026-11-01T10:00:00Z' },
      { ...list[0], assignment_id: 3, paper_id: 'c', remaining: 7, assigned_at: '2026-11-01T11:00:00Z' },
    ];
    const before = sortPapers(base).map((p) => p.paper_id);
    // Two answers on paper a: it now has the fewest left. Its card must stay where it was.
    const after = sortPapers(base.map((p) => (p.paper_id === 'a' ? { ...p, remaining: 3 } : p))).map((p) => p.paper_id);
    expect(after).toEqual(before);
    expect(before).toEqual(['a', 'b', 'c']);
  });

  it('breaks a tie on the hand-out time by the assignment id, the way the server does', () => {
    const t = '2026-11-01T09:00:00Z';
    const sorted = sortPapers([
      { ...list[0], assignment_id: 8, paper_id: 'later', remaining: 4, assigned_at: t },
      { ...list[0], assignment_id: 5, paper_id: 'earlier', remaining: 9, assigned_at: t },
    ]);
    expect(sorted.map((p) => p.paper_id)).toEqual(['earlier', 'later']);
  });
});

describe('verifier_paper_questions mapping', () => {
  const qs = normalisePaperQuestions([
    { id: 'a', ord: 1, display_number: '1', body: '  Keep   this \n', marks: '2', state: 'done', page: 1 },
    { id: 'b', ord: 2, number_path: '2(a)', body: 'x', state: 'to_verify' },
    { id: 'c', ord: 3, body: 'y', state: 'with_hod' },
    { id: 'd', ord: 4, body: 'z', state: 'something new' },
    { body: 'no id' },
  ]);

  it('keeps the question words byte for byte', () => {
    expect(qs[0].body).toBe('  Keep   this \n');
  });

  it('reads marks and page, and drops the row with no id', () => {
    expect(qs).toHaveLength(4);
    expect(qs[0].marks).toBe(2);
    expect(qs[0].page).toBe(1);
    expect(qs[1].page).toBeNull();
  });

  it('an unknown state is treated as not for verifiers', () => {
    expect(qs[3].state).toBe('not_for_verifiers');
  });

  it('labels a question by its printed number, else its path, else its place', () => {
    expect(questionLabel(qs[0], 0)).toBe('1');
    expect(questionLabel(qs[1], 1)).toBe('2(a)');
    expect(questionLabel(qs[2], 2)).toBe('3');
  });

  it('counts and summarises states, leaving out zeros', () => {
    expect(stateCounts(qs).to_verify).toBe(1);
    expect(stateSummary(qs)).toBe('1 to verify, 1 done, 1 with the HOD, 1 not for checkers');
    expect(stateSummary([])).toBe('');
  });

  it('state labels are plain words with no dashes or codes', () => {
    expect(JSON.stringify(Object.values(QUESTION_STATE_LABEL))).not.toMatch(/[–—_]/);
  });
});

describe('verifier_my_profile mapping', () => {
  it('reads a complete profile', () => {
    const p = normaliseProfile([
      { full_name: 'Asha', grade: 10, school: 'S', board: 'ICSE', valid_until: '2027-03-31', expired: false, preferred_subjects: ['Maths'], requested_subjects: [] },
    ])!;
    expect(p.grade).toBe(10);
    expect(profileStatus(p)).toBe('ok');
    expect(profileNotice('ok')).toBeNull();
    expect(formatGrade(p.grade)).toBe('Grade 10');
    expect(formatValidUntil(p.valid_until)).toBe('31 Mar 2027');
  });

  it('no row or no grade is missing; the notice asks for details but says papers still come (20261008100000)', () => {
    expect(normaliseProfile([])).toBeNull();
    expect(profileStatus(null)).toBe('missing');
    expect(profileStatus(normaliseProfile({ grade: 0 }))).toBe('missing');
    expect(profileNotice('missing')).toMatch(/Add your grade, school and board/);
    expect(profileNotice('missing')).toMatch(/Papers are given to you either way/);
    expect(profileNotice('missing')).not.toMatch(/no papers/i);
    expect(formatGrade(null)).toBe('Not set');
    expect(formatValidUntil(null)).toBe('Not set');
  });

  it('an expired profile says so', () => {
    const p = normaliseProfile({ grade: 9, expired: true })!;
    expect(profileStatus(p)).toBe('expired');
    expect(profileNotice('expired')).toMatch(/expired/);
  });

  it('a verifier never reads AI confidence in these notices', () => {
    expect(`${profileNotice('missing')}${profileNotice('expired')}`).not.toMatch(/confiden/i);
  });
});

describe('parseSubjectList', () => {
  it('splits on commas, semicolons and new lines, dropping blanks and repeats', () => {
    expect(parseSubjectList('Maths, Physics;  maths\n\nChemistry ,')).toEqual(['Maths', 'Physics', 'Chemistry']);
    expect(parseSubjectList('   ')).toEqual([]);
  });
});

describe('paper limit note', () => {
  it('says the limit in plain words', async () => {
    const { PAPER_LIMIT_NOTE } = await import('@/lib/verifier-papers');
    expect(PAPER_LIMIT_NOTE).toBe(
      'You get up to 10 papers at a time; more arrive as you finish. A paper with nothing done on it for 7 days goes back to the pool.',
    );
  });
});
