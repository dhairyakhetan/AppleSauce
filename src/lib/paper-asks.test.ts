import { describe, expect, it } from 'vitest';
import {
  ASK_EXPIRES_DAYS,
  askFailureMessage,
  askOutcomeMessage,
  isNotSwitchedOn,
  normaliseAskedAt,
  normaliseAskOutcome,
  normalisePaperAsks,
  waitingLine,
} from '@/lib/paper-asks';

describe('paper asks', () => {
  it('expires an ask after 3 days, the same number the database uses', () => {
    expect(ASK_EXPIRES_DAYS).toBe(3);
  });

  it('reads the three answers of the ask function and nothing else', () => {
    expect(normaliseAskOutcome('asked')).toBe('asked');
    expect(normaliseAskOutcome('already_asked')).toBe('already_asked');
    expect(normaliseAskOutcome('has_work')).toBe('has_work');
    expect(normaliseAskOutcome('ok')).toBeNull();
    expect(normaliseAskOutcome(null)).toBeNull();
    expect(normaliseAskOutcome(undefined)).toBeNull();
  });

  it('reads the time of my open ask, or null', () => {
    expect(normaliseAskedAt('2026-11-13T10:00:00Z')).toBe('2026-11-13T10:00:00Z');
    expect(normaliseAskedAt(null)).toBeNull();
    expect(normaliseAskedAt('not a date')).toBeNull();
    expect(normaliseAskedAt('')).toBeNull();
  });

  it('shapes the HOD list, oldest first, dropping rows without ids and filling missing names', () => {
    const rows = normalisePaperAsks([
      { ask_id: 'b', user_id: 'u2', person_name: 'Meera', asked_at: '2026-11-13T12:00:00Z', finished_recently: 1 },
      { ask_id: 'a', user_id: 'u1', person_name: null, asked_at: '2026-11-12T12:00:00Z', finished_recently: '3' },
      { user_id: 'u3', person_name: 'No id' },
      { ask_id: 'c', person_name: 'No user' },
      null,
      'junk',
    ]);
    expect(rows.map((r) => r.ask_id)).toEqual(['a', 'b']);
    expect(rows[0]).toMatchObject({ name: 'A checker', finished_recently: 3 });
    expect(normalisePaperAsks(null)).toEqual([]);
    expect(normalisePaperAsks({})).toEqual([]);
  });

  it('never shows a negative or fractional count of finished papers', () => {
    const [r] = normalisePaperAsks([{ ask_id: 'a', user_id: 'u', finished_recently: -4 }]);
    expect(r.finished_recently).toBe(0);
    const [s] = normalisePaperAsks([{ ask_id: 'a', user_id: 'u', finished_recently: 2.9 }]);
    expect(s.finished_recently).toBe(2);
  });

  it('knows the database part has not been pasted yet', () => {
    expect(isNotSwitchedOn({ code: 'PGRST202', message: 'x' })).toBe(true);
    expect(isNotSwitchedOn({ code: '42883', message: 'function does not exist' })).toBe(true);
    expect(isNotSwitchedOn({ message: 'Could not find the function public.hod_paper_asks without parameters in the schema cache' })).toBe(true);
    expect(isNotSwitchedOn({ code: '42501', message: 'Not authorized' })).toBe(false);
    expect(isNotSwitchedOn(new Error('The request took longer than 30 seconds.'))).toBe(false);
    expect(isNotSwitchedOn(null)).toBe(false);
    expect(isNotSwitchedOn('text')).toBe(false);
  });

  it('explains a failed ask in plain words', () => {
    expect(askFailureMessage({ code: '54000', message: 'You have already asked a few times today. Please check back tomorrow.' })).toContain('check back tomorrow');
    expect(askFailureMessage({ code: '42501', message: 'Not authorized' })).toContain('Only checkers');
    expect(askFailureMessage(new Error('boom'))).toContain('did not go through');
    expect(askFailureMessage(null)).toContain('did not go through');
  });

  it('writes the HOD line with since-when and papers finished lately', () => {
    expect(waitingLine({ finished_recently: 0 }, 'about 2 hours ago')).toBe('Free about 2 hours ago');
    expect(waitingLine({ finished_recently: 1 }, 'about 2 hours ago')).toBe('Free about 2 hours ago · finished 1 paper in the last two weeks');
    expect(waitingLine({ finished_recently: 4 }, '1 day ago')).toBe('Free 1 day ago · finished 4 papers in the last two weeks');
    expect(waitingLine({ finished_recently: 0 }, '')).toBe('Free now');
  });

  it('says something warm for every outcome', () => {
    expect(askOutcomeMessage('asked')).toMatch(/^Thank you/);
    expect(askOutcomeMessage('already_asked')).toContain('already asked');
    expect(askOutcomeMessage('has_work')).toContain('My papers');
  });
});
