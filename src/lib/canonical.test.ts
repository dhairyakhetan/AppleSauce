import { describe, expect, it } from 'vitest';

import { canonicalPathFor } from './canonical';

/**
 * Two components write <link rel="canonical"> and the later one wins silently.
 * That has already caused a live bug, which is why both resolve through this
 * one function -- and why it is worth pinning its behaviour rather than
 * trusting that nobody reimplements the normalisation somewhere else.
 *
 * A wrong canonical is the most expensive kind of SEO bug because it is
 * invisible: the page looks perfect and quietly tells Google to rank a
 * different URL.
 */

describe('canonicalPathFor', () => {
  it('leaves an ordinary path alone', () => {
    expect(canonicalPathFor('/about')).toBe('/about');
  });

  it('keeps the root as the root', () => {
    /* The obvious off-by-one here is stripping "/" down to "", which would
       emit a canonical of https://www.shikshaq.in with no path. */
    expect(canonicalPathFor('/')).toBe('/');
  });

  it('drops a trailing slash so /faq and /faq/ agree', () => {
    expect(canonicalPathFor('/faq/')).toBe(canonicalPathFor('/faq'));
  });

  it('drops repeated trailing slashes', () => {
    expect(canonicalPathFor('/faq///')).toBe('/faq');
  });

  it('is idempotent', () => {
    for (const path of ['/', '/faq/', '/about', '/past-papers/0c9771/']) {
      const once = canonicalPathFor(path);
      expect(canonicalPathFor(once)).toBe(once);
    }
  });

  it('resolves the commerce alias, which is two indexed URLs for one page', () => {
    expect(canonicalPathFor('/commercial-studies-tuition-teachers-in-kolkata')).toBe(
      '/commerce-tuition-teachers-in-kolkata',
    );
  });

  it('resolves the alias through a trailing slash too', () => {
    /* Normalisation has to happen before the alias lookup, or the slashed
       form misses the table and self-canonicalises -- reintroducing exactly
       the duplicate the alias exists to collapse. */
    expect(canonicalPathFor('/commercial-studies-tuition-teachers-in-kolkata/')).toBe(
      '/commerce-tuition-teachers-in-kolkata',
    );
  });

  it('leaves the alias target pointing at itself', () => {
    expect(canonicalPathFor('/commerce-tuition-teachers-in-kolkata')).toBe(
      '/commerce-tuition-teachers-in-kolkata',
    );
  });

  it('does not invent an alias for a path that has none', () => {
    expect(canonicalPathFor('/physics-tuition-teachers-in-kolkata')).toBe(
      '/physics-tuition-teachers-in-kolkata',
    );
  });

  it('never returns an empty string', () => {
    /* Found by this test on its first run: "//" stripped down to "" and the
       callers concatenate onto the origin, so the page emitted a canonical
       URL with no path. */
    for (const path of ['/', '//', '///', '/a/']) {
      expect(canonicalPathFor(path).length).toBeGreaterThan(0);
    }
  });

  it('collapses a path of only slashes to the root', () => {
    expect(canonicalPathFor('//')).toBe('/');
    expect(canonicalPathFor('///')).toBe('/');
  });
});
