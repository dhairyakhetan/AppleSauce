import { describe, expect, it } from 'vitest';

import { imageAtWidth, validateImageSrc } from './imageSanitizer';

/**
 * `imageAtWidth` rewrites URLs, which is exactly the kind of helper that
 * quietly stops rewriting -- or starts rewriting the wrong thing -- without
 * anyone noticing, because a slightly-too-large image looks identical to a
 * correctly sized one.
 *
 * The security property is the one that must not slip: sanitisation runs
 * FIRST, so a hostile URL cannot reach the rewriter by looking like a
 * Cloudinary path.
 */

const CLOUDINARY =
  'https://res.cloudinary.com/ddvybu1v6/image/upload/v1767864098/shikshaqmine/hero/teacher.jpg';

describe('imageAtWidth', () => {
  it('asks Cloudinary for the width being painted', () => {
    expect(imageAtWidth(CLOUDINARY, 400)).toBe(
      'https://res.cloudinary.com/ddvybu1v6/image/upload/w_400,q_auto,f_auto/v1767864098/shikshaqmine/hero/teacher.jpg',
    );
  });

  it('rounds and clamps to a sane range', () => {
    expect(imageAtWidth(CLOUDINARY, 199.6)).toContain('w_200,');
    expect(imageAtWidth(CLOUDINARY, 2)).toContain('w_16,');
    expect(imageAtWidth(CLOUDINARY, 99999)).toContain('w_2000,');
  });

  it('leaves a URL that already carries a transform alone', () => {
    /* A stored size is a decision someone made. Stacking a second transform
       changes the result in ways the caller did not ask for. */
    const sized = CLOUDINARY.replace('/image/upload/', '/image/upload/w_800,c_fill/');
    expect(imageAtWidth(sized, 200)).toBe(sized);
  });

  it('passes Supabase storage through untouched', () => {
    /* Supabase's /render/image/ endpoint answers 403 on this project -- it is
       plan-gated. Rewriting these would produce URLs that fail. */
    const supa =
      'https://uvtifolnsneitetzohtn.supabase.co/storage/v1/object/public/hero-images/a.jpg';
    expect(imageAtWidth(supa, 400)).toBe(supa);
  });

  it('passes any other host through untouched', () => {
    const other = 'https://framerusercontent.com/images/abc.png';
    expect(imageAtWidth(other, 400)).toBe(other);
  });

  it('does not rewrite a lookalike path on another host', () => {
    /* `/image/upload/` is a common enough path that matching on it alone
       would rewrite URLs that would then 404. The host check is the guard. */
    const lookalike = 'https://evil.example.com/image/upload/v1/x.jpg';
    expect(imageAtWidth(lookalike, 400)).toBe(validateImageSrc(lookalike));
  });

  describe('sanitisation still runs first', () => {
    it.each([
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
    ])('refuses %s rather than rewriting it', (hostile) => {
      expect(imageAtWidth(hostile, 400)).toBe('');
    });

    it('refuses a hostile URL dressed as a Cloudinary path', () => {
      expect(imageAtWidth('javascript:/image/upload/x.jpg', 400)).toBe('');
    });

    it('returns empty for nothing at all', () => {
      expect(imageAtWidth(null, 400)).toBe('');
      expect(imageAtWidth(undefined, 400)).toBe('');
      expect(imageAtWidth('', 400)).toBe('');
    });
  });
});

/**
 * validateImageSrc's three non-http(s) branches (blob:, data:image, and a
 * same-origin relative asset path) all now reconstruct their return value
 * via `new URL(...).href` rather than `String()`, the same taint-breaking
 * pattern the http/https branch already used -- a bare String() call still
 * left CodeQL flagging every one of the five call sites as client-side XSS.
 * These pin the byte-for-byte output so that reconstruction never quietly
 * changes what actually gets rendered.
 */
describe('validateImageSrc', () => {
  it('passes a blob URL through unchanged', () => {
    const blob = 'blob:https://www.shikshaq.in/3fa85f64-5717-4562-b3fc-2c963f66afa6';
    expect(validateImageSrc(blob)).toBe(blob);
  });

  it('rejects a malformed blob URL', () => {
    expect(validateImageSrc('blob:not-a-real-blob-url')).toBe('');
  });

  it('passes a valid image data URI through unchanged', () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEA';
    expect(validateImageSrc(dataUri)).toBe(dataUri);
  });

  it('rejects a data URI that is not an allowed image type', () => {
    expect(validateImageSrc('data:text/html,<script>alert(1)</script>')).toBe('');
  });

  it('resolves a same-origin relative asset path to an absolute URL', () => {
    // Same resource either way -- validateImageSrc reconstructs it as
    // absolute now, which is the point (see the comment in imageSanitizer.ts).
    // This test suite runs under Node, not jsdom, so `window` is undefined
    // and the function falls back to its fixed base -- exercising the same
    // branch a real page load would if the origin check is ever unavailable.
    expect(validateImageSrc('/assets/logo.png')).toBe('https://www.shikshaq.in/assets/logo.png');
    expect(validateImageSrc('assets/logo.png')).toBe('https://www.shikshaq.in/assets/logo.png');
  });

  it('rejects a protocol-relative URL', () => {
    expect(validateImageSrc('//evil.example.com/x.png')).toBe('');
  });
});
