import { lazy, Suspense, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useAdminGuard, AdminGuardErrorState } from '@/components/AdminConsole';
import { AdminHeader, AdminAuditNote, buildAdminNav } from '@/pages/admin/shell';
import { AdminPanelHeader } from '@/pages/admin/AdminTable';
import { BentoPanel, BentoStack } from '@/components/layout/PageContainer';
import { AdminPageIntro } from '@/components/admin/AdminHelp';
import { AdminError, AdminLoading } from '@/components/admin/AdminState';
import { adminPillClass } from '@/components/admin/AdminPillButton';
import { ADMIN_PAGES, type AdminPageKey } from '@/lib/admin-hints';
import { cn } from '@/lib/utils';
import { adminPrefetchProps } from '@/lib/admin-prefetch';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { isDummyMode } from '@/lib/dummy-mode';
import { useAdminCountsState, type AdminCountField, type AdminCountsState } from '@/pages/admin/useAdminSectionCounts';

const DummyAdminOverview = PREVIEW_TOOLS ? lazy(() => import('@/dummy/AdminOverviewDummy')) : null;

/* /admin: "Needs you now". The landing page. One row per queue that waits on
   an admin, biggest pile first, each a single tap into the queue it counts.

   The numbers are the shared nav counts (useAdminCountsState), so this page and
   the badges can never disagree. A count of 0 is calm ("All clear"); a count
   that could not be read is "?" and is never treated as 0, so a failed read can
   never look like an empty inbox. */

/** The queues, in the order they are offered when counts tie. */
const QUEUES: { key: AdminPageKey; field: AdminCountField }[] = [
  { key: 'ready', field: 'paperApprovals' },
  { key: 'admin-queue', field: 'adminQueue' },
  { key: 'applications', field: 'approvals' },
  { key: 'reviews', field: 'reviews' },
  { key: 'submissions', field: 'submissions' },
];

export interface OverviewRow {
  key: AdminPageKey;
  label: string;
  path: string;
  meaning: string;
  count?: number;
  /** waiting: something to do. unknown: could not be read. clear: a real zero. */
  state: 'waiting' | 'unknown' | 'clear';
}

/** The rows, sorted: waiting first (biggest pile first, queue order on a tie),
 *  then unknown, then clear. Pure. */
export function overviewRows(state: Pick<AdminCountsState, 'counts' | 'failed'>): OverviewRow[] {
  const rows: OverviewRow[] = QUEUES.map(({ key, field }) => {
    const copy = ADMIN_PAGES[key];
    const count = state.counts[field];
    const rowState: OverviewRow['state'] = typeof count !== 'number' || state.failed.includes(field) ? 'unknown' : count > 0 ? 'waiting' : 'clear';
    return { key, label: copy.label, path: copy.path, meaning: copy.short, count: typeof count === 'number' ? count : undefined, state: rowState };
  });
  const rank = { waiting: 0, unknown: 1, clear: 2 } as const;
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank[a.r.state] - rank[b.r.state] || (b.r.count ?? 0) - (a.r.count ?? 0) || a.i - b.i)
    .map((x) => x.r);
}

/** True only when every count was read and every one is 0. */
export function allClear(state: Pick<AdminCountsState, 'status'>, rows: OverviewRow[]): boolean {
  return state.status === 'ok' && rows.every((r) => r.state === 'clear');
}

function CountChip({ row }: { row: OverviewRow }) {
  if (row.state === 'waiting') {
    return (
      <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-brand px-2.5 text-[13px] font-bold tabular-nums text-foreground">
        {row.count}
        <span className="sr-only"> waiting</span>
      </span>
    );
  }
  if (row.state === 'unknown') {
    return (
      <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-card px-2.5 text-[13px] font-bold text-warm-secondary" title="Count unavailable">
        <span aria-hidden>?</span>
        <span className="sr-only">count unavailable</span>
      </span>
    );
  }
  return <span className="inline-flex h-7 items-center rounded-full bg-success-subtle-bg px-2.5 text-[12px] font-bold text-success-subtle-text">All clear</span>;
}

export function AdminOverviewPage({
  dummy = false,
  banner,
  counts: countsProp,
}: {
  dummy?: boolean;
  banner?: ReactNode;
  /** Override the shared counts (tests). Omit to read them live. */
  counts?: AdminCountsState;
}) {
  usePageMeta('Needs you now | Shikshaq Admin', 'Everything that is waiting on an admin.');
  const { user, profile } = useAuth();
  const signedIn = dummy ? 'admin@example.com' : user?.email ?? profile?.full_name ?? 'Signed-in admin';
  const guard = useAdminGuard(dummy ? null : user, { redirectOnDenied: !dummy });
  const isAdmin = dummy ? true : guard.isAdmin;
  const checkingAdmin = dummy ? false : guard.checkingAdmin;
  const live = useAdminCountsState();
  const counts = countsProp ?? live;
  const nav = buildAdminNav('now');

  if (checkingAdmin) {
    return (
      <BentoStack className="min-h-screen bg-muted">
        <AdminHeader nav={nav} signedInEmail={signedIn} counts={counts} />
        <BentoPanel fill="card" className="px-1.5 py-[18px] lg:px-1.5 lg:py-[18px]">
          <AdminLoading shape="rows" rows={5} label="Checking your access" className="px-[18px]" />
        </BentoPanel>
      </BentoStack>
    );
  }
  if (!dummy && guard.error) return <AdminGuardErrorState onRetry={guard.retry} />;
  if (!isAdmin) return null;

  const rows = overviewRows(counts);
  const top = rows[0]?.state === 'waiting' ? rows[0] : null;
  const clear = allClear(counts, rows);

  return (
    <BentoStack className="min-h-screen bg-muted">
      <AdminHeader nav={nav} signedInEmail={signedIn} counts={counts} />
      {banner}

      <BentoPanel fill="card" className="px-1.5 py-[18px] lg:px-1.5 lg:py-[18px]">
        <div className="mb-3 px-[18px]">
          <AdminPageIntro page="now" />
        </div>
        <AdminPanelHeader
          title="Needs you now"
          action={
            top ? (
              <Link to={top.path} className={adminPillClass('primary', 'md')} {...adminPrefetchProps(top.path)}>
                Start with {top.label}
              </Link>
            ) : undefined
          }
        />

        <div className="px-[18px]">
          {counts.status === 'loading' ? (
            <AdminLoading shape="rows" rows={5} label="Loading what is waiting" />
          ) : counts.status === 'error' ? (
            <AdminError what="the counts" detail="We could not read what is waiting, so nothing is shown as clear. Try again." onRetry={counts.refetch} />
          ) : (
            <>
              {counts.status === 'partial' ? (
                <AdminError what="some of the counts" detail="Rows marked ? could not be read. They are not zero." onRetry={counts.refetch} className="mb-3" />
              ) : null}
              {clear ? (
                <div role="status" className="mb-3 rounded-[18px] bg-success-subtle-bg px-4 py-3.5 text-[14px] font-semibold text-success-subtle-text">
                  All clear. Nothing is waiting on you right now.
                </div>
              ) : null}
              <ul className="space-y-2">
                {rows.map((row) => (
                  <li key={row.key}>
                    <Link
                      to={row.path}
                      {...adminPrefetchProps(row.path)}
                      className={cn(
                        'flex min-h-14 items-center gap-3 rounded-[18px] px-4 py-3 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        row.state === 'clear' ? 'bg-muted/50 hover:bg-muted' : 'bg-muted hover:bg-warm-hairline',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className={cn('block text-[15px] font-bold', row.state === 'clear' ? 'text-warm-secondary' : 'text-foreground')}>{row.label}</span>
                        <span className="line-clamp-2 block text-[13px] leading-[1.45] text-warm-secondary">{row.meaning}</span>
                      </span>
                      <CountChip row={row} />
                      <ChevronRight className="h-4 w-4 shrink-0 text-warm-label" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </BentoPanel>

      <AdminAuditNote />
    </BentoStack>
  );
}

export default function AdminOverview() {
  if (DummyAdminOverview && isDummyMode()) {
    return (
      <Suspense fallback={null}>
        <DummyAdminOverview />
      </Suspense>
    );
  }
  return <AdminOverviewPage />;
}
