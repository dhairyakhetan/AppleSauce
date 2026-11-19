import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), from: vi.fn(), storage: { from: vi.fn() }, auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
}));

import { verifierSubjectsWithPapers } from '@/lib/checker-api';
import { subjectFamilyLabel, subjectsHint } from '@/lib/verifier-papers';

/* "Ask your HOD for subjects" refuses a subject the library has no papers in (tracker of 2 Nov,
   "error when submitting preferred subjects"). The box now says which subjects work. The read
   behind it must never throw: before the 20261105100000 migration is applied the function does
   not exist, and the box then simply has no hint. */

describe('subjectsHint', () => {
  it('names the subjects with their on-screen names, most papers first as given', () => {
    expect(subjectsHint(['mathematics', 'english', 'historyandcivics', 'economics'])).toBe(
      'Subjects with papers right now: Mathematics, English, History & Civics, Economics.',
    );
  });

  it('says nothing when the list is not known or empty', () => {
    expect(subjectsHint([])).toBe('');
    expect(subjectsHint(null)).toBe('');
    expect(subjectsHint(undefined)).toBe('');
  });

  it('still names a subject it has no pretty label for', () => {
    expect(subjectFamilyLabel('physics')).toBe('Physics');
    expect(subjectFamilyLabel('  ENGLISH ')).toBe('English');
  });
});

describe('verifierSubjectsWithPapers never throws', () => {
  // Braces matter: a function returned from beforeEach is run as a clean-up step after the test.
  beforeEach(() => {
    rpc.mockReset();
  });

  it('returns the list the function gives, text only', async () => {
    rpc.mockResolvedValue({ data: ['mathematics', '', 7, 'english'], error: null });
    await expect(verifierSubjectsWithPapers()).resolves.toEqual(['mathematics', 'english']);
    expect(rpc).toHaveBeenCalledWith('verifier_subjects_with_papers');
  });

  it('returns an empty list when the function is not there yet (migration not applied)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42883', message: 'function does not exist' } });
    await expect(verifierSubjectsWithPapers()).resolves.toEqual([]);
  });

  it('returns an empty list on an unexpected answer', async () => {
    rpc.mockResolvedValue({ data: 'nope', error: null });
    await expect(verifierSubjectsWithPapers()).resolves.toEqual([]);
  });

  it('returns an empty list when the network call itself fails', async () => {
    rpc.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(verifierSubjectsWithPapers()).resolves.toEqual([]);
  });
});
