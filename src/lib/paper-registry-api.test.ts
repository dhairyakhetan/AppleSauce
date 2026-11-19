import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { hodPaperRegistryApi, realPaperRegistryApi } from './paper-registry-api';

const query = { state: 'live', search: ' abc ', subject: null, limit: 50, offset: 0 } as never;

describe('the paper registry APIs', () => {
  beforeEach(() => rpc.mockReset());

  it('admins read admin_paper_registry_summary and admin_paper_registry', async () => {
    rpc.mockResolvedValue({ data: { total: 1, rows: [] }, error: null });
    await realPaperRegistryApi.summary();
    await realPaperRegistryApi.list(query);
    expect(rpc.mock.calls[0][0]).toBe('admin_paper_registry_summary');
    expect(rpc.mock.calls[1][0]).toBe('admin_paper_registry');
  });

  it('HODs read hod_registry_summary and hod_registry with the same arguments', async () => {
    rpc.mockResolvedValue({ data: { total: 1, rows: [] }, error: null });
    await hodPaperRegistryApi.summary();
    await hodPaperRegistryApi.list(query);
    expect(rpc.mock.calls[0][0]).toBe('hod_registry_summary');
    expect(rpc.mock.calls[1]).toEqual([
      'hod_registry',
      { p_state: 'live', p_search: 'abc', p_subject: null, p_limit: 50, p_offset: 0 },
    ]);
  });

  it('a refusal is thrown on both, never an empty list', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Not authorized' } });
    await expect(hodPaperRegistryApi.summary()).rejects.toMatchObject({ code: '42501' });
    await expect(hodPaperRegistryApi.list(query)).rejects.toMatchObject({ code: '42501' });
    await expect(realPaperRegistryApi.list(query)).rejects.toMatchObject({ code: '42501' });
  });
});
