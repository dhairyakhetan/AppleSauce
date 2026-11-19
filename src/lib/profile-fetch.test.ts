import { describe, expect, it, vi } from 'vitest';
import { fetchProfileWithRetry } from './profile-fetch';

const row = { role: 'student', full_name: 'A', terms_agreement: true };
const noWait = async (_ms?: number) => {};

describe('fetchProfileWithRetry', () => {
  it('returns the profile on the first good try, with no waiting', async () => {
    const fetchOnce = vi.fn().mockResolvedValue({ data: row, error: null });
    const sleep = vi.fn(noWait);
    const out = await fetchProfileWithRetry(fetchOnce, { sleep });
    expect(out).toEqual({ profile: { role: 'student', full_name: 'A', terms_agreement: true }, failed: false });
    expect(fetchOnce).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('tries again when the database reports an error, then succeeds', async () => {
    const fetchOnce = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'network' } })
      .mockResolvedValueOnce({ data: row, error: null });
    const out = await fetchProfileWithRetry(fetchOnce, { sleep: noWait });
    expect(out.profile?.role).toBe('student');
    expect(out.failed).toBe(false);
    expect(fetchOnce).toHaveBeenCalledTimes(2);
  });

  it('tries again when the read throws', async () => {
    const fetchOnce = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ data: row, error: null });
    const out = await fetchProfileWithRetry(fetchOnce, { sleep: noWait });
    expect(out.profile?.full_name).toBe('A');
    expect(out.failed).toBe(false);
  });

  it('gives up after the last try and says it failed', async () => {
    const fetchOnce = vi.fn().mockResolvedValue({ data: null, error: { message: 'down' } });
    const out = await fetchProfileWithRetry(fetchOnce, { delays: [1, 1], sleep: noWait });
    expect(out).toEqual({ profile: null, failed: true });
    expect(fetchOnce).toHaveBeenCalledTimes(3);
  });

  it('does not retry an honest "no row" answer', async () => {
    const fetchOnce = vi.fn().mockResolvedValue({ data: null, error: null });
    const out = await fetchProfileWithRetry(fetchOnce, { sleep: noWait });
    expect(out).toEqual({ profile: null, failed: false });
    expect(fetchOnce).toHaveBeenCalledTimes(1);
  });

  it('waits the given gaps between tries', async () => {
    const fetchOnce = vi.fn().mockResolvedValue({ data: null, error: { message: 'x' } });
    const sleep = vi.fn(noWait);
    await fetchProfileWithRetry(fetchOnce, { delays: [10, 20], sleep });
    expect(sleep.mock.calls.map(c => c[0])).toEqual([10, 20]);
  });

  it('stops quietly when the person has gone (cancelled)', async () => {
    const fetchOnce = vi.fn().mockResolvedValue({ data: null, error: { message: 'x' } });
    const out = await fetchProfileWithRetry(fetchOnce, { delays: [1, 1], sleep: noWait, isCancelled: () => true });
    expect(out.failed).toBe(true);
    expect(fetchOnce).toHaveBeenCalledTimes(1);
  });
});
