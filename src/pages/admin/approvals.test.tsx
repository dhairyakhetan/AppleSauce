import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const calls: { table?: string; op?: string; cols?: string; payload?: unknown; eq?: [string, unknown]; eqs?: [string, unknown][]; returning?: string; rpc?: [string, unknown] }[] = [];
// The rows an update(...).select() hands back; empty means no row matched.
let updatedRows: { id: string }[] = [{ id: 'app-1' }];

vi.mock('@/integrations/supabase/client', () => {
  const chain = (table: string) => {
    const entry: (typeof calls)[number] = { table };
    calls.push(entry);
    const api = {
      update(payload: unknown) {
        entry.op = 'update';
        entry.payload = payload;
        return api;
      },
      select(cols?: string) {
        entry.op = 'select';
        entry.cols = cols;
        return api;
      },
      order() {
        return Promise.resolve({ data: [], error: null });
      },
      in() {
        return Promise.resolve({ data: [], error: null });
      },
      eq(col: string, val: unknown) {
        entry.eq = entry.eq ?? [col, val];
        entry.eqs = [...(entry.eqs ?? []), [col, val]];
        const next = {
          eq: api.eq,
          select(cols?: string) {
            entry.returning = cols;
            return Promise.resolve({ data: updatedRows, error: null });
          },
          then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ error: null }).then(res, rej),
        };
        return next;
      },
    };
    return api;
  };
  return {
    supabase: {
      from: vi.fn((t: string) => chain(t)),
      rpc: vi.fn((fn: string, args: unknown) => {
        calls.push({ rpc: [fn, args] });
        return Promise.resolve({ data: null, error: null });
      }),
      auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(), signOut: vi.fn() },
    },
  };
});
vi.mock('@/lib/admin-debug', () => ({
  useAdminDebugToggle: () => ({ on: false, canToggle: false, toggle: () => {} }),
  useAdminDebugOn: () => false,
}));

import { ApplicationsBody, realApprovalsApi } from '@/pages/admin/approvals';
import {
  ALREADY_DECIDED_WORDS,
  AlreadyDecidedError,
  APPLICATION_COLUMNS,
  approveWithConfirm,
  isAlreadyDecided,
  countsByView,
  defaultOrder,
  filterApplications,
  neighbours,
  nextToOpen,
  normaliseApplicationRow,
  rejectWithReason,
  sortApplications,
  viewFromParam,
  withDecision,
  type ApprovalsApi,
  type TeacherApplication,
} from '@/lib/admin-applications';
import { createFakeApprovalsApi } from '@/dummy/admin-approvals-fake-api';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

function app(over: Partial<TeacherApplication> & Pick<TeacherApplication, 'id'>): TeacherApplication {
  return normaliseApplicationRow({
    name: `Name ${over.id}`,
    email: `${over.id}@example.com`,
    phone_number: '9000000000',
    sir_maam: 'Sir',
    status: 'pending',
    texted_status: 'not_texted',
    created_at: '2026-10-01T10:00:00.000Z',
    ...over,
  });
}

const noop = () => {};
const body = (over: Partial<Parameters<typeof ApplicationsBody>[0]>) =>
  renderToStaticMarkup(
    <ApplicationsBody load="ready" shown={[]} view="waiting" search="" onRetry={noop} onClearSearch={noop} onShowAll={noop} onOpen={noop} {...over} />,
  );

beforeEach(() => {
  calls.length = 0;
  updatedRows = [{ id: 'app-1' }];
});

describe('a failed load is an error, never an empty list', () => {
  it('renders the error with Try again and not the nothing-waiting copy', () => {
    const html = body({ load: 'error', shown: [] });
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain('The applications did not load.');
    expect(text(html)).toContain('Try again');
    expect(text(html)).not.toMatch(/No applications are waiting|No applications yet|0 listed|nothing waiting/i);
  });

  it('shows the empty copy only for a read that succeeded', () => {
    const html = body({ load: 'ready', shown: [] });
    expect(text(html)).toContain('No applications are waiting.');
    expect(html).not.toContain('role="alert"');
  });

  it('shows a skeleton while the first load runs', () => {
    const html = body({ load: 'loading' });
    expect(html).toContain('aria-busy="true"');
    expect(text(html)).not.toMatch(/No applications|did not load/);
  });

  it('has its own empty copy per view and for a search', () => {
    expect(text(body({ view: 'approved' }))).toContain('No approved applications yet.');
    expect(text(body({ view: 'rejected' }))).toContain('No rejected applications.');
    expect(text(body({ view: 'all' }))).toContain('No applications yet.');
    const searched = text(body({ search: 'zed' }));
    expect(searched).toContain('No applications match "zed".');
    expect(searched).toContain('Clear search');
  });
});

describe('rows', () => {
  const rows = [
    app({ id: 'a', status: 'pending', texted_status: 'follow_up', hero_image_url: 'https://example.com/x.jpg' }),
    app({ id: 'b', status: 'approved', reference_name: 'Ref' }),
    app({ id: 'c', status: 'rejected' }),
  ];

  it('says Review for waiting and Open for resolved ones', () => {
    const t = text(body({ view: 'all', shown: rows }));
    expect((t.match(/\bReview\b/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(t).toContain('Open');
  });

  it('uses plain wording for what was sent and for status', () => {
    const t = text(body({ view: 'all', shown: rows }));
    expect(t).toContain('Photo and references');
    expect(t).toContain('References only');
    expect(t).toContain('No photo or references');
    expect(t).toContain('Waiting');
    expect(t).toContain('Approved');
    expect(t).toContain('Rejected');
    expect(t).not.toMatch(/Photo \+ refs|Refs only|\bNone\b/);
  });

  it('drops the Not Texted label from every row and shows only a set outreach state', () => {
    const t = text(body({ view: 'all', shown: rows }));
    expect(t).not.toMatch(/Not texted/i);
    expect(t).toContain('Follow up');
  });
});

describe('views and order', () => {
  const apps = [
    app({ id: 'new', created_at: '2026-10-05T00:00:00.000Z' }),
    app({ id: 'old', created_at: '2026-09-01T00:00:00.000Z' }),
    app({ id: 'mid', created_at: '2026-09-20T00:00:00.000Z' }),
    app({ id: 'done', status: 'approved', created_at: '2026-08-01T00:00:00.000Z' }),
    app({ id: 'no', status: 'rejected', created_at: '2026-08-02T00:00:00.000Z' }),
  ];

  it('defaults to Waiting and falls back to it for anything unknown', () => {
    expect(viewFromParam(null)).toBe('waiting');
    expect(viewFromParam('nonsense')).toBe('waiting');
    expect(viewFromParam('approved')).toBe('approved');
  });

  it('sorts the Waiting view oldest first and the others newest first', () => {
    expect(defaultOrder('waiting')).toBe('oldest');
    expect(defaultOrder('all')).toBe('newest');
    const waiting = sortApplications(filterApplications(apps, 'waiting', ''), defaultOrder('waiting'));
    expect(waiting.map((a) => a.id)).toEqual(['old', 'mid', 'new']);
    const all = sortApplications(filterApplications(apps, 'all', ''), defaultOrder('all'));
    expect(all[0].id).toBe('new');
  });

  it('counts each view on its own', () => {
    expect(countsByView(apps)).toEqual({ waiting: 3, approved: 1, rejected: 1, all: 5 });
  });

  it('searches name, email, phone and reference', () => {
    const list = [app({ id: 'x', name: 'Zed Zebra', reference_name: 'Quill' }), app({ id: 'y', phone_number: '9876543210' })];
    expect(filterApplications(list, 'all', 'zebra').map((a) => a.id)).toEqual(['x']);
    expect(filterApplications(list, 'all', 'quill').map((a) => a.id)).toEqual(['x']);
    expect(filterApplications(list, 'all', '98765').map((a) => a.id)).toEqual(['y']);
    expect(filterApplications(list, 'all', 'y@example').map((a) => a.id)).toEqual(['y']);
  });
});

describe('next in the queue', () => {
  const shown = [app({ id: '1' }), app({ id: '2' }), app({ id: '3' }), app({ id: '4', status: 'approved' })];

  it('opens the next waiting application after the one just decided', () => {
    expect(nextToOpen(shown, '1')).toBe('2');
    expect(nextToOpen(shown, '2')).toBe('3');
  });

  it('goes back to the nearest earlier waiting one at the end, and closes when none is left', () => {
    expect(nextToOpen(shown, '3')).toBe('2');
    expect(nextToOpen([app({ id: 'only' })], 'only')).toBeNull();
    expect(nextToOpen([app({ id: 'p' }), app({ id: 'q', status: 'approved' })], 'p')).toBeNull();
  });

  it('gives Previous and Next neighbours and the position', () => {
    expect(neighbours(shown, '1')).toEqual({ prev: null, next: '2', index: 0 });
    expect(neighbours(shown, '4')).toEqual({ prev: '3', next: null, index: 3 });
    expect(neighbours(shown, 'missing').index).toBe(-1);
  });
});

describe('decisions keep calling the same api with the same arguments', () => {
  const target = app({ id: 'app-1', name: 'Asha' });

  function spyApi() {
    return { approve: vi.fn().mockResolvedValue(undefined), reject: vi.fn().mockResolvedValue(undefined) } satisfies Pick<ApprovalsApi, 'approve' | 'reject'>;
  }

  it('asks first, then approves with (id, adminId)', async () => {
    const api = spyApi();
    const order: string[] = [];
    const confirm = vi.fn(async (o: { title: string; description?: string; confirmLabel?: string }) => {
      order.push('confirm');
      expect(o.title).toBe('Approve Asha?');
      expect(o.description).toBe('They will be listed on the site straight away and can be found by parents.');
      expect(o.confirmLabel).toBe('Approve and list');
      return true;
    });
    api.approve.mockImplementation(async () => {
      order.push('approve');
    });
    const res = await approveWithConfirm({ app: target, adminId: 'admin-9', api, confirm });
    expect(res).toBe('approved');
    expect(order).toEqual(['confirm', 'approve']);
    expect(api.approve).toHaveBeenCalledTimes(1);
    expect(api.approve).toHaveBeenCalledWith('app-1', 'admin-9');
  });

  it('does not approve when the admin says no', async () => {
    const api = spyApi();
    const res = await approveWithConfirm({ app: target, adminId: 'admin-9', api, confirm: async () => false });
    expect(res).toBe('cancelled');
    expect(api.approve).not.toHaveBeenCalled();
  });

  it('will not reject without a reason, and rejects with (id, adminId, reason) when given one', async () => {
    const api = spyApi();
    expect(await rejectWithReason({ app: target, adminId: 'admin-9', reason: '   ', api })).toBe('needs_reason');
    expect(api.reject).not.toHaveBeenCalled();
    expect(await rejectWithReason({ app: target, adminId: 'admin-9', reason: '  Could not reach the reference  ', api })).toBe('rejected');
    expect(api.reject).toHaveBeenCalledWith('app-1', 'admin-9', 'Could not reach the reference');
  });

  it('patches the row as the list should show it before the quiet refetch', () => {
    const now = new Date('2026-10-08T12:00:00.000Z');
    const approved = withDecision(target, 'approved', 'admin-9', null, now);
    expect(approved).toMatchObject({ status: 'approved', reviewed_by: 'admin-9', reviewed_at: now.toISOString() });
    const rejected = withDecision(target, 'rejected', 'admin-9', 'Because', now);
    expect(rejected.rejection_reason).toBe('Because');
  });
});

describe('the real api writes exactly what the page always wrote', () => {
  it('the list names its columns, one by one, and never asks for *', async () => {
    await realApprovalsApi.list();
    const c = calls.find((x) => x.op === 'select');
    expect(c?.table).toBe('teacher_applications');
    expect(c?.cols).not.toContain('*');
    expect(c?.cols?.split(',')).toEqual([...APPLICATION_COLUMNS]);
    expect(new Set(APPLICATION_COLUMNS).size).toBe(APPLICATION_COLUMNS.length);
    // every field of the row type the page reads is in the list
    for (const k of ['id', 'name', 'status', 'texted_status', 'min_fees', 'max_fees', 'created_at', 'hero_image_url', 'whatsapp_link']) {
      expect(APPLICATION_COLUMNS).toContain(k);
    }
  });

  it('approve is the approve_teacher_application RPC', async () => {
    await realApprovalsApi.approve('app-1', 'admin-9');
    expect(calls).toContainEqual({ rpc: ['approve_teacher_application', { application_id: 'app-1', admin_id: 'admin-9' }] });
  });

  it('reject updates status, reviewer, time and reason on that one row', async () => {
    await realApprovalsApi.reject('app-1', 'admin-9', 'Not a fit');
    const c = calls.find((x) => x.op === 'update');
    expect(c?.table).toBe('teacher_applications');
    expect(c?.eq).toEqual(['id', 'app-1']);
    expect(c?.payload).toMatchObject({ status: 'rejected', reviewed_by: 'admin-9', rejection_reason: 'Not a fit' });
    expect(Object.keys(c?.payload as object).sort()).toEqual(['rejection_reason', 'reviewed_at', 'reviewed_by', 'status', 'updated_at']);
  });

  it('reject only touches a waiting application and says so when someone else got there first', async () => {
    await realApprovalsApi.reject('app-1', 'admin-9', 'Not a fit');
    const c = calls.find((x) => x.op === 'update');
    expect(c?.eqs).toEqual([
      ['id', 'app-1'],
      ['status', 'pending'],
    ]);
    updatedRows = [];
    await expect(realApprovalsApi.reject('app-1', 'admin-9', 'Not a fit')).rejects.toBeInstanceOf(AlreadyDecidedError);
  });

  it('recognises an already-decided failure from either side', () => {
    expect(isAlreadyDecided(new AlreadyDecidedError())).toBe(true);
    expect(isAlreadyDecided({ message: 'Application not found or already processed' })).toBe(true);
    expect(isAlreadyDecided(new Error('network down'))).toBe(false);
    expect(ALREADY_DECIDED_WORDS).not.toMatch(/[–—]/);
  });

  it('the outreach note is an explicit update of texted_status only, by id', async () => {
    await realApprovalsApi.setTexted('app-1', 'follow_up');
    const c = calls.find((x) => x.op === 'update');
    expect(c?.table).toBe('teacher_applications');
    expect(c?.payload).toEqual({ texted_status: 'follow_up' });
    expect(c?.eq).toEqual(['id', 'app-1']);
  });
});

describe('the fake used in dummy mode behaves like the rules', () => {
  it('lists, approves, refuses a reason-less rejection, and keeps the outreach note', async () => {
    const api = createFakeApprovalsApi();
    const first = await api.list();
    expect(first.some((a) => a.status === 'pending')).toBe(true);
    const pending = first.find((a) => a.status === 'pending')!;
    await api.setTexted(pending.id, 'texted');
    await expect(api.reject(pending.id, 'a', '')).rejects.toThrow();
    await api.approve(pending.id, 'admin');
    const after = (await api.list()).find((a) => a.id === pending.id)!;
    expect(after.status).toBe('approved');
    expect(after.texted_status).toBe('texted');
  });

  it('has no dash characters in its made-up text', async () => {
    const all = JSON.stringify(await createFakeApprovalsApi().list());
    expect(all).not.toMatch(/[–—]/);
  });
});
