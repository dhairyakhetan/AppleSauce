import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { realPipelineApi } from './pipeline-api';

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
