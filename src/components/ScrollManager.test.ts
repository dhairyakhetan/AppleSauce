import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __MAX_ENTRIES,
  __RESTORE_TIMEOUT_MS,
  __STORAGE_KEY,
  __readScroll,
  __readStore,
  __restoreTo,
  __saveScroll,
} from './ScrollManager';

/**
 * The pure storage and timing decisions behind ScrollManager, pinned
 * independently of mounting a real router: whether a position round-trips,
 * whether the store stays bounded, and whether restoreTo waits for the page
 * to actually be tall enough before it lands.
 */

function fakeSessionStorage() {
  const store: Record<string, string> = {};
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    raw: store,
  };
}

describe('saveScroll / readScroll', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).window = { sessionStorage: fakeSessionStorage() };
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
  });

  it('round-trips a saved position', () => {
    __saveScroll('a', 400);
    expect(__readScroll('a')).toBe(400);
  });

  it('treats an unsaved key as no previous position', () => {
    expect(__readScroll('missing')).toBeUndefined();
  });

  it('treats a saved zero as no previous position (nothing to restore)', () => {
    __saveScroll('a', 0);
    expect(__readScroll('a')).toBeUndefined();
  });

  it('bounds the store to the most recent entries', () => {
    for (let i = 0; i < __MAX_ENTRIES + 10; i++) __saveScroll(`k${i}`, i + 1);
    const store = __readStore();
    expect(Object.keys(store).length).toBe(__MAX_ENTRIES);
    // The oldest keys were evicted, the newest kept.
    expect(store['k0']).toBeUndefined();
    expect(store[`k${__MAX_ENTRIES + 9}`]).toBe(__MAX_ENTRIES + 10);
  });

  it('fails closed when storage throws, rather than crashing navigation', () => {
    (globalThis as Record<string, unknown>).window = {
      sessionStorage: {
        getItem() {
          throw new Error('blocked');
        },
        setItem() {
          throw new Error('blocked');
        },
      },
    };
    expect(() => __saveScroll('a', 100)).not.toThrow();
    expect(__readScroll('a')).toBeUndefined();
  });

  it('treats a corrupted stored value as an empty store', () => {
    const storage = fakeSessionStorage();
    storage.raw[__STORAGE_KEY] = 'not-json';
    (globalThis as Record<string, unknown>).window = { sessionStorage: storage };
    expect(__readStore()).toEqual({});
  });
});

describe('restoreTo', () => {
  /* No jsdom in this project (vitest runs the 'node' environment -- see the
     ErrorBoundary tests' own hand-rolled `window` for the same reason), so
     `document` and `window` are plain stand-ins with just the three members
     restoreTo actually reads: documentElement.scrollHeight, innerHeight and
     scrollTo. */
  let scrollHeight: number;
  let scrollTo: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    scrollTo = vi.fn();
    (globalThis as Record<string, unknown>).document = {
      get documentElement() {
        return { scrollHeight };
      },
    };
    (globalThis as Record<string, unknown>).window = {
      innerHeight: 800,
      scrollY: 0,
      scrollTo,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).document;
    delete (globalThis as Record<string, unknown>).window;
  });

  it('scrolls smoothly once the page is tall enough AND its height has settled', () => {
    scrollHeight = 3000; // plenty tall for a target of 1200
    __restoreTo(1200);
    expect(scrollTo).not.toHaveBeenCalled(); // one poll to prove the height is stable
    vi.advanceTimersByTime(110);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 1200, left: 0, behavior: 'smooth' });
  });

  it('does not start on a skeleton that is still being replaced', () => {
    /* The measured failure: a 7,100px skeleton was tall enough, the smooth
       scroll started, the real list swapped in and cancelled it. */
    scrollHeight = 7100;
    __restoreTo(1500);
    scrollHeight = 10700; // real content arrives before the next poll
    vi.advanceTimersByTime(110);
    expect(scrollTo).not.toHaveBeenCalled();
    vi.advanceTimersByTime(110); // now unchanged for a poll
    expect(scrollTo).toHaveBeenCalledWith({ top: 1500, left: 0, behavior: 'smooth' });
  });

  it('lands directly if the smooth scroll was cancelled', () => {
    scrollHeight = 3000;
    __restoreTo(1200);
    vi.advanceTimersByTime(110); // smooth scroll issued; window.scrollY stays 0
    vi.advanceTimersByTime(800);
    expect(scrollTo).toHaveBeenLastCalledWith(0, 1200);
  });

  it('leaves the reader alone once they scroll themselves', () => {
    scrollHeight = 400;
    const handle = __restoreTo(1200);
    handle.cancelled = true; // what the wheel/touch/key listener does
    vi.advanceTimersByTime(__RESTORE_TIMEOUT_MS + 100);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('gives up and jumps anyway once the timeout is reached', () => {
    scrollHeight = 400; // never grows tall enough
    __restoreTo(1200);
    vi.advanceTimersByTime(__RESTORE_TIMEOUT_MS + 100);
    expect(scrollTo).toHaveBeenCalledWith(0, 1200);
  });

  it('stops polling once cancelled', () => {
    scrollHeight = 400;
    const handle = __restoreTo(1200);
    handle.cancelled = true;
    vi.advanceTimersByTime(__RESTORE_TIMEOUT_MS + 100);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
