import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GROUP,
  EMPTY_DRAFT,
  KIND_CHOICES,
  NO_REQUEST_COUNTS,
  REQUEST_GROUPS,
  REQUEST_STATUSES,
  SENT_AS_HOD,
  SENT_TO_HOD,
  decisionProblem,
  describeScreen,
  draftProblem,
  groupCounts,
  groupOf,
  groupRequests,
  groupStatuses,
  hodStatusWord,
  kindWord,
  memberStatusLine,
  memberStatusWord,
  newestFirst,
  normaliseRequest,
  normaliseRequestCounts,
  normaliseRequests,
  requestErrorWords,
  requestsBadgeLabel,
  screenPath,
  timeAgo,
  waitingCount,
  type FixRequest,
  type RequestStatus,
} from '@/lib/fix-requests';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  created_at: '2026-11-12T10:00:00Z',
  raised_by_name: 'Asha',
  raised_as: 'member',
  kind: 'bug',
  title: 'The button does nothing',
  details: 'I pressed it twice.',
  page_path: '/checker',
  status: 'waiting_for_hod',
  decided_by_name: null,
  decided_at: null,
  decision_note: null,
  claude_note: null,
  done_at: null,
  ...over,
});

const req = (over: Partial<FixRequest> = {}): FixRequest => ({ ...(normaliseRequest(row()) as FixRequest), ...over });

describe('normaliseRequest', () => {
  it('shapes a full row', () => {
    const r = normaliseRequest(row({ status: 'done', claude_note: 'Fixed it.', done_at: '2026-11-13T09:00:00Z' }));
    expect(r).toMatchObject({ id: 'r1', kind: 'bug', status: 'done', claude_note: 'Fixed it.', raised_as: 'member', title: 'The button does nothing' });
  });

  it('turns empty strings into null and keeps the words untouched', () => {
    const r = normaliseRequest(row({ decision_note: '  ', details: '  two  spaces  ', page_path: '' }));
    expect(r?.decision_note).toBeNull();
    expect(r?.page_path).toBeNull();
    expect(r?.details).toBe('  two  spaces  ');
  });

  it('leaves out a row with no id, no title, an unknown kind or an unknown state', () => {
    expect(normaliseRequest(row({ id: null }))).toBeNull();
    expect(normaliseRequest(row({ title: '' }))).toBeNull();
    expect(normaliseRequest(row({ kind: 'question' }))).toBeNull();
    expect(normaliseRequest(row({ status: 'maybe' }))).toBeNull();
    expect(normaliseRequest(null)).toBeNull();
    expect(normaliseRequest('text')).toBeNull();
  });

  it('reads anything that is not "hod" as a member', () => {
    expect(normaliseRequest(row({ raised_as: 'hod' }))?.raised_as).toBe('hod');
    expect(normaliseRequest(row({ raised_as: undefined }))?.raised_as).toBe('member');
  });

  it('a list drops the bad rows and survives a non-list', () => {
    expect(normaliseRequests([row(), row({ id: null }), row({ id: 'r2' })]).map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(normaliseRequests(null)).toEqual([]);
    expect(normaliseRequests({})).toEqual([]);
  });
});

describe('normaliseRequestCounts and the numbers', () => {
  it('reads one row, a row inside a list, numbers as text, and anything missing as 0', () => {
    expect(normaliseRequestCounts({ waiting_for_hod: 3, approved: '2', in_progress: 1, rejected: 4, done: 5 })).toEqual({
      waiting_for_hod: 3,
      approved: 2,
      in_progress: 1,
      rejected: 4,
      done: 5,
    });
    expect(normaliseRequestCounts([{ waiting_for_hod: 7 }]).waiting_for_hod).toBe(7);
    expect(normaliseRequestCounts(null)).toEqual(NO_REQUEST_COUNTS);
    expect(normaliseRequestCounts({ waiting_for_hod: 'x', approved: -4 })).toEqual(NO_REQUEST_COUNTS);
  });

  it('the badge number is the ones waiting for the HOD', () => {
    expect(waitingCount({ ...NO_REQUEST_COUNTS, waiting_for_hod: 4, approved: 9 })).toBe(4);
    expect(waitingCount(null)).toBe(0);
    expect(waitingCount(undefined)).toBe(0);
  });

  it('counts each group, with Approved holding the ones being fixed', () => {
    expect(groupCounts({ waiting_for_hod: 1, approved: 2, in_progress: 3, rejected: 4, done: 5 })).toEqual({ waiting: 1, approved: 5, rejected: 4, done: 5 });
    expect(groupCounts(null)).toEqual({ waiting: 0, approved: 0, rejected: 0, done: 0 });
  });

  it('says what the badge means, one or many', () => {
    expect(requestsBadgeLabel(1)).toBe('1 request waiting for you');
    expect(requestsBadgeLabel(3)).toBe('3 requests waiting for you');
  });
});

describe('the words for each state', () => {
  it('a member sees plain words for all five', () => {
    expect(REQUEST_STATUSES.map(memberStatusWord)).toEqual(['Waiting for your HOD', 'Approved', 'Being fixed', 'Not taken forward', 'Done']);
  });

  it('an HOD sees their own words for all five', () => {
    expect(REQUEST_STATUSES.map(hodStatusWord)).toEqual(['Waiting for you', 'Approved', 'Being fixed', 'Rejected', 'Done']);
  });

  it('a rejection carries the HOD reason, and a finished one carries what Claude did', () => {
    expect(memberStatusLine({ status: 'rejected', raised_as: 'member', decision_note: 'Not now.', claude_note: null })).toBe(
      'Your HOD decided not to take this forward. Their reason: Not now.',
    );
    expect(memberStatusLine({ status: 'rejected', raised_as: 'member', decision_note: null, claude_note: null })).toBe('Your HOD decided not to take this forward.');
    expect(memberStatusLine({ status: 'done', raised_as: 'member', decision_note: null, claude_note: 'Picture link fixed.' })).toBe(
      'Fixed. What was done: Picture link fixed.',
    );
    expect(memberStatusLine({ status: 'done', raised_as: 'member', decision_note: null, claude_note: null })).toBe('Fixed.');
  });

  it('an HOD request that went straight on says so, and a member one says the HOD agreed', () => {
    expect(memberStatusLine({ status: 'approved', raised_as: 'hod', decision_note: null, claude_note: null })).toContain('straight on');
    expect(memberStatusLine({ status: 'approved', raised_as: 'member', decision_note: null, claude_note: null })).toContain('Your HOD said yes');
  });

  it('every state has a sentence', () => {
    for (const status of REQUEST_STATUSES) {
      expect(memberStatusLine({ status, raised_as: 'member', decision_note: null, claude_note: null }).length).toBeGreaterThan(5);
    }
  });

  it('the two choices and the kind names are plain', () => {
    expect(KIND_CHOICES.map((c) => c.label)).toEqual(['Something is broken', 'Something should change']);
    expect(KIND_CHOICES.map((c) => c.kind)).toEqual(['bug', 'edit']);
    expect(kindWord('bug')).toBe('Broken');
    expect(kindWord('edit')).toBe('Change');
  });

  it('the confirmations say who looks at it next', () => {
    expect(SENT_TO_HOD).toBe('Sent to your HOD. They will look at it before it goes on.');
    expect(SENT_AS_HOD).toContain('straight on');
  });

  it('uses no em or en dashes and no emoji anywhere in the words', () => {
    const all = [
      ...REQUEST_STATUSES.flatMap((s) => [memberStatusWord(s), hodStatusWord(s), memberStatusLine({ status: s, raised_as: 'member', decision_note: 'x', claude_note: 'y' })]),
      ...KIND_CHOICES.flatMap((c) => [c.label, c.hint]),
      ...REQUEST_GROUPS.flatMap((g) => [g.label, g.empty]),
      SENT_TO_HOD,
      SENT_AS_HOD,
    ].join(' ');
    expect(all).not.toMatch(/[–—]/);
    expect(all).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe('the groups', () => {
  it('are Waiting for you, Approved, Rejected and Done, opening on the first', () => {
    expect(REQUEST_GROUPS.map((g) => g.label)).toEqual(['Waiting for you', 'Approved', 'Rejected', 'Done']);
    expect(DEFAULT_GROUP).toBe('waiting');
  });

  it('put every state in exactly one group', () => {
    const seen = REQUEST_GROUPS.flatMap((g) => g.statuses);
    expect([...seen].sort()).toEqual([...REQUEST_STATUSES].sort());
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('know which group a state belongs to and which states a group holds', () => {
    expect(groupOf('waiting_for_hod')).toBe('waiting');
    expect(groupOf('approved')).toBe('approved');
    expect(groupOf('in_progress')).toBe('approved');
    expect(groupOf('rejected')).toBe('rejected');
    expect(groupOf('done')).toBe('done');
    expect(groupStatuses('approved')).toEqual(['approved', 'in_progress']);
    expect(groupStatuses('waiting')).toEqual(['waiting_for_hod']);
  });

  it('sort newest first, put an unreadable time last, and leave the input alone', () => {
    const a = req({ id: 'a', created_at: '2026-11-10T00:00:00Z' });
    const b = req({ id: 'b', created_at: '2026-11-12T00:00:00Z' });
    const c = req({ id: 'c', created_at: null });
    const input = [c, a, b];
    expect(newestFirst(input).map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(input.map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('file a mixed list under its groups, each newest first', () => {
    const list = [
      req({ id: '1', status: 'done', created_at: '2026-11-01T00:00:00Z' }),
      req({ id: '2', status: 'waiting_for_hod', created_at: '2026-11-02T00:00:00Z' }),
      req({ id: '3', status: 'in_progress', created_at: '2026-11-03T00:00:00Z' }),
      req({ id: '4', status: 'approved', created_at: '2026-11-04T00:00:00Z' }),
      req({ id: '5', status: 'waiting_for_hod', created_at: '2026-11-05T00:00:00Z' }),
      req({ id: '6', status: 'rejected', created_at: '2026-11-06T00:00:00Z' }),
    ];
    const g = groupRequests(list);
    expect(g.waiting.map((r) => r.id)).toEqual(['5', '2']);
    expect(g.approved.map((r) => r.id)).toEqual(['4', '3']);
    expect(g.rejected.map((r) => r.id)).toEqual(['6']);
    expect(g.done.map((r) => r.id)).toEqual(['1']);
  });

  it('an empty list gives four empty groups', () => {
    expect(groupRequests([])).toEqual({ waiting: [], approved: [], rejected: [], done: [] });
  });
});

describe('time', () => {
  it('says how long ago, or nothing for a missing or unreadable time', () => {
    const now = new Date('2026-11-12T12:00:00Z');
    expect(timeAgo('2026-11-12T11:00:00Z', now)).toBe('about 1 hour ago');
    expect(timeAgo(null, now)).toBe('');
    expect(timeAgo('not a date', now)).toBe('');
  });
});

describe('the screen a request came from', () => {
  it('names the checker screens in words and leaves the paper id out', () => {
    expect(describeScreen('/checker')).toBe('My papers');
    expect(describeScreen('/checker?paper=e1000000-0000-4000-8000-000000000001')).toBe('My papers, one paper');
    expect(describeScreen('/checker?paper=e1000000-0000-4000-8000-000000000001&verify=1')).toBe('My papers, checking a question');
    expect(describeScreen('/checker/practice')).toBe('The practice round');
    expect(describeScreen('/checker/help/')).toBe('Rules and shortcuts');
  });

  it('names the HOD desk and its tab', () => {
    expect(describeScreen('/hod')).toBe('HOD desk');
    expect(describeScreen('/hod?tab=live')).toBe('HOD desk, Live papers');
    expect(describeScreen('/hod?tab=requests')).toBe('HOD desk, Requests');
    expect(describeScreen('/hod?tab=nonsense')).toBe('HOD desk');
  });

  it('shows an unknown screen as its path, without the query, and a missing one as not known', () => {
    expect(describeScreen('/teachers/abc?x=1')).toBe('/teachers/abc');
    expect(describeScreen('/')).toBe('The home page');
    expect(describeScreen(null)).toBe('Not known');
    expect(describeScreen('')).toBe('Not known');
  });

  it('keeps the stored path within the database limit', () => {
    expect(screenPath({ pathname: '/checker', search: '?paper=1' })).toBe('/checker?paper=1');
    expect(screenPath({ pathname: '/checker' })).toBe('/checker');
    expect(screenPath({ pathname: '/x', search: '?' + 'a'.repeat(500) })).toHaveLength(300);
  });
});

describe('checking a draft before it is sent', () => {
  const ok = { kind: 'bug' as const, title: 'The button does nothing', details: '' };

  it('accepts a good one, with or without details', () => {
    expect(draftProblem(ok)).toBeNull();
    expect(draftProblem({ ...ok, details: 'More words.' })).toBeNull();
  });

  it('asks for a choice first', () => {
    expect(draftProblem(EMPTY_DRAFT)).toBe('Choose whether something is broken or something should change.');
  });

  it('wants a title of 3 to 120 letters, counted after trimming', () => {
    expect(draftProblem({ ...ok, title: '  ab  ' })).toBe('Give it a short title, at least 3 letters.');
    expect(draftProblem({ ...ok, title: 'abc' })).toBeNull();
    expect(draftProblem({ ...ok, title: 'a'.repeat(120) })).toBeNull();
    expect(draftProblem({ ...ok, title: 'a'.repeat(121) })).toBe('The title is too long. Keep it under 120 letters.');
  });

  it('allows up to 4000 letters of details', () => {
    expect(draftProblem({ ...ok, details: 'a'.repeat(4000) })).toBeNull();
    expect(draftProblem({ ...ok, details: 'a'.repeat(4001) })).toBe('The details are too long. Keep them under 4000 letters.');
  });

  it('a rejection must say why, an approval may be silent, and a long note is refused', () => {
    expect(decisionProblem(false, '   ')).toBe('Say in a few words why this is not going ahead.');
    expect(decisionProblem(false, 'Not now.')).toBeNull();
    expect(decisionProblem(true, '')).toBeNull();
    expect(decisionProblem(true, 'a'.repeat(501))).toBe('The note is too long. Keep it under 500 letters.');
  });
});

describe('error words', () => {
  it('shows the database own plain sentence for bad input, the daily limit and a decided request', () => {
    expect(requestErrorWords({ code: '22023', message: 'Give the request a short title, at least 3 letters.' })).toBe('Give the request a short title, at least 3 letters.');
    expect(requestErrorWords({ code: '54000', message: 'You have already sent 10 requests in the last day. Please try again tomorrow.' })).toContain('10 requests');
    expect(requestErrorWords({ code: '55000', message: 'This request has already been dealt with.' })).toBe('This request has already been dealt with.');
  });

  it('keeps a bare "not authorized" and anything unexpected out of sight', () => {
    expect(requestErrorWords({ code: '42501', message: 'Not authorized' })).toBe('Your account cannot do that. Nothing was changed.');
    expect(requestErrorWords({ code: '42501', message: 'Another HOD has to decide a request you sent.' })).toBe('Another HOD has to decide a request you sent.');
    expect(requestErrorWords({ code: '23505', message: 'duplicate key value violates unique constraint "x"' })).toBe('That did not go through. Nothing was changed. Try again.');
    expect(requestErrorWords(new Error('boom'))).toBe('That did not go through. Nothing was changed. Try again.');
    expect(requestErrorWords(null)).toBe('That did not go through. Nothing was changed. Try again.');
    expect(requestErrorWords(undefined, 'custom')).toBe('custom');
  });
});

describe('the status type', () => {
  it('lists the same five states as the table', () => {
    const states: RequestStatus[] = ['waiting_for_hod', 'approved', 'in_progress', 'rejected', 'done'];
    expect([...REQUEST_STATUSES]).toEqual(states);
  });
});
