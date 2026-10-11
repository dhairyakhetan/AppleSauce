import { describe, expect, it } from 'vitest';
import { detailsState, needDetailsCount, needDetailsText, profilesById, sortByDetails, type DetailsState } from '@/lib/verifier-details';
import type { HodVerifierProfile } from '@/lib/hod-api';

const profile = (over: Partial<HodVerifierProfile>): HodVerifierProfile => ({
  user_id: 'u1',
  email: null,
  name: null,
  active: true,
  full_name: 'A',
  grade: 10,
  school: 'S',
  board: 'ICSE',
  valid_until: '2027-03-31',
  expired: false,
  missing: false,
  preferred_subjects: [],
  requested_subjects: [],
  requested_at: null,
  ...over,
});

describe('detailsState', () => {
  it('reads missing, expired and ready from the profile', () => {
    expect(detailsState(undefined, true)).toBe('missing');
    expect(detailsState(profile({ missing: true, grade: null }), true)).toBe('missing');
    expect(detailsState(profile({ expired: true }), true)).toBe('expired');
    expect(detailsState(profile({}), true)).toBe('ready');
  });

  it('says missing before expired when both are true', () => {
    expect(detailsState(profile({ missing: true, expired: true }), true)).toBe('missing');
  });

  it('is unknown, not missing, when the profiles could not be read', () => {
    expect(detailsState(undefined, false)).toBe('unknown');
  });
});

describe('join and order', () => {
  it('finds a profile by user id', () => {
    const m = profilesById([profile({ user_id: 'a' }), profile({ user_id: 'b' })]);
    expect(m.get('b')?.user_id).toBe('b');
    expect(profilesById(null).size).toBe(0);
  });

  it('puts missing first, then expired, keeping the given order inside each group', () => {
    const rows = [
      { id: 'r1', s: 'ready' as DetailsState },
      { id: 'e1', s: 'expired' as DetailsState },
      { id: 'm1', s: 'missing' as DetailsState },
      { id: 'r2', s: 'ready' as DetailsState },
      { id: 'm2', s: 'missing' as DetailsState },
    ];
    expect(sortByDetails(rows, (r) => r.s).map((r) => r.id)).toEqual(['m1', 'm2', 'e1', 'r1', 'r2']);
  });

  it('counts and words the verifiers who still need details', () => {
    expect(needDetailsCount(['missing', 'expired', 'ready', 'unknown'])).toBe(2);
    expect(needDetailsText(0)).toBe('');
    expect(needDetailsText(1)).toBe('1 verifier still needs details');
    expect(needDetailsText(3)).toBe('3 verifiers still need details');
  });
});
