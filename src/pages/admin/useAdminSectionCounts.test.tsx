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

/* The nav RPC (applications, reviews) and the HOD desk RPC (the three HOD
   numbers) answer separately, so each test sets both. */
const NAV_OK = { applications: 4, reviews: 2, ready: 99, admin_queue: 99 };
const DESK_OK = { ready: 6, needs_you_questions: 41, student_uploads_pending: 3 };
function setRpc(nav: { data: unknown; error: unknown } | 'throw', desk: { data: unknown; error: unknown } | 'throw') {
  rpc.mockImplementation((fn: string) => {
    const answer = fn === 'hod_desk_counts' ? desk : nav;
    if (answer === 'throw') return Promise.reject(new Error('network down'));
    return Promise.resolve(answer);
  });
}

describe('fetchAdminCounts', () => {
  it('reads applications and reviews from the nav call, and the HOD three from hod_desk_counts', async () => {
    setRpc({ data: NAV_OK, error: null }, { data: DESK_OK, error: null });
    const r = await fetchAdminCounts();
    expect(r.counts).toEqual({ approvals: 4, reviews: 2, paperApprovals: 6, adminQueue: 41, submissions: 3 });
    expect(r.failed).toEqual([]);
  });

  it('takes the HOD numbers from the HOD desk call, never from the nav call, so the chip matches the tabs', async () => {
    setRpc({ data: { applications: 0, reviews: 0, ready: 1000, admin_queue: 1000 }, error: null }, { data: DESK_OK, error: null });
    const r = await fetchAdminCounts();
    expect(r.counts.paperApprovals).toBe(6);
    expect(r.counts.adminQueue).toBe(41);
    expect(rpc).toHaveBeenCalledWith('hod_desk_counts', {});
  });

  it('leaves the HOD numbers undefined and failed when the desk call fails, never 0', async () => {
    setRpc({ data: NAV_OK, error: null }, { data: null, error: { code: '42501', message: 'not an HOD' } });
    const r = await fetchAdminCounts();
    expect(r.counts.paperApprovals).toBeUndefined();
    expect(r.counts.adminQueue).toBeUndefined();
    expect(r.counts.submissions).toBeUndefined();
    expect(r.failed.sort()).toEqual(['adminQueue', 'paperApprovals', 'submissions']);
    expect(r.counts.approvals).toBe(4);
  });

  it('keeps a real zero as a zero, not as failed', async () => {
    setRpc({ data: NAV_OK, error: null }, { data: { ready: 0, needs_you_questions: 0, student_uploads_pending: 0 }, error: null });
    const r = await fetchAdminCounts();
    expect(r.counts).toMatchObject({ paperApprovals: 0, adminQueue: 0, submissions: 0 });
    expect(r.failed).toEqual([]);
  });

  it('falls back to the plain head-counts when the nav call errors, and reports the two it cannot cover', async () => {
    setRpc({ data: null, error: { code: '500', message: 'network' } }, { data: DESK_OK, error: null });
    tables.teacher_applications = ok(5);
    tables.teacher_comments = ok(2);
    tables.teacher_recommendations = ok(1);
    const r = await fetchAdminCounts();
    expect(r.counts).toEqual({ approvals: 5, reviews: 3, paperApprovals: 6, adminQueue: 41, submissions: 3 });
    expect(r.failed).toEqual([]);
  });

  it('reports the nav fields as failed when both the nav call and its fallback fail', async () => {
    setRpc({ data: null, error: { code: '500', message: 'network' } }, { data: DESK_OK, error: null });
    tables.teacher_applications = bad;
    tables.teacher_comments = bad;
    tables.teacher_recommendations = bad;
    const r = await fetchAdminCounts();
    expect(r.failed.sort()).toEqual(['approvals', 'reviews']);
    expect(deriveCountsState(r, false, () => {}).status).toBe('partial');
  });

  it('does not report half of the reviews as the whole', async () => {
    setRpc({ data: null, error: { code: '500', message: 'network' } }, { data: DESK_OK, error: null });
    tables.teacher_applications = ok(5);
    tables.teacher_comments = bad;
    tables.teacher_recommendations = ok(1);
    const r = await fetchAdminCounts();
    expect(r.counts.reviews).toBeUndefined();
    expect(r.failed).toContain('reviews');
  });

  it('a thrown desk call leaves its three numbers failed and does not stop the rest', async () => {
    setRpc({ data: NAV_OK, error: null }, 'throw');
    const r = await fetchAdminCounts();
    expect(r.counts).toMatchObject({ approvals: 4, reviews: 2 });
    expect(r.failed.sort()).toEqual(['adminQueue', 'paperApprovals', 'submissions']);
  });

  it('remembers a missing function so it is not retried on every page', async () => {
    setRpc({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }, { data: DESK_OK, error: null });
    await fetchAdminCounts();
    await fetchAdminCounts();
    const navCalls = rpc.mock.calls.filter((c) => c[0] === 'admin_nav_counts');
    expect(navCalls).toHaveLength(1);
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
