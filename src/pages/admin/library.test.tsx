import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const rpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a), from: vi.fn(), auth: { getSession: vi.fn(), onAuthStateChange: vi.fn(), signOut: vi.fn() } },
}));
vi.mock('@/lib/admin-debug', () => ({
  useAdminDebugToggle: () => ({ on: false, canToggle: false, toggle: () => {} }),
  useAdminDebugOn: () => false,
}));

import { adminLibraryExtras, isMissingFunctionError } from '@/lib/checker-api';
import { LibraryExtrasNotice, extrasState, libraryCountsUnknown, libraryListState } from '@/pages/admin/library';
import { createFakeLibraryApi } from '@/dummy/library-fake-api';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('adminLibraryExtras: a missing function is not a failure', () => {
  beforeEach(() => rpc.mockReset());

  it('returns null when the function is not on the server (PGRST202)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    await expect(adminLibraryExtras()).resolves.toBeNull();
  });

  it('returns null when Postgres says it does not exist (42883)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42883', message: 'function does not exist' } });
    await expect(adminLibraryExtras()).resolves.toBeNull();
  });

  it('throws for a network error, so the page does not blame a missing database change', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' } });
    await expect(adminLibraryExtras()).rejects.toMatchObject({ message: 'TypeError: Failed to fetch' });
  });

  it('throws for a refusal (42501)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });
    await expect(adminLibraryExtras()).rejects.toBeTruthy();
  });

  it('reads the rows when it works', async () => {
    rpc.mockResolvedValue({
      data: [{ paper_id: 'a1', hidden_reason: null, hidden_at: null, hidden_by: null, with_students: 2, with_admin: 1, ready: true }],
      error: null,
    });
    const rows = await adminLibraryExtras();
    expect(rows).toHaveLength(1);
    expect(rows?.[0]).toMatchObject({ paper_id: 'a1', with_students: 2, with_admin: 1, ready: true });
  });

  it('knows which codes mean "missing"', () => {
    expect(isMissingFunctionError({ code: 'PGRST202' })).toBe(true);
    expect(isMissingFunctionError({ code: '42883' })).toBe(true);
    expect(isMissingFunctionError({ code: '42501' })).toBe(false);
    expect(isMissingFunctionError({ code: '' })).toBe(false);
    expect(isMissingFunctionError(null)).toBe(false);
  });
});

describe('the Library extras notice', () => {
  it('maps the query to a state', () => {
    expect(extrasState({ isLoading: true, isError: false, data: undefined })).toBe('loading');
    expect(extrasState({ isLoading: false, isError: true, data: undefined })).toBe('failed');
    expect(extrasState({ isLoading: false, isError: false, data: null })).toBe('missing');
    expect(extrasState({ isLoading: false, isError: false, data: [] })).toBe('ok');
  });

  it('a missing function gets the not-available-yet note, without saying "database update"', () => {
    const t = text(renderToStaticMarkup(<LibraryExtrasNotice state="missing" onRetry={() => {}} />));
    expect(t).toContain('not available on this server yet');
    expect(t.toLowerCase()).not.toContain('database update');
    expect(t).not.toContain('Try again');
  });

  it('a failed read says the counts did not load and offers Try again, with no migration note', () => {
    const html = renderToStaticMarkup(<LibraryExtrasNotice state="failed" onRetry={() => {}} />);
    const t = text(html);
    expect(html).toContain('role="alert"');
    expect(t).toContain('Could not load these counts.');
    expect(t).toContain('Try again');
    expect(t).not.toContain('not available on this server');
  });

  it('shows nothing while loading or when the counts are there', () => {
    expect(renderToStaticMarkup(<LibraryExtrasNotice state="loading" onRetry={() => {}} />)).toBe('');
    expect(renderToStaticMarkup(<LibraryExtrasNotice state="ok" onRetry={() => {}} />)).toBe('');
  });
});

describe('the Library list never turns a failed read into "no papers"', () => {
  it('error wins over empty', () => {
    expect(libraryListState({ loading: false, error: true, shown: 0, view: 'needs_review' })).toBe('error');
    expect(libraryListState({ loading: false, error: true, shown: 0, view: 'all' })).toBe('error');
  });

  it('loading, rows and the two honest empties are distinct', () => {
    expect(libraryListState({ loading: true, error: false, shown: 0, view: 'all' })).toBe('loading');
    expect(libraryListState({ loading: false, error: false, shown: 3, view: 'live' })).toBe('rows');
    expect(libraryListState({ loading: false, error: false, shown: 0, view: 'hidden' })).toBe('empty-view');
    expect(libraryListState({ loading: false, error: false, shown: 0, view: 'all' })).toBe('empty-library');
  });
});

describe('the Library chips never show a false 0 for a failed read', () => {
  it('a failed read hides the counts, loading with nothing hides them, a loaded list shows them', () => {
    expect(libraryCountsUnknown({ loading: false, error: true, rows: 0 })).toBe(true);
    expect(libraryCountsUnknown({ loading: true, error: false, rows: 0 })).toBe(true);
    expect(libraryCountsUnknown({ loading: false, error: false, rows: 0 })).toBe(false);
    expect(libraryCountsUnknown({ loading: false, error: false, rows: 12 })).toBe(false);
  });
});

describe('the Library hide dialog starts every paper with an empty reason', () => {
  it('the Hide button, Cancel and dismiss all go through the helpers that clear it', () => {
    const src = readFileSync('src/pages/admin/library.tsx', 'utf8');
    expect(src).toContain('onClick: () => openHide(p)');
    expect(src).not.toMatch(/onClick: \(\) => setHideTarget/);
    expect(src).toContain('onClick={closeHide}');
    expect(src).toMatch(/function openHide[\s\S]*?setHideReason\(''\)/);
    expect(src).toMatch(/function closeHide[\s\S]*?setHideReason\(''\)/);
  });
});

describe('the Library fake api (dummy mode)', () => {
  it('lists, hides and restores, and its history is per paper', async () => {
    const api = createFakeLibraryApi();
    const before = await api.papers();
    expect(before.length).toBeGreaterThan(3);
    await api.hide('a10001', 'Duplicate upload');
    expect((await api.papers()).find((p) => p.paper_id === 'a10001')?.is_published).toBe(false);
    const hist = await api.history('a10001');
    expect(hist[0]).toMatchObject({ action: 'admin_hide', reason: 'Duplicate upload' });
    await api.restore('a10001');
    expect((await api.papers()).find((p) => p.paper_id === 'a10001')?.is_published).toBe(true);
    expect((await api.history('a20001')).every((r) => r.row_id === 'a20001')).toBe(true);
  });
});
