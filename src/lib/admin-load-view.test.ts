import { describe, expect, it } from 'vitest';
import { loadView } from '@/lib/admin-load-view';

describe('loadView', () => {
  it('shows the skeleton until the first read settles', () => {
    expect(loadView({ settled: false, error: false, count: 0 })).toBe('skeleton');
  });

  it('never calls a failed read empty', () => {
    expect(loadView({ settled: true, error: true, count: 0 })).toBe('error');
    expect(loadView({ settled: true, error: false, count: 0 })).toBe('empty');
  });

  it('keeps the rows on screen when a later read fails or refetches', () => {
    expect(loadView({ settled: true, error: true, count: 4 })).toBe('list');
    expect(loadView({ settled: true, error: false, count: 4 })).toBe('list');
  });
});
