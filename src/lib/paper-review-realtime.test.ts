import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDebouncer,
  firstNameOf,
  formatOnlineNames,
  isForeignChangeToOpenQuestion,
  parseActivityPayload,
  shapeOnlineList,
} from './paper-review-realtime';

describe('parseActivityPayload', () => {
  it('reads the trigger payload', () => {
    expect(
      parseActivityPayload({
        id: 'x', source: 'audit', action: 'checker_pass', question_id: 'q1', paper_id: 'p1',
        actor_user_id: 'u1', at: '2026-09-28T10:00:00Z',
      }),
    ).toEqual({
      source: 'audit', action: 'checker_pass', questionId: 'q1', paperId: 'p1',
      actorUserId: 'u1', at: '2026-09-28T10:00:00Z',
    });
  });

  it('keeps nulls as nulls and live as live', () => {
    expect(parseActivityPayload({ source: 'live', action: 'admin_hide', question_id: null, paper_id: null, actor_user_id: null }))
      .toMatchObject({ source: 'live', questionId: null, paperId: null, actorUserId: null });
  });

  it('drops anything malformed instead of throwing', () => {
    expect(parseActivityPayload(null)).toBeNull();
    expect(parseActivityPayload('checker_pass')).toBeNull();
    expect(parseActivityPayload({ question_id: 'q1' })).toBeNull();
    expect(parseActivityPayload({ action: 42 })).toBeNull();
  });
});

describe('isForeignChangeToOpenQuestion', () => {
  const ev = (questionId: string | null, actorUserId: string | null) =>
    ({ source: 'audit' as const, action: 'checker_pass', questionId, paperId: null, actorUserId, at: null });

  it('fires when someone else acts on my open question', () => {
    expect(isForeignChangeToOpenQuestion(ev('q1', 'admin'), 'q1', 'me')).toBe(true);
  });
  it('fires for an AI or system change (no actor)', () => {
    expect(isForeignChangeToOpenQuestion(ev('q1', null), 'q1', 'me')).toBe(true);
  });
  it('ignores my own action', () => {
    expect(isForeignChangeToOpenQuestion(ev('q1', 'me'), 'q1', 'me')).toBe(false);
  });
  it('ignores other questions, paper-level events, and no open question', () => {
    expect(isForeignChangeToOpenQuestion(ev('q2', 'admin'), 'q1', 'me')).toBe(false);
    expect(isForeignChangeToOpenQuestion(ev(null, 'admin'), 'q1', 'me')).toBe(false);
    expect(isForeignChangeToOpenQuestion(ev('q1', 'admin'), null, 'me')).toBe(false);
  });
});

describe('presence shaping', () => {
  it('uses the first word of the name only, never an email', () => {
    expect(firstNameOf('Asha Roy Chowdhury')).toBe('Asha');
    expect(firstNameOf('  Ravi  ')).toBe('Ravi');
    expect(firstNameOf('asha@example.com')).toBe('Someone');
    expect(firstNameOf(null)).toBe('Someone');
    expect(firstNameOf('')).toBe('Someone');
  });

  it('collapses several tabs into one person, drops blanks, sorts, can exclude me', () => {
    const state = {
      u2: [{ user_id: 'u2', first_name: 'Ravi' }, { user_id: 'u2', first_name: 'Ravi' }],
      u1: [{ user_id: 'u1', first_name: 'Asha Roy' }],
      me: [{ user_id: 'me', first_name: 'Kanishk' }],
      junk: [{ first_name: 'Nobody' }],
    };
    expect(shapeOnlineList(state, 'me')).toEqual([
      { userId: 'u1', firstName: 'Asha' },
      { userId: 'u2', firstName: 'Ravi' },
    ]);
    expect(shapeOnlineList(state).map((p) => p.userId)).toEqual(['u1', 'me', 'u2']);
    expect(shapeOnlineList(undefined)).toEqual([]);
  });

  it('formats names as a sentence', () => {
    const p = (firstName: string) => ({ userId: firstName, firstName });
    expect(formatOnlineNames([])).toBe('');
    expect(formatOnlineNames([p('Asha')])).toBe('Asha');
    expect(formatOnlineNames([p('Asha'), p('Ravi')])).toBe('Asha and Ravi');
    expect(formatOnlineNames([p('Asha'), p('Ravi'), p('Mou')])).toBe('Asha, Ravi and Mou');
  });
});

describe('createDebouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs once, wait ms after the last event of a burst', () => {
    const fn = vi.fn();
    const d = createDebouncer(fn, 3000, 10000);
    d.trigger();
    vi.advanceTimersByTime(1000);
    d.trigger();
    vi.advanceTimersByTime(2999);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(d.pending()).toBe(false);
  });

  it('never waits longer than maxWait under a steady stream', () => {
    const fn = vi.fn();
    const d = createDebouncer(fn, 3000, 10000);
    for (let t = 0; t < 10000; t += 1000) {
      d.trigger();
      vi.advanceTimersByTime(1000);
    }
    expect(fn).toHaveBeenCalledTimes(1);
    // The ceiling resets after a run.
    d.trigger();
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('cancel drops the pending run', () => {
    const fn = vi.fn();
    const d = createDebouncer(fn, 3000, 10000);
    d.trigger();
    d.cancel();
    vi.advanceTimersByTime(20000);
    expect(fn).not.toHaveBeenCalled();
  });
});

/* The migration is what keeps a client from forging an activity event and
   what keeps the trigger functions unreachable. String assertions, like
   bank-sql-grants.test.ts, because no typecheck can see inside SQL. */
describe('the realtime migration', () => {
  const sql = readFileSync('supabase/migrations/20260928180000_paper_review_realtime.sql', 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

  it('lets clients insert presence only, never broadcast', () => {
    const insertPolicy = sql.match(/create policy[^;]*for insert[^;]*;/i)?.[0] ?? '';
    expect(insertPolicy).toMatch(/extension\s*=\s*'presence'/);
    expect(insertPolicy).not.toMatch(/broadcast/);
    expect(insertPolicy).toMatch(/realtime\.topic\(\)\s*=\s*'paper-review'/);
  });

  it('limits receiving to checkers and admins on this one topic', () => {
    const selectPolicy = sql.match(/create policy[^;]*for select[^;]*;/i)?.[0] ?? '';
    expect(selectPolicy).toMatch(/to authenticated/);
    expect(selectPolicy).toMatch(/realtime\.topic\(\)\s*=\s*'paper-review'/);
    expect(selectPolicy).toMatch(/public\.is_admin\(\)\s+or\s+public\.is_paper_checker\(\)/);
  });

  it('revokes both trigger functions from public, anon and authenticated', () => {
    for (const fn of ['trg_broadcast_paper_review_activity', 'trg_broadcast_paper_review_live_change']) {
      for (const role of ['public', 'anon', 'authenticated']) {
        expect(sql).toMatch(new RegExp(`revoke all on function public\\.${fn}\\(\\) from ${role};`));
      }
      expect(sql).not.toMatch(new RegExp(`grant[^;]*${fn}`));
    }
  });

  it('never puts question text, names or emails in a payload', () => {
    const payloads = sql.match(/jsonb_build_object\([^;]*?\)\s*,\s*'activity'/g) ?? [];
    expect(payloads.length).toBeGreaterThanOrEqual(3);
    for (const p of payloads) expect(p).not.toMatch(/body|full_name|email|note|before|after/);
  });
});
