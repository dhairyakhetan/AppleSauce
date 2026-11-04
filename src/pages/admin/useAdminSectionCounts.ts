import { useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { isDummyMode } from '@/lib/dummy-mode';
import { useAdminConfirmedUserId } from '@/lib/admin-confirmed';
import { realHodApi } from '@/lib/hod-api';

/* Shared by every /admin/* page for its nav badges: real counts only, never a
   placeholder, head-count queries only (no row bodies).

   Load cost: one React Query entry shared by every page (60 s fresh, kept
   10 min, refetched when the tab regains focus once stale), so a tab change
   costs nothing.

   WHERE EACH NUMBER COMES FROM. The HOD desk chip and the HOD desk's own tab
   badges must never disagree, so the three HOD numbers (ready papers, the
   questions waiting for an HOD, student uploads) come from hod_desk_counts,
   the same call the HOD desk reads (src/lib/hod-tabs.ts). Teacher applications
   and reviews come from admin_nav_counts (20261003130000_admin_queue_library.sql),
   or from plain head-counts if that one call is missing or fails.

   ZERO IS QUIET, UNKNOWN IS LOUD. A count that could not be read is left
   `undefined` and named in `failed`; it is never coerced to 0. The shell shows
   a muted "?" for it and offers Retry. A real 0 shows no badge at all.

   A missing admin_nav_counts function is remembered for the session so it is
   not retried on every page. */

export interface AdminSectionCounts {
  /** Teacher applications waiting. */
  approvals?: number;
  /** Teacher comments plus recommendations waiting. */
  reviews?: number;
  /** Papers waiting in Ready to go live (hod_desk_counts: ready). */
  paperApprovals?: number;
  /** Questions waiting for an HOD (hod_desk_counts: needs_you_questions). */
  adminQueue?: number;
  /** Student uploads waiting to be read and decided (hod_desk_counts: student_uploads_pending). */
  submissions?: number;
}

export type AdminCountField = keyof AdminSectionCounts;

export const ADMIN_COUNT_FIELDS: AdminCountField[] = ['paperApprovals', 'adminQueue', 'submissions', 'approvals', 'reviews'];

/** What one read of the counts produced: the numbers it got, and the fields it did not. */
export interface AdminCountsResult {
  counts: AdminSectionCounts;
  failed: AdminCountField[];
}

export type AdminCountsStatus = 'loading' | 'ok' | 'partial' | 'error';

export interface AdminCountsState {
  counts: AdminSectionCounts;
  status: AdminCountsStatus;
  /** Fields that could not be read. Empty when status is "ok" or "loading". */
  failed: AdminCountField[];
  refetch: () => void;
}

let oneCallMissing = false;
/** Test hook: forget that the function was missing. */
export function resetAdminCountsMemory(): void {
  oneCallMissing = false;
}

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined;

/** A head-count that failed or came back without a number is `undefined`, never 0. */
function headCount(r: { count: number | null; error: unknown }): number | undefined {
  return r.error ? undefined : typeof r.count === 'number' ? r.count : undefined;
}

/** The three HOD numbers, read from hod_desk_counts: the same call the HOD desk's
 *  tab badges make, so the chip and the tabs agree by construction. A failed
 *  read leaves the three fields out (undefined, listed in `failed`), never 0. */
async function hodDeskNumbers(): Promise<Pick<AdminSectionCounts, 'paperApprovals' | 'adminQueue' | 'submissions'>> {
  try {
    const desk = await realHodApi.deskCounts();
    const out: Pick<AdminSectionCounts, 'paperApprovals' | 'adminQueue' | 'submissions'> = {};
    if (typeof desk.ready === 'number') out.paperApprovals = desk.ready;
    if (typeof desk.needs_you_questions === 'number') out.adminQueue = desk.needs_you_questions;
    if (typeof desk.student_uploads_pending === 'number') out.submissions = desk.student_uploads_pending;
    return out;
  } catch {
    return {};
  }
}

async function viaOneCall(): Promise<AdminSectionCounts | null> {
  if (oneCallMissing) return null;
  const { data, error } = await supabase.rpc('admin_nav_counts' as never);
  if (error) {
    // 42883 / PGRST202: the function is not there yet. Anything else (a
    // dropped connection) is retried next time.
    if (/42883|PGRST202|does not exist|Could not find/i.test(`${error.code ?? ''} ${error.message ?? ''}`)) oneCallMissing = true;
    return null;
  }
  const raw = data as unknown;
  const d = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | null;
  if (!d) return null;
  return {
    approvals: num(d.applications),
    reviews: num(d.reviews),
  };
}

async function viaCounts(): Promise<AdminSectionCounts> {
  const [approvals, comments, recommendations] = await Promise.all([
    supabase.from('teacher_applications').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('teacher_comments').select('id', { count: 'exact', head: true }).eq('approved', false),
    supabase.from('teacher_recommendations').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
  ]);
  const c = headCount(comments);
  const r = headCount(recommendations);
  return {
    approvals: headCount(approvals),
    // Half a number is not a number: if either source failed, reviews is unknown.
    reviews: c === undefined || r === undefined ? undefined : c + r,
  };
}

/** Reads every count once. Never throws for a failed count; a field that could
 *  not be read is left out and listed in `failed`. */
export async function fetchAdminCounts(): Promise<AdminCountsResult> {
  const [oneCall, hod] = await Promise.all([viaOneCall().catch(() => null), hodDeskNumbers()]);
  const base: AdminSectionCounts = oneCall ?? (await viaCounts().catch(() => ({} as AdminSectionCounts)));
  const counts: AdminSectionCounts = { ...base, ...hod };
  const failed = ADMIN_COUNT_FIELDS.filter((f) => counts[f] === undefined);
  return { counts, failed };
}

export const ADMIN_COUNTS_KEY = ['admin', 'section-counts'] as const;

/** The cache key for one admin's counts. The id is part of it, so one person's
 *  numbers are never shown to the next person on the same browser. Starts with
 *  ADMIN_COUNTS_KEY, so invalidating that still reaches it. */
export function adminCountsKey(userId: string) {
  return [...ADMIN_COUNTS_KEY, userId] as const;
}

/** The state of the counts: the numbers, which ones failed, and a retry.
 *  Nothing is read until the admin guard has confirmed an admin (or dummy mode
 *  is on), so a signed-out visitor never triggers the read and never sees a count. */
export function useAdminCountsState(): AdminCountsState {
  const qc = useQueryClient();
  const dummy = PREVIEW_TOOLS && isDummyMode();
  const confirmedId = useAdminConfirmedUserId();
  const who = dummy ? 'dummy' : confirmedId;
  // Signed out or no longer an admin: drop the saved numbers, not just hide them.
  useEffect(() => {
    if (!who) qc.removeQueries({ queryKey: ADMIN_COUNTS_KEY });
  }, [who, qc]);
  const q = useQuery({
    queryKey: adminCountsKey(who ?? 'nobody'),
    enabled: !!who,
    queryFn: async (): Promise<AdminCountsResult> => {
      // Dynamic, never static: the fake must not reach a live bundle.
      if (PREVIEW_TOOLS && isDummyMode()) return (await import('@/dummy/admin-counts-fake')).fakeCounts();
      return fetchAdminCounts();
    },
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    retry: false,
    // The nav is the only place these numbers live, and it is one cheap read,
    // so it is worth refreshing when the admin comes back to the tab.
    refetchOnWindowFocus: true,
  });
  const { refetch: queryRefetch } = q;
  const refetch = useCallback(() => {
    void queryRefetch();
  }, [queryRefetch]);
  return deriveCountsState(who ? q.data : undefined, who ? q.isError : false, refetch);
}

/** Pure so it can be tested: status from what the query holds. */
export function deriveCountsState(
  data: AdminCountsResult | undefined,
  isError: boolean,
  refetch: () => void,
): AdminCountsState {
  if (data) {
    const status: AdminCountsStatus = data.failed.length === 0 ? 'ok' : data.failed.length >= ADMIN_COUNT_FIELDS.length ? 'error' : 'partial';
    return { counts: data.counts, status, failed: data.failed, refetch };
  }
  if (isError) return { counts: {}, status: 'error', failed: [...ADMIN_COUNT_FIELDS], refetch };
  return { counts: {}, status: 'loading', failed: [], refetch };
}

/** The plain numbers, for pages that only need to pass them to buildAdminNav. */
export function useAdminSectionCounts(): AdminSectionCounts {
  return useAdminCountsState().counts;
}

/** Call from a queue mutation's onSuccess so the nav badges tick down at once. */
export function useRefreshAdminCounts(): () => void {
  const qc = useQueryClient();
  return useCallback(() => {
    void qc.invalidateQueries({ queryKey: ADMIN_COUNTS_KEY });
  }, [qc]);
}
