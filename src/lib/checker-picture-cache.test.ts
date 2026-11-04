import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/checker-api', () => ({ peekNextInPaper: vi.fn(), checkerPictureUrls: vi.fn() }));

import { cachedPictureUrl, clearPictureCache, LINK_TTL_MS, pictureCacheSize, primePicture } from '@/lib/checker-picture-cache';

afterEach(() => clearPictureCache());

const q = (id: string, source: Record<string, unknown>) => ({ id, source });

describe('picture links asked for early', () => {
  it('signs the picture of a question the moment it arrives, and useSignedUrl reuses it', async () => {
    const pictureUrl = vi.fn(async (p: string) => `https://signed/${p}`);
    primePicture({ pictureUrl }, q('q1', { snippet_object: 'paper/q1.png', align_score: 0.97 }));
    expect(pictureUrl).toHaveBeenCalledTimes(1);
    await expect(cachedPictureUrl({ pictureUrl }, 'paper/q1.png')).resolves.toBe('https://signed/paper/q1.png');
    expect(pictureUrl).toHaveBeenCalledTimes(1);
  });

  it('asks for a different picture normally (a sub-part that shows its parent\'s crop)', async () => {
    const pictureUrl = vi.fn(async (p: string) => `https://signed/${p}`);
    primePicture({ pictureUrl }, q('q1', { snippet_object: 'paper/q1.png' }));
    await cachedPictureUrl({ pictureUrl }, 'paper/parent.png');
    expect(pictureUrl).toHaveBeenCalledTimes(2);
  });

  it('plans nothing for a doubtful or missing crop', () => {
    const pictureUrl = vi.fn(async (p: string) => p);
    primePicture({ pictureUrl }, q('q1', { snippet_object: 'paper/q1.png', align_score: 0.5 }));
    primePicture({ pictureUrl }, q('q2', {}));
    expect(pictureUrl).not.toHaveBeenCalled();
  });

  it('does not keep a failed signing', async () => {
    const pictureUrl = vi.fn(async () => null);
    await cachedPictureUrl({ pictureUrl }, 'paper/x.png');
    await Promise.resolve();
    expect(pictureCacheSize()).toBe(0);
    await cachedPictureUrl({ pictureUrl }, 'paper/x.png');
    expect(pictureUrl).toHaveBeenCalledTimes(2);
  });

  it('stops trusting a link before the signed URL expires', async () => {
    const pictureUrl = vi.fn(async (p: string) => `https://signed/${p}`);
    await cachedPictureUrl({ pictureUrl }, 'a.png', 1000);
    await cachedPictureUrl({ pictureUrl }, 'a.png', 1000 + LINK_TTL_MS - 1);
    expect(pictureUrl).toHaveBeenCalledTimes(1);
    await cachedPictureUrl({ pictureUrl }, 'a.png', 1000 + LINK_TTL_MS + 1);
    expect(pictureUrl).toHaveBeenCalledTimes(2);
  });
});
