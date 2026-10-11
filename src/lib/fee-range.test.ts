import { describe, expect, it } from 'vitest';
import { formatFeeRange } from './fee-range';

describe('formatFeeRange', () => {
  it.each([
    [2000, 5000, '₹2,000 to ₹5,000'],
    [2000, null, '₹2,000 onwards'],
    [null, 5000, 'Up to ₹5,000'],
    [null, null, 'Not set'],
    [0, null, 'Not set'],
    [0, 0, 'Not set'],
    [null, 0, 'Not set'],
    [0, 5000, 'Up to ₹5,000'],
    [2000, 2000, '₹2,000'],
    [undefined, undefined, 'Not set'],
    [125000, 250000, '₹1,25,000 to ₹2,50,000'],
    ['2000', '5000', '₹2,000 to ₹5,000'],
    [Number.NaN, 3000, 'Up to ₹3,000'],
  ])('(%s, %s) -> %s', (min, max, out) => {
    expect(formatFeeRange(min as number | null, max as number | null)).toBe(out);
  });

  it('never prints undefined, null or NaN', () => {
    for (const a of [null, undefined, 0, Number.NaN, 1500]) {
      for (const b of [null, undefined, 0, Number.NaN, 4000]) {
        expect(formatFeeRange(a as number | null, b as number | null)).not.toMatch(/undefined|null|NaN/);
      }
    }
  });
});
