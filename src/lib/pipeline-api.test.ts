import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { hodPipelineStatsApi, realPipelineApi } from './pipeline-api';

describe('realPipelineApi.feed', () => {
  beforeEach(() => rpc.mockReset());

  it('returns the rows it was given', async () => {
    rpc.mockResolvedValue({ data: [{ event_id: '1' }], error: null });
    expect(await realPipelineApi.feed(40)).toEqual([{ event_id: '1' }]);
  });

  it('a successful read with no rows is an empty list', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await realPipelineApi.feed(40)).toEqual([]);
  });

  it('a refused or failed read is thrown, never turned into an empty log', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Not authorized' } });
    await expect(realPipelineApi.feed(40)).rejects.toMatchObject({ code: '42501' });
  });
});

describe('hodPipelineStatsApi.stats', () => {
  beforeEach(() => rpc.mockReset());

  it('calls hod_pipeline_stats and returns what it was given', async () => {
    rpc.mockResolvedValue({ data: { library: { papers: 3 } }, error: null });
    expect(await hodPipelineStatsApi.stats()).toEqual({ library: { papers: 3 } });
    expect(rpc).toHaveBeenCalledWith('hod_pipeline_stats');
  });

  it('a refusal is thrown, never turned into empty numbers', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Not authorized' } });
    await expect(hodPipelineStatsApi.stats()).rejects.toMatchObject({ code: '42501' });
  });

  it('has no way to read the activity feed', () => {
    expect(Object.keys(hodPipelineStatsApi)).toEqual(['stats']);
  });
});
