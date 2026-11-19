import { describe, expect, it } from 'vitest';
import { looksLikeEmail } from './email-shape';

describe('looksLikeEmail', () => {
  it('accepts ordinary addresses', () => {
    for (const e of ['a@b.com', 'name.surname@shikshaq.in', '  spaced@out.com  ']) {
      expect(looksLikeEmail(e)).toBe(true);
    }
  });

  it('rejects obviously incomplete input', () => {
    for (const e of ['', 'not-an-email', 'missing-at.com', 'two@@at.com', 'no-domain@', '@no-local.com']) {
      expect(looksLikeEmail(e)).toBe(false);
    }
  });
});
