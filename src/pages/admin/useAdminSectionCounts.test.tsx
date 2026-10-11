import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/* The nav counts: zero is quiet, unknown is loud. A count that cannot be read
   is left undefined and named in `failed`; it is never turned into 0. */

type HeadResult = { count: number | null; error: unknown };
const rpc = vi.fn();
const tables: Record<string, HeadResult> = {};
const fromCalls: { table: string; status?: string; approved?: boolean }[] = [];

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: (table: string) => ({
      select: () => ({
        eq: (col: string, val: unknown) => {
          fromCalls.push({ table, ...(col === 'status' ? { status: val as string } : { approved: val as boolean }) });
          return Promise.resolve(tables[table] ?? { count: 0, error: null });
        },
      }),
    }),
  },
}));

import { getAdminConfirmed, setAdminConfirmed } from '@/lib/admin-confirmed';
import {
  ADMIN_COUNTS_KEY,
  ADMIN_COUNT_FIELDS,
  adminCountsKey,
  useAdminCountsState,
  deriveCountsState,
  fetchAdminCounts,
  resetAdminCountsMemory,
  useRefreshAdminCounts,
} from '@/pages/admin/useAdminSectionCounts';

const ok = (count: number): HeadResult => ({ count, error: null });
const bad: HeadResult = { count: null, error: { message: 'boom' } };

beforeEach(() => {
  rpc.mockReset();
  fromCalls.length = 0;
  for (const k of Object.keys(tables)) delete tables[k];
  resetAdminCountsMemory();
});

describe('fetchAdminCounts', () => {
  it('reads the four server counts plus the pending student uploads', async () => {
    rpc.mockResolvedValue({ data: { applications: 4, reviews: 2, ready: 6, admin_queue: 41 }, error: null });
    tables.paper_submissions = ok(3);
    const r = await fetchAdminCounts();
    expect(r.counts).toEqual({ approvals: 4, reviews: 2, paperApprovals: 6, adminQueue: 41, submissions: 3 });
    expect(r.failed).toEqual([]);
  });

  it('counts student uploads from the inbox table, pending only', async () => {
    rpc.mockResolvedValue({ data: { applications: 0, reviews: 0, ready: 0, admin_queue: 0 }, error: null });
    tables.paper_submissions = ok(7);
    await fetchAdminCounts();
    expect(fromCalls).toContainEqual({ table: 'paper_submissions', status: 'pending' });
  });

  it('leaves a rejected head-count undefined and failed, never 0', async () => {
    rpc.mockResolvedValue({ data: { applications: 1, reviews: 1, ready: 1, admin_queue: 1 }, error: null });
    tables.paper_submissions = bad;
    const r = await fetchAdminCounts();
    expect(r.counts.submissions).toBeUndefined();
    expect(r.failed).toEqual(['submissions']);
    expect(r.counts.approvals).toBe(1);
  });

  it('keeps a real zero as a zero, not as failed', async () => {
    rpc.mockResolvedValue({ data: { applications: 0, reviews: 0, ready: 0, admin_queue: 0 }, error: null });
    tables.paper_submissions = ok(0);
    const r = await fetchAdminCounts();
    expect(r.counts.submissions).toBe(0);
    expect(r.failed).toEqual([]);
  });

  it('falls back to the plain head-counts when the one call errors, and reports the two it cannot cover', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '500', message: 'network' } });
    tables.teacher_applications = ok(5);
    tables.teacher_comments = ok(2);
    tables.teacher_recommendations = ok(1);
    tables.paper_submissions = ok(3);
    const r = await fetchAdminCounts();
    expect(r.counts).toEqual({ approvals: 5, reviews: 3, submissions: 3 });
    expect(r.failed.sort()).toEqual(['adminQueue', 'paperApprovals']);
    expect(deriveCountsState(r, false, () => {}).status).toBe('partial');
  });

  it('does not report half of the reviews as the whole', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '500', message: 'network' } });
    tables.teacher_applications = ok(5);
    tables.teacher_comments = bad;
    tables.teacher_recommendations = ok(1);
    tables.paper_submissions = ok(0);
    const r = await fetchAdminCounts();
    expect(r.counts.reviews).toBeUndefined();
    expect(r.failed).toContain('reviews');
  });

  it('remembers a missing function so it is not retried on every page', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    await fetchAdminCounts();
    await fetchAdminCounts();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe('deriveCountsState', () => {
  const noop = () => {};
  it('is loading until something arrives', () => {
    expect(deriveCountsState(undefined, false, noop)).toMatchObject({ status: 'loading', failed: [], counts: {} });
  });
  it('is ok when nothing failed, partial when some did, error when all did', () => {
    expect(deriveCountsState({ counts: { approvals: 0 }, failed: [] }, false, noop).status).toBe('ok');
    expect(deriveCountsState({ counts: {}, failed: ['reviews'] }, false, noop).status).toBe('partial');
    expect(deriveCountsState({ counts: {}, failed: [...ADMIN_COUNT_FIELDS] }, false, noop).status).toBe('error');
  });
  it('is error with every field failed when the query itself threw', () => {
    const s = deriveCountsState(undefined, true, noop);
    expect(s.status).toBe('error');
    expect(s.failed).toEqual(ADMIN_COUNT_FIELDS);
  });
  it('hands back the refetch it was given', () => {
    const refetch = vi.fn();
    deriveCountsState(undefined, true, refetch).refetch();
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('useRefreshAdminCounts', () => {
  it('invalidates the shared counts key', () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    let refresh: () => void = () => {};
    function Probe() {
      refresh = useRefreshAdminCounts();
      return null;
    }
    renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <Probe />
      </QueryClientProvider>,
    );
    refresh();
    expect(spy).toHaveBeenCalledWith({ queryKey: ADMIN_COUNTS_KEY });
  });
});

describe('the counts wait for a confirmed admin and are kept per person', () => {
  it('the cache key starts with the shared key, so refreshing it still reaches every admin entry', () => {
    const key = adminCountsKey('admin-1');
    expect([...key].slice(0, ADMIN_COUNTS_KEY.length)).toEqual([...ADMIN_COUNTS_KEY]);
    expect(adminCountsKey('admin-1')).not.toEqual(adminCountsKey('admin-2'));
    const qc = new QueryClient();
    qc.setQueryData(adminCountsKey('admin-1'), { counts: {}, failed: [] });
    qc.removeQueries({ queryKey: ADMIN_COUNTS_KEY });
    expect(qc.getQueryData(adminCountsKey('admin-1'))).toBeUndefined();
  });

  it('shows nothing until the guard confirms an admin, and the confirmation clears', () => {
    const qc = new QueryClient();
    let state: ReturnType<typeof useAdminCountsState> | undefined;
    function Probe() {
      state = useAdminCountsState();
      return null;
    }
    const render = () =>
      renderToStaticMarkup(
        <QueryClientProvider client={qc}>
          <Probe />
        </QueryClientProvider>,
      );
    setAdminConfirmed(null);
    qc.setQueryData(adminCountsKey('admin-1'), { counts: { approvals: 4 }, failed: [] });
    render();
    expect(state?.status).toBe('loading');
    expect(state?.counts).toEqual({});
    setAdminConfirmed('admin-1');
    expect(getAdminConfirmed()).toBe('admin-1');
    setAdminConfirmed(null);
    expect(getAdminConfirmed()).toBeNull();
  });
});
