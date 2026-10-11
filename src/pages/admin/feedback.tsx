import { useCallback, useEffect, useState, lazy, Suspense, type ReactNode } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from '@/lib/auth-context';
import { recordAdminAction } from '@/lib/audit';
import { adminToast, useAdminGuard, AdminGuardErrorState } from '@/components/AdminConsole';
import { AdminHeader, AdminAuditNote, buildAdminNav } from '@/pages/admin/shell';
import { AdminPageIntroPanel } from '@/components/admin/AdminHelp';
import { AdminTable, AdminPanelHeader, type AdminTableColumn, type AdminTableRow } from '@/pages/admin/AdminTable';
import { BentoPanel, BentoStack } from '@/components/layout/PageContainer';
import { AdminEmpty, AdminError, AdminLoading } from '@/components/admin/AdminState';
import { AdminPillButton } from '@/components/admin/AdminPillButton';
import { useConfirm } from '@/components/ui/use-confirm';
import { usePageMeta } from '@/hooks/usePageMeta';
import { loadView } from '@/lib/admin-load-view';
import { FEEDBACK_PAGE, deleteFeedbackConfirmed, feedbackShownText, hasOlder, realFeedbackApi, type FeedbackApi, type FeedbackRow } from '@/lib/feedback-admin-api';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { isDummyMode } from '@/lib/dummy-mode';
import { Search, Star } from 'lucide-react';

const DummyAdminFeedback = PREVIEW_TOOLS ? lazy(() => import('@/dummy/AdminFeedbackDummy')) : null;

/* Site NPS/star-rating feedback (the `feedback` table). Deliberately kept
   separate from admin/reviews.tsx: that page's own header comment says so
   explicitly -- feedback has no teacher column and no publish/convert
   action, so it doesn't fit that page's card-queue merge of teacher-review-
   adjacent sources. Table view (audit.tsx's shape), not a queue: this is
   browsable history a moderator scans and occasionally deletes, not a
   pending-work queue to clear to zero.

   It reads the latest 500 entries, shows the true total, and offers Load
   older for the rest, so it never silently stops. A failed read is an error
   with Try again, never "No feedback submitted yet". */

const when = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true });

/** The table, or the reason there is none. Pure, so every state can be checked. */
export function FeedbackBody({
  rows,
  settled,
  error,
  searchQuery,
  onRetry,
  onClearSearch,
  onDelete,
}: {
  rows: FeedbackRow[];
  settled: boolean;
  error: boolean;
  searchQuery: string;
  onRetry: () => void;
  onClearSearch: () => void;
  onDelete: (r: FeedbackRow) => void;
}) {
  const view = loadView({ settled, error, count: rows.length });
  if (view === 'skeleton') return <AdminLoading shape="table" rows={8} label="Loading the feedback" />;
  if (view === 'error') return <AdminError what="the feedback" onRetry={onRetry} className="mx-[18px]" />;

  const query = searchQuery.trim().toLowerCase();
  const shown = query
    ? rows.filter((r) => r.comment?.toLowerCase().includes(query) || r.guest_email?.toLowerCase().includes(query))
    : rows;

  if (shown.length === 0) {
    return query ? (
      <AdminEmpty
        title={`No feedback matches "${searchQuery.trim()}"`}
        hint="Search covers the entries loaded so far."
        action={{ label: 'Clear search', onClick: onClearSearch }}
        className="mx-[18px] rounded-2xl bg-muted"
      />
    ) : (
      <AdminEmpty title="No feedback submitted yet" hint="Visitors can leave a rating and a comment from the site. It shows up here." className="mx-[18px] rounded-2xl bg-muted" />
    );
  }

  const columns: AdminTableColumn[] = [
    { key: 'when', label: 'When', width: '1fr' },
    { key: 'from', label: 'From', width: '1.4fr' },
    { key: 'rating', label: 'Rating', width: '0.8fr' },
    { key: 'comment', label: 'Comment', width: '2.6fr', wrap: true },
  ];
  const tableRows: AdminTableRow[] = shown.map((r) => ({
    id: r.id,
    cells: [
      <span key="when" className="font-normal text-warm-meta">{when(r.created_at)}</span>,
      r.is_guest ? r.guest_email || 'Guest' : 'Signed-in user',
      r.rating != null ? (
        <span key="rating" className="inline-flex items-center gap-1 font-bold text-foreground">
          {r.rating}
          <Star className="h-3.5 w-3.5 fill-current text-brand" aria-hidden />
        </span>
      ) : (
        <span key="rating" className="text-warm-secondary">No rating</span>
      ),
      r.comment || 'No comment',
    ],
    actions: [{ label: 'Delete', tone: 'destructive', onClick: () => onDelete(r) }],
  }));
  return (
    <>
      {error ? <AdminError what="the latest feedback" onRetry={onRetry} detail="The list below may be out of date." className="mx-[18px] mb-3" /> : null}
      <AdminTable columns={columns} rows={tableRows} />
    </>
  );
}

export function AdminFeedbackPage({
  api = realFeedbackApi,
  dummy = false,
  banner,
}: {
  api?: FeedbackApi;
  dummy?: boolean;
  banner?: ReactNode;
}) {
  usePageMeta('Visitor feedback | Shikshaq Admin', 'Ratings and comments visitors left about the site.');
  const { user, profile } = useAuth();
  const actorName = dummy ? 'admin@example.com' : profile?.full_name || user?.email || 'Signed-in admin';
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [total, setTotal] = useState<number | undefined>(undefined);
  const [lastPage, setLastPage] = useState(0);
  const [settled, setSettled] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { confirm, confirmDialog } = useConfirm();

  const load = useCallback(async () => {
    const [list, count] = await Promise.allSettled([api.list({ offset: 0, limit: FEEDBACK_PAGE }), api.total()]);
    if (list.status === 'fulfilled') {
      setRows(list.value);
      setLastPage(list.value.length);
      setLoadError(false);
    } else {
      if (import.meta.env.DEV) console.error('Error fetching feedback:', list.reason);
      setLoadError(true);
    }
    setTotal(count.status === 'fulfilled' ? count.value : undefined);
    setSettled(true);
  }, [api]);

  const guard = useAdminGuard(dummy ? null : user, { onGranted: () => void load(), redirectOnDenied: !dummy });
  const isAdmin = dummy ? true : guard.isAdmin;
  const checkingAdmin = dummy ? false : guard.checkingAdmin;
  const { error: adminGuardError, retry: retryAdminGuard } = guard;
  useEffect(() => {
    if (dummy) void load();
  }, [dummy, load]);

  async function loadOlder() {
    setLoadingOlder(true);
    try {
      const more = await api.list({ offset: rows.length, limit: FEEDBACK_PAGE });
      setRows((prev) => [...prev, ...more.filter((m) => !prev.some((p) => p.id === m.id))]);
      setLastPage(more.length);
    } catch {
      adminToast('Could not load older feedback. Try again.');
    } finally {
      setLoadingOlder(false);
    }
  }

  const handleDelete = async (row: FeedbackRow) => {
    const outcome = await deleteFeedbackConfirmed(
      () =>
        confirm({
          title: 'Delete this feedback?',
          description: 'It is removed for good. This cannot be undone.',
          confirmLabel: 'Delete feedback',
        }),
      api,
      row.id,
    );
    if (outcome === 'cancelled') return;
    if (outcome === 'failed') {
      adminToast('Failed to delete feedback');
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    setTotal((t) => (t === undefined ? t : Math.max(0, t - 1)));
    adminToast('Feedback deleted');
    if (user) {
      void recordAdminAction({
        actorId: user.id,
        actorName,
        action: 'delete',
        targetType: 'feedback',
        targetId: row.id,
        targetLabel: row.guest_email || (row.is_guest ? 'guest feedback' : 'feedback'),
      });
    }
  };

  const nav = buildAdminNav('feedback');

  if (adminGuardError) return <AdminGuardErrorState onRetry={retryAdminGuard} />;

  if (checkingAdmin || !settled) {
    return (
      <BentoStack className="min-h-screen bg-muted">
        <AdminHeader nav={nav} signedInEmail={dummy ? 'admin@example.com' : user?.email ?? actorName} />
        <BentoPanel fill="card" className="px-1.5 py-[18px] lg:px-1.5 lg:py-[18px]">
          <div className="px-[18px]">
            <AdminLoading shape="table" rows={8} label="Loading the feedback" />
          </div>
        </BentoPanel>
        <AdminAuditNote />
      </BentoStack>
    );
  }

  if (!isAdmin) return null;

  const older = hasOlder(rows.length, total, lastPage);
  const showMeta = !loadError || rows.length > 0;

  return (
    <BentoStack className="min-h-screen bg-muted">
      <AdminHeader nav={nav} signedInEmail={dummy ? 'admin@example.com' : user?.email ?? actorName} />
      <AdminPageIntroPanel page="feedback" />
      {banner}

      <BentoPanel fill="card" className="px-1.5 py-[18px] lg:px-1.5 lg:py-[18px]">
        <AdminPanelHeader title="Visitor feedback" meta={showMeta ? feedbackShownText(rows.length, total, older) : undefined} />

        <div className="mb-4 flex flex-wrap items-center gap-2 px-[18px]">
          <div className="relative w-full sm:w-[280px] max-w-full">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-label" aria-hidden />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by comment or email..."
              aria-label="Search feedback"
              className="h-11 w-full max-w-full rounded-full bg-muted pl-9 pr-4 text-sm text-foreground outline-none transition-shadow duration-150 placeholder:text-warm-label focus-visible:ring-2 focus-visible:ring-brand"
            />
          </div>
          {searchQuery.trim() && older ? (
            <span className="text-[13px] text-warm-secondary">Searching the {rows.length.toLocaleString('en-IN')} loaded entries. Load older to search further.</span>
          ) : null}
        </div>

        <FeedbackBody
          rows={rows}
          settled={settled}
          error={loadError}
          searchQuery={searchQuery}
          onRetry={() => void load()}
          onClearSearch={() => setSearchQuery('')}
          onDelete={(r) => void handleDelete(r)}
        />

        {older && rows.length > 0 ? (
          <div className="mt-4 px-[18px]">
            <AdminPillButton variant="secondary" busy={loadingOlder} onClick={() => void loadOlder()}>
              {loadingOlder ? 'Loading...' : 'Load older'}
            </AdminPillButton>
          </div>
        ) : null}
      </BentoPanel>

      <AdminAuditNote />
      {confirmDialog}
    </BentoStack>
  );
}

export default function AdminFeedback() {
  if (DummyAdminFeedback && isDummyMode()) {
    return (
      <Suspense fallback={null}>
        <DummyAdminFeedback />
      </Suspense>
    );
  }
  return <AdminFeedbackPage />;
}
