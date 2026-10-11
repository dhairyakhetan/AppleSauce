import { describe, expect, it } from 'vitest';
import { chapterNameNoDashes } from './chapter-name';

describe('chapterNameNoDashes', () => {
  it('first dash becomes a colon, later dashes become commas', () => {
    expect(chapterNameNoDashes('Medieval India – Mughals – Akbar')).toBe('Medieval India: Mughals, Akbar');
    expect(chapterNameNoDashes('A — B — C — D')).toBe('A: B, C, D');
  });
  it('handles a single dash', () => {
    expect(chapterNameNoDashes('Elections – Election Commission')).toBe('Elections: Election Commission');
  });
  it('leaves names without dashes unchanged, hyphens included', () => {
    expect(chapterNameNoDashes('Quadratic Equations')).toBe('Quadratic Equations');
    expect(chapterNameNoDashes('Prose - Short Stories')).toBe('Prose - Short Stories');
  });
});
