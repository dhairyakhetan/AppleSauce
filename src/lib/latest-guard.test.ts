import { describe, expect, it } from 'vitest';
import { createLatestGuard } from '@/lib/latest-guard';

describe('createLatestGuard', () => {
  it('only the newest request is current', () => {
    const g = createLatestGuard();
    const a = g.next();
    expect(g.isCurrent(a)).toBe(true);
    const b = g.next();
    expect(g.isCurrent(a)).toBe(false);
    expect(g.isCurrent(b)).toBe(true);
  });

  it('a late answer to an old request is dropped', async () => {
    const g = createLatestGuard();
    let shown = '';
    const run = async (label: string, ms: number) => {
      const t = g.next();
      await new Promise((r) => setTimeout(r, ms));
      if (g.isCurrent(t)) shown = label;
    };
    await Promise.all([run('A (slow)', 20), run('B (fast)', 1)]);
    expect(shown).toBe('B (fast)');
  });

  it('cancel retires the request in flight', () => {
    const g = createLatestGuard();
    const t = g.next();
    g.cancel();
    expect(g.isCurrent(t)).toBe(false);
  });
});
