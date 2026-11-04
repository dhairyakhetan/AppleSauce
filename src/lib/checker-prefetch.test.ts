import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/checker-api', () => ({
  peekNextInPaper: vi.fn(),
  checkerPictureUrls: vi.fn(),
}));

import type { PeekedQuestion } from '@/lib/checker-api';
import {
  MAX_WARM,
  WARM_TTL_MS,
  clearPrefetch,
  dropWarm,
  getWarm,
  prefetchNext,
  warmCount,
} from '@/lib/checker-prefetch';

function row(n: number, extra: Partial<PeekedQuestion> = {}): PeekedQuestion {
  return {
    id: `q${n}`,
    ord: n,
    display_number: String(n),
    page: 1,
    page_path: `paper/page-${n}.png`,
    snippet_path: `paper/q${n}.png`,
    held_by_me: false,
    ...extra,
  };
}

function deps(rows: PeekedQuestion[], now = 1_000_000) {
  const peek = vi.fn(async () => rows);
  const signMany = vi.fn(async (paths: string[]) => new Map(paths.map((p) => [p, `https://signed/${p}`])));
  const preload = vi.fn(async () => {});
  return { peek, signMany, preload, now: () => now };
}

afterEach(() => clearPrefetch());

describe('prefetchNext', () => {
  it('warms the snippet and page URLs of the peeked rows, keyed by question id', async () => {
    const d = deps([row(2), row(3)]);
    const out = await prefetchNext('paperA', { deps: d });
    expect(out.map((e) => e.questionId)).toEqual(['q2', 'q3']);
    expect(getWarm('q2', 1_000_001)?.snippetUrl).toBe('https://signed/paper/q2.png');
    expect(getWarm('q3', 1_000_001)?.pageUrl).toBe('https://signed/paper/page-3.png');
    expect(d.peek).toHaveBeenCalledWith('paperA', 3);
  });

  it('signs every path in ONE request', async () => {
    const d = deps([row(2), row(3)]);
    await prefetchNext('paperA', { deps: d });
    expect(d.signMany).toHaveBeenCalledTimes(1);
    expect(d.signMany.mock.calls[0][0]).toHaveLength(4);
  });

  it('skips the card already on screen (held_by_me)', async () => {
    const d = deps([row(1, { held_by_me: true }), row(2), row(3)]);
    const out = await prefetchNext('paperA', { deps: d });
    expect(out.map((e) => e.questionId)).toEqual(['q2', 'q3']);
    expect(getWarm('q1', 1_000_001)).toBeNull();
  });

  it('preloads the snippet image but not the page unless asked', async () => {
    const d = deps([row(2)]);
    await prefetchNext('paperA', { deps: d });
    expect(d.preload).toHaveBeenCalledTimes(1);
    expect(d.preload).toHaveBeenCalledWith('https://signed/paper/q2.png');

    const d2 = deps([row(3)]);
    await prefetchNext('paperA', { deps: d2, preloadPage: true });
    expect(d2.preload).toHaveBeenCalledTimes(2);
  });

  it('copes with a row that has no picture paths', async () => {
    const d = deps([row(2, { snippet_path: null, page_path: null })]);
    const out = await prefetchNext('paperA', { deps: d });
    expect(out).toHaveLength(1);
    expect(out[0].snippetUrl).toBeNull();
    expect(d.signMany).not.toHaveBeenCalled();
    expect(d.preload).not.toHaveBeenCalled();
  });

  it('keeps at most MAX_WARM entries, oldest out first', async () => {
    expect(MAX_WARM).toBe(6);
    await prefetchNext('paperA', { deps: deps([row(1), row(2), row(3)]) });
    await prefetchNext('paperA', { deps: deps([row(4), row(5), row(6)]) });
    await prefetchNext('paperA', { deps: deps([row(7), row(8)]) });
    expect(warmCount()).toBe(MAX_WARM);
    expect(getWarm('q1', 1_000_001)).toBeNull();
    expect(getWarm('q2', 1_000_001)).toBeNull();
    expect(getWarm('q3', 1_000_001)).not.toBeNull();
    expect(getWarm('q8', 1_000_001)).not.toBeNull();
  });

  it('clears the map when the paper changes', async () => {
    await prefetchNext('paperA', { deps: deps([row(2), row(3)]) });
    expect(warmCount()).toBe(2);
    await prefetchNext('paperB', { deps: deps([row(9)]) });
    expect(warmCount()).toBe(1);
    expect(getWarm('q2', 1_000_001)).toBeNull();
    expect(getWarm('q9', 1_000_001)?.paperId).toBe('paperB');
  });

  it('drops an in-flight result that finishes after a clear', async () => {
    let release: (rows: PeekedQuestion[]) => void = () => {};
    const slow = {
      ...deps([]),
      peek: vi.fn(() => new Promise<PeekedQuestion[]>((r) => (release = r))),
    };
    const pending = prefetchNext('paperA', { deps: slow });
    clearPrefetch();
    release([row(2)]);
    expect(await pending).toEqual([]);
    expect(warmCount()).toBe(0);
  });

  it('forgets entries whose signed URLs are about to expire', async () => {
    await prefetchNext('paperA', { deps: deps([row(2)], 1_000_000) });
    expect(getWarm('q2', 1_000_000 + WARM_TTL_MS - 1)).not.toBeNull();
    expect(getWarm('q2', 1_000_000 + WARM_TTL_MS)).toBeNull();
    expect(warmCount()).toBe(0);
  });

  it('dropWarm removes one question', async () => {
    await prefetchNext('paperA', { deps: deps([row(2), row(3)]) });
    dropWarm('q2');
    expect(getWarm('q2', 1_000_001)).toBeNull();
    expect(getWarm('q3', 1_000_001)).not.toBeNull();
  });

  it('never rejects: a failing peek or sign step just warms nothing', async () => {
    const bad = { ...deps([row(2)]), peek: vi.fn(async () => { throw new Error('boom'); }) };
    await expect(prefetchNext('paperA', { deps: bad })).resolves.toEqual([]);
    const bad2 = { ...deps([row(2)]), signMany: vi.fn(async () => { throw new Error('boom'); }) };
    await expect(prefetchNext('paperA', { deps: bad2 })).resolves.toEqual([]);
    expect(warmCount()).toBe(0);
  });

  it('stores only paths and URLs, never question text', async () => {
    const d = deps([{ ...row(2), body: 'secret words' } as PeekedQuestion]);
    const out = await prefetchNext('paperA', { deps: d });
    expect(JSON.stringify(out)).not.toContain('secret words');
  });
});
