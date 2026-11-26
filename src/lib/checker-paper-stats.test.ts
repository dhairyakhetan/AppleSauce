import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: vi.fn(), auth: { getSession: vi.fn() } } }));

import { checkerMyPaperStats } from '@/lib/checker-api';
import { createFakeCheckerApi } from '@/dummy/checker-fake-api';

/* Owner, 25 Nov 2026: show the number of papers a checker has finished next to the questions count. */

const migration = readFileSync(new URL('../../supabase/migrations/20261125100000_checker_papers_verified.sql', import.meta.url), 'utf8');

describe('checkerMyPaperStats', () => {
  beforeEach(() => rpc.mockReset());

  it('reads the two numbers from the database function', async () => {
    rpc.mockResolvedValue({ data: [{ papers_today: 2, papers_total: 11 }], error: null });
    expect(await checkerMyPaperStats()).toEqual({ papers_today: 2, papers_total: 11 });
    expect(rpc).toHaveBeenCalledWith('checker_my_paper_stats');
  });

  it('is null, never a made-up 0, when the function is not pasted yet or the call fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    expect(await checkerMyPaperStats()).toBeNull();
  });

  it('is null for an empty answer', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await checkerMyPaperStats()).toBeNull();
  });
});

describe('the preview stand-in', () => {
  it('answers with whole numbers', async () => {
    const api = createFakeCheckerApi();
    const s = await api.myPaperStats();
    expect(Number.isInteger(s?.papers_today)).toBe(true);
    expect(Number.isInteger(s?.papers_total)).toBe(true);
  });
});

describe('checker_my_paper_stats migration', () => {
  it('only a checker may call it, and it is closed to signed-out visitors by name', () => {
    expect(migration).toContain("public.is_paper_checker()");
    expect(migration).toContain("errcode = '42501'");
    expect(migration).toMatch(/revoke all on function public\.checker_my_paper_stats\(\) from public, anon, authenticated;/);
    expect(migration).toMatch(/grant execute on function public\.checker_my_paper_stats\(\) to authenticated;/);
  });

  it('is read-only and runs as owner with a pinned search path', () => {
    expect(migration).toMatch(/security definer/);
    expect(migration).toMatch(/set search_path = public, pg_temp/);
    expect(migration).not.toMatch(/\b(insert into|update public|delete from)\b/i);
  });

  it('counts a paper only when nothing is left for students, and ignores undone verdicts', () => {
    expect(migration).toContain('not public.verifier_has_work(m.paper_id)');
    expect(migration).toContain('audit_review_log_counted');
  });
});
