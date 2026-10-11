import { describe, expect, it } from 'vitest';
import { paperState, pct, readPipeline, seriesMax, seriesTotal, type DailyPoint, type PipelineApi, type PipelineStats } from './pipeline-stats';

const days: DailyPoint[] = [
  { day: '2026-10-01', papers_added: 3, desk_papers: 25, questions_cleared: 0 },
  { day: '2026-10-02', papers_added: 0, desk_papers: 1, questions_cleared: 40 },
];

describe('pipeline stats helpers', () => {
  it('pct never divides by zero', () => {
    expect(pct(5, 0)).toBe(0);
    expect(pct(611, 620)).toBe(99);
    expect(pct(-3, 10)).toBe(0);
  });

  it('series max is at least 1 and totals add up', () => {
    expect(seriesMax(days, 'desk_papers')).toBe(25);
    expect(seriesMax([], 'papers_added')).toBe(1);
    expect(seriesTotal(days, 'questions_cleared')).toBe(40);
  });

  it('labels a paper the way the library shows it', () => {
    expect(paperState({ published: false, needs_review: false })).toBe('Hidden');
    expect(paperState({ published: true, needs_review: true })).toBe('Needs review');
    expect(paperState({ published: true, needs_review: false })).toBe('Verified');
  });
});

describe('readPipeline', () => {
  const stats = { generated_at: 'x' } as unknown as PipelineStats;

  it('hands back the numbers and the log when both read', async () => {
    const api: PipelineApi = { stats: async () => stats, feed: async () => [] };
    expect(await readPipeline(api, 40)).toEqual({ stats, feed: [] });
  });

  it('a failed log is null, not an empty list, and the numbers still come back', async () => {
    const api: PipelineApi = { stats: async () => stats, feed: async () => { throw new Error('refused'); } };
    expect(await readPipeline(api, 40)).toEqual({ stats, feed: null });
  });

  it('a failed stats read still fails the whole read', async () => {
    const api: PipelineApi = { stats: async () => { throw new Error('refused'); }, feed: async () => [] };
    await expect(readPipeline(api, 40)).rejects.toThrow('refused');
  });
});
