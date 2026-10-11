import { describe, expect, it } from 'vitest';

import { sanitizeForIlike } from './ilike-sanitize';

/**
 * The ordering here is the whole security property: backslash has to be
 * escaped BEFORE %, _ and , are, or a search string that already contains a
 * raw backslash can smuggle an unescaped wildcard past this function --
 * flagged by CodeQL as incomplete string escaping. A search for `\%` used to
 * produce `\\%` (an escaped backslash followed by a live wildcard); it must
 * produce `\\\%` (an escaped backslash followed by an escaped percent).
 */
describe('sanitizeForIlike', () => {
  it('escapes ILIKE wildcards', () => {
    expect(sanitizeForIlike('50%')).toBe('50\\%');
    expect(sanitizeForIlike('a_b')).toBe('a\\_b');
  });

  it('escapes the .or() filter separator', () => {
    expect(sanitizeForIlike('a,b')).toBe('a\\,b');
  });

  it('escapes a raw backslash before escaping the character after it', () => {
    // A naive single-pass version turns this into '\\%' (escaped backslash,
    // then a live wildcard). It must stay fully literal: '\\\%'.
    expect(sanitizeForIlike('\\%')).toBe('\\\\\\%');
  });

  it('escapes a lone backslash with nothing special after it', () => {
    expect(sanitizeForIlike('a\\b')).toBe('a\\\\b');
  });

  it('leaves ordinary text untouched', () => {
    expect(sanitizeForIlike('La Martiniere')).toBe('La Martiniere');
  });
});
