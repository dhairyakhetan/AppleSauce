import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __isStaleChunkError, __claimStaleChunkReload, __resetReloadGrantForTests } from './ErrorBoundary';

/**
 * The two decisions that must not be wrong.
 *
 * Reloading on a REAL crash shows the reader the same crash again, and a
 * mis-scoped match would do that on every error the app ever throws.
 * Reloading without a guard turns a permanently missing chunk into an infinite
 * refresh loop, which is worse than the blank page this component replaces.
 */

const STALE = [
  // Chrome
  'Failed to fetch dynamically imported module: https://x/assets/Contact-DGg9Rz9H.js',
  // Firefox
  'error loading dynamically imported module',
  // Safari
  'Importing a module script failed.',
  // The MIME refusal Vercel's SPA rewrite produces
  'Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html".',
];

const REAL_BUGS = [
  "Cannot read properties of undefined (reading 'map')",
  'teacher.name is not a function',
  'Maximum update depth exceeded',
  'Network request failed',
  'Minified React error #310',
  '',
];

describe('isStaleChunkError', () => {
  it.each(STALE)('recognises %j', (message) => {
    expect(__isStaleChunkError(new Error(message))).toBe(true);
  });

  it.each(REAL_BUGS)('does NOT reload for a real bug: %j', (message) => {
    /* The important direction. Reloading on a genuine fault just shows the
       reader the same crash a second time and loses the panel that would have
       told them what to do. */
    expect(__isStaleChunkError(new Error(message))).toBe(false);
  });

  it('handles a non-Error being thrown', () => {
    expect(__isStaleChunkError('some string')).toBe(false);
    expect(__isStaleChunkError(null)).toBe(false);
    expect(__isStaleChunkError(undefined)).toBe(false);
  });

  it('matches on the error name too, not only the message', () => {
    const e = new Error('boom');
    e.name = 'Failed to fetch dynamically imported module';
    expect(__isStaleChunkError(e)).toBe(true);
  });
});

describe('claimStaleChunkReload', () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    __resetReloadGrantForTests();
    (globalThis as Record<string, unknown>).window = {
      sessionStorage: {
        getItem: (k: string) => (k in store ? store[k] : null),
        setItem: (k: string, v: string) => { store[k] = v; },
      },
    };
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window;
  });

  it('allows the first reload', () => {
    expect(__claimStaleChunkReload()).toBe(true);
  });

  it('refuses a second reload on the NEXT page load, so it cannot loop', () => {
    expect(__claimStaleChunkReload()).toBe(true);
    __resetReloadGrantForTests(); // the reload: a fresh module, same sessionStorage
    expect(__claimStaleChunkReload()).toBe(false);
    expect(__claimStaleChunkReload()).toBe(false);
  });

  it('keeps saying yes within the page that was granted the reload', () => {
    /* vite:preloadError claims first, then the same failure reaches
       getDerivedStateFromError (possibly twice). A `false` there rendered
       "Something went wrong" just before the reload landed. */
    expect(__claimStaleChunkReload()).toBe(true);
    expect(__claimStaleChunkReload()).toBe(true);
    expect(__claimStaleChunkReload()).toBe(true);
  });

  it('allows another attempt once the window has passed', () => {
    store['shikshaq_chunk_reload_at'] = String(Date.now() - 61_000);
    expect(__claimStaleChunkReload()).toBe(true);
  });

  it('refuses when storage throws, so it fails closed', () => {
    /* Private mode or blocked site data. The reader gets the panel and a
       button they can press themselves, never an unguarded reload. */
    (globalThis as Record<string, unknown>).window = {
      sessionStorage: {
        getItem() { throw new Error('blocked'); },
        setItem() { throw new Error('blocked'); },
      },
    };
    expect(__claimStaleChunkReload()).toBe(false);
  });

  it('treats a corrupted stored value as no previous attempt', () => {
    store['shikshaq_chunk_reload_at'] = 'not-a-number';
    expect(__claimStaleChunkReload()).toBe(true);
  });
});
