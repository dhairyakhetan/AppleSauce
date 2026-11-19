import { describe, expect, it } from 'vitest';
import { formatSeconds } from './format-seconds';

describe('formatSeconds', () => {
  it('shows seconds under a minute', () => {
    expect(formatSeconds(37)).toBe('37s');
    expect(formatSeconds(37.4)).toBe('37s');
  });

  it('shows minutes and seconds', () => {
    expect(formatSeconds(80)).toBe('1m 20s');
    expect(formatSeconds(120)).toBe('2m');
  });

  it('says not yet when nothing was recorded', () => {
    expect(formatSeconds(null)).toBe('not yet');
    expect(formatSeconds(Number.NaN)).toBe('not yet');
  });
});
