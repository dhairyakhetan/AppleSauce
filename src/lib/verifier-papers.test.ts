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

  it('puts unfinished papers first, the nearest to done first, finished last', () => {
    const sorted = sortPapers([
      { ...list[1], paper_id: 'done', remaining: 0 },
      { ...list[0], paper_id: 'many', remaining: 20 },
      { ...list[0], paper_id: 'few', remaining: 2 },
    ]);
    expect(sorted.map((p) => p.paper_id)).toEqual(['few', 'many', 'done']);
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
    expect(stateSummary(qs)).toBe('1 to verify, 1 done, 1 with the HOD, 1 not for verifiers');
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
    expect(PAPER_LIMIT_NOTE).toBe('You get up to 10 papers at a time; more arrive as you finish.');
  });
});
