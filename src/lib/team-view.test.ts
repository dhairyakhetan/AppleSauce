import { describe, expect, it } from 'vitest';
import { moreCount, nextPaperLimit, papersShownText, summaryLine, totalsOf } from '@/lib/team-view';
import type { TeamStatsRow } from '@/lib/team-dashboard-api';

const row = (over: Partial<TeamStatsRow>): TeamStatsRow => ({
  user_id: 'u',
  name: 'N',
  questions_checked: 0,
  passed: 0,
  fixed: 0,
  asked_help: 0,
  skipped: 0,
  papers_completed: 0,
  median_seconds: null,
  admin_overturns: 0,
  ...over,
});

describe('team totals and summary', () => {
  it('adds the rows up', () => {
    const t = totalsOf([row({ questions_checked: 5, passed: 3, fixed: 1, asked_help: 1 }), row({ questions_checked: 2, passed: 2, admin_overturns: 1 })]);
    expect(t).toEqual({ checked: 7, passed: 5, fixed: 1, askedHelp: 1, changedByAdmin: 1 });
  });

  it('writes one line with no dashes, and mentions admin changes only when there are some', () => {
    const none = summaryLine(totalsOf([row({ questions_checked: 1, passed: 1 })]));
    expect(none).toBe('1 question checked, 1 passed, 0 fixed, 0 asked the HOD for help.');
    const some = summaryLine(totalsOf([row({ questions_checked: 4, passed: 2, fixed: 1, asked_help: 1, admin_overturns: 2 })]));
    expect(some).toContain('2 changed by an admin');
    expect(some).not.toMatch(/[–—]/);
  });
});

describe('papers window', () => {
  it('says how many are shown of how many', () => {
    expect(papersShownText(30, 47)).toBe('Showing 30 of 47 papers');
    expect(papersShownText(47, 47)).toBe('47 papers');
    expect(papersShownText(1, 1)).toBe('1 paper');
    expect(papersShownText(30, 0)).toBe('');
  });

  it('grows 30 at a time and never past the total', () => {
    expect(nextPaperLimit(30, 47)).toBe(47);
    expect(nextPaperLimit(30, 100)).toBe(60);
    expect(moreCount(30, 47)).toBe(17);
    expect(moreCount(30, 100)).toBe(30);
    expect(moreCount(47, 47)).toBe(0);
  });
});
