import { describe, expect, it, vi } from 'vitest';
import { memoizeAsync } from '@/lib/memoize-async';

describe('memoizeAsync', () => {
  it('many askers for the same key cause one call', async () => {
    const fn = vi.fn(async (id: string) => [id]);
    const get = memoizeAsync(fn);
    const all = await Promise.all([get('p1'), get('p1'), get('p1')]);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(all[0]).toBe(all[2]);
    await get('p2');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('a failed call is forgotten, so a retry asks again', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(['ok']);
    const get = memoizeAsync<string, string[]>(fn);
    await expect(get('p1')).rejects.toThrow('offline');
    await expect(get('p1')).resolves.toEqual(['ok']);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('a value the keep test refuses is not remembered', async () => {
    const fn = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('https://x');
    const get = memoizeAsync<string, string | null>(fn, (v) => v !== null);
    expect(await get('a')).toBeNull();
    expect(await get('a')).toBe('https://x');
    expect(await get('a')).toBe('https://x');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
