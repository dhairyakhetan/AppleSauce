import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useBusyActions } from '@/lib/busy-guard';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { useAdminGuard, AdminGuardErrorState, adminToast } from '@/components/AdminConsole';
import { AdminHeader, AdminAuditNote, buildAdminNav } from '@/pages/admin/shell';
import { AdminTable, AdminPanelHeader, AdminStatusPill, type AdminTableColumn, type AdminTableRow } from '@/pages/admin/AdminTable';
import { BentoPanel, BentoStack } from '@/components/layout/PageContainer';
import { AdminDialog } from '@/components/admin/AdminDialog';
import { AdminEmpty, AdminError, AdminLoading } from '@/components/admin/AdminState';
import { AdminFilterChips, type AdminFilterChip } from '@/components/admin/AdminFilterChips';
import { AdminPillButton } from '@/components/admin/AdminPillButton';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { usePageMeta } from '@/hooks/usePageMeta';
import { usePaperReviewChannel, useLiveRefresh } from '@/hooks/usePaperReviewChannel';
import { formatOnlineNames } from '@/lib/paper-review-realtime';
import { useAdminSectionCounts } from '@/pages/admin/useAdminSectionCounts';
import { AdminPageIntro, InfoTip } from '@/components/admin/AdminHelp';
import { HIDE_REASON_NOTE, TIPS } from '@/lib/admin-hints';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { isDummyMode } from '@/lib/dummy-mode';
import { UNDOABLE_ACTIONS, historyLine, paperLabel, undoEffect } from '@/lib/paper-history-labels';

const DummyLibrary = PREVIEW_TOOLS ? lazy(() => import('@/dummy/AdminLibraryDummy')) : null;
import {
  adminPaperQueue,
  adminLibraryExtras,
  adminHideBankPaper,
  adminRestoreBankPaper,
  adminPaperHistory,
  adminUndoRevision,
  type PaperQueueRow,
  type RevisionRow,
} from '@/lib/checker-api';
import { PAGE_SIZE, leftToCheck, sortForReview } from '@/lib/paper-review-filter';
import {
  LIBRARY_VIEWS,
  hiddenWhy,
  viewCounts,
  viewRows,
  withExtras,
  type LibraryExtra,
  type LibraryRow,
  type LibraryView,
} from '@/lib/library-views';

/* /admin/library: every paper in the question bank (bank_papers), live or
   hidden. It used to be "Paper review" and also held the checkers list and
   the escalations; those now live where their names say (Checkers, Admin
   queue), so each job has one home. Edit any paper or question, hide with a
   reason, restore, and read each paper's history with undo.

   admin/papers.tsx (Student uploads) is the separate, older surface for the
   `papers` table. */

/** The pieces of the Library the page needs, as one object so the dummy mode
 *  can run the real page against made-up papers. */
export interface LibraryApi {
  papers(): Promise<PaperQueueRow[]>;
  extras(): Promise<LibraryExtra[] | null>;
  hide(paperId: string, reason: string): Promise<void>;
  restore(paperId: string): Promise<void>;
  history(paperId: string): Promise<RevisionRow[]>;
  undo(revisionId: number): Promise<void>;
}

export const realLibraryApi: LibraryApi = {
  papers: adminPaperQueue,
  extras: adminLibraryExtras,
  hide: adminHideBankPaper,
  restore: adminRestoreBankPaper,
  history: adminPaperHistory,
  undo: (id) => adminUndoRevision(id),
};

export type ExtrasState = 'loading' | 'ok' | 'missing' | 'failed';

/** What the Library knows about its optional extra counts. The function being
 *  absent from the server is a different thing from a read that failed, and
 *  the page must not blame a missing database change for a dropped
 *  connection. */
export function extrasState(q: { isLoading: boolean; isError: boolean; data: unknown }): ExtrasState {
  if (q.isLoading) return 'loading';
  if (q.isError) return 'failed';
  return q.data == null ? 'missing' : 'ok';
}

export type LibraryListState = 'loading' | 'error' | 'empty-view' | 'empty-library' | 'rows';

/** Which body the paper list shows. A failed read is `error`, never one of the
 *  empty states: "No papers" is only for a read that succeeded and found
 *  nothing. Pure, so it is tested without a login. */
export function libraryListState(q: { loading: boolean; error: boolean; shown: number; view: LibraryView }): LibraryListState {
  if (q.loading) return 'loading';
  if (q.error) return 'error';
  if (q.shown > 0) return 'rows';
  return q.view === 'all' ? 'empty-library' : 'empty-view';
}

/** True when the chip counts cannot be trusted: the read is still loading with
 *  nothing yet, or it failed (then every count would read a false 0, and the
 *  list below already shows the error). */
export function libraryCountsUnknown(q: { loading: boolean; error: boolean; rows: number }): boolean {
  return q.error || (q.loading && q.rows === 0);
}

export function LibraryExtrasNotice({ state, onRetry }: { state: ExtrasState; onRetry: () => void }) {
  if (state === 'missing') {
    return (
      <p className="mb-3 px-[18px] text-[13px] text-warm-secondary" role="status">
        With students, With an admin, Ready to go live and why a paper was hidden are not available on this server yet. They show a question mark until they are.
      </p>
    );
  }
  if (state === 'failed') {
    return (
      <div role="alert" className="mx-[18px] mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-destructive/10 px-3 py-2">
        <p className="text-[13px] font-semibold text-destructive">Could not load these counts.</p>
        <AdminPillButton variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </AdminPillButton>
      </div>
    );
  }
  return null;
}

export function AdminLibraryPage({
  api = realLibraryApi,
  dummy = false,
  banner,
}: {
  api?: LibraryApi;
  dummy?: boolean;
  banner?: ReactNode;
}) {
  usePageMeta('Library | Shikshaq Admin', 'Every past paper: find one, fix it, hide it or bring it back.');
  const { user, profile } = useAuth();
  const actorName = dummy ? 'admin@example.com' : profile?.full_name || user?.email || 'an admin';
  const guard = useAdminGuard(dummy ? null : user, { redirectOnDenied: !dummy });
  const isAdmin = dummy ? true : guard.isAdmin;
  const checkingAdmin = dummy ? false : guard.checkingAdmin;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const sectionCounts = useAdminSectionCounts();

  const [view, setView] = useState<LibraryView>('needs_review');

  // The two reads run side by side and are cached: coming back to the Library
  // from another tab shows the list at once and refreshes it quietly. The
  // extras are optional, so a failure there never blocks the list.
  const papersQ = useQuery({
    queryKey: ['admin', 'library', 'papers', dummy],
    queryFn: () => api.papers(),
    enabled: isAdmin,
    staleTime: 60_000,
  });
  const extrasQ = useQuery({
    queryKey: ['admin', 'library', 'extras', dummy],
    queryFn: () => api.extras(),
    enabled: isAdmin,
    staleTime: 60_000,
  });
  const papersLoading = papersQ.isLoading;
  const extrasKnown = extrasQ.data != null;
  const extras = extrasState(extrasQ);
  const rows: LibraryRow[] = useMemo(() => withExtras(papersQ.data ?? [], extrasQ.data ?? null), [papersQ.data, extrasQ.data]);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'library'] });
  };

  const [historyTarget, setHistoryTarget] = useState<LibraryRow | null>(null);
  const [history, setHistory] = useState<RevisionRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  // The revision whose Undo is waiting for a second, confirming press.
  const [undoConfirm, setUndoConfirm] = useState<number | null>(null);

  const [hideTarget, setHideTarget] = useState<LibraryRow | null>(null);
  const [hideReason, setHideReason] = useState('');
  // One write per row at a time: undo, hide, restore.
  const { run: runBusy, busy } = useBusyActions();

  // Realtime: when anyone checks, fixes or edits, refetch a few seconds
  // later, quietly, and show who is online. Does nothing if it cannot connect.
  const refreshLive = useLiveRefresh(refresh);
  const { status: liveStatus, online } = usePaperReviewChannel({
    enabled: !!isAdmin && !dummy,
    userId: user?.id,
    fullName: profile?.full_name,
    onActivity: refreshLive,
  });
  const othersOnline = online.filter((p) => p.userId !== user?.id);

  const counts = useMemo(() => viewCounts(rows), [rows]);
  const filtered = useMemo(() => sortForReview(viewRows(rows, view)) as LibraryRow[], [rows, view]);

  const [shown, setShown] = useState(PAGE_SIZE);
  useEffect(() => setShown(PAGE_SIZE), [view]);
  const visible = filtered.slice(0, shown);

  async function openHistory(p: LibraryRow, keepConfirm = false) {
    setHistoryTarget(p);
    setHistoryLoading(true);
    setHistoryError(false);
    if (!keepConfirm) setUndoConfirm(null);
    try {
      setHistory(await api.history(p.paper_id));
    } catch {
      setHistory([]);
      setHistoryError(true);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function doUndo(revisionId: number) {
    await runBusy(`undo:${revisionId}`, async () => {
      try {
        await api.undo(revisionId);
        adminToast('Reverted');
        setUndoConfirm(null);
        if (historyTarget) void openHistory(historyTarget);
        refresh();
      } catch (e) {
        const msg = (e as { message?: string } | null)?.message;
        adminToast('Could not undo that revision', msg ? { description: msg } : undefined);
      }
    });
  }

  // The reason belongs to one paper. Opening or closing the dialog starts it
  // empty, so a reason typed for one paper is never waiting on the next.
  function openHide(p: LibraryRow) {
    setHideReason('');
    setHideTarget(p);
  }
  function closeHide() {
    setHideTarget(null);
    setHideReason('');
  }

  async function confirmHide() {
    if (!hideTarget) return;
    const reason = hideReason.trim();
    if (!reason) {
      adminToast('A reason is required to hide a paper');
      return;
    }
    const paperId = hideTarget.paper_id;
    await runBusy(`paper:${paperId}`, async () => {
      try {
        await api.hide(paperId, reason);
        adminToast('Paper hidden');
        closeHide();
        refresh();
      } catch {
        adminToast('Failed to hide the paper');
      }
    });
  }

  async function doRestore(p: LibraryRow) {
    await runBusy(`paper:${p.paper_id}`, async () => {
      try {
        await api.restore(p.paper_id);
        adminToast('Paper restored');
        refresh();
      } catch {
        adminToast('Failed to restore the paper');
      }
    });
  }

  const nav = buildAdminNav('library', sectionCounts);
  const signedIn = user?.email ?? actorName;

  if (checkingAdmin) {
    return (
      <BentoStack className="min-h-screen bg-muted">
        <AdminHeader nav={nav} signedInEmail={signedIn} />
        <BentoPanel fill="card" className="px-1.5 py-[18px] lg:px-1.5 lg:py-[18px]">
          <AdminLoading shape="table" rows={4} label="Checking your access" className="px-[18px]" />
        </BentoPanel>
      </BentoStack>
    );
  }

  if (!dummy && guard.error) return <AdminGuardErrorState onRetry={guard.retry} />;
  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted px-4">
        <div className="max-w-[380px] rounded-bento bg-card p-8 text-center">
          <h1 className="mb-2 text-xl font-bold text-foreground">Access denied</h1>
          <p className="text-sm text-warm-secondary">You need to be an admin to access this page.</p>
        </div>
      </div>
    );
  }

  const showWhy = view === 'hidden' || view === 'all';
  const columns: AdminTableColumn[] = [
    { key: 'school', label: 'School', width: '1.6fr', hint: TIPS['col.school'], wrap: true },
    { key: 'subject', label: 'Subject', width: '1fr', hint: TIPS['col.subject'], wrap: true },
    { key: 'cls', label: 'Class', width: '0.6fr', hint: TIPS['col.class'] },
    { key: 'year', label: 'Year', width: '0.6fr', hint: TIPS['col.year'] },
    { key: 'progress', label: 'Progress', width: '0.9fr', hint: TIPS['col.progress'] },
    { key: 'left', label: 'To check', width: '0.7fr', hint: TIPS['col.to_check'] },
    { key: 'status', label: 'Status', width: '0.9fr', hint: TIPS['col.status'] },
    ...(showWhy ? [{ key: 'why', label: 'Why hidden', width: '1.8fr', hint: TIPS['col.why_hidden'], wrap: true }] : []),
  ];

  const tableRows: AdminTableRow[] = visible.map((p) => ({
    id: p.paper_id,
    cells: [
      p.school,
      p.subject,
      p.cls,
      p.year,
      p.total_questions > 0 ? `${p.passed_questions}/${p.total_questions}` : '-',
      p.total_questions > 0 ? String(leftToCheck(p)) : '-',
      <AdminStatusPill
        key="status"
        status={!p.is_published ? 'hidden' : p.needs_review ? 'pending' : 'live'}
        label={!p.is_published ? 'Hidden' : p.needs_review ? 'Needs review' : 'Live'}
      />,
      ...(showWhy ? [<span key="why" className="whitespace-normal">{hiddenWhy(p, extrasKnown) || '-'}</span>] : []),
    ],
    actions: [
      { label: 'History', tone: 'primary', onClick: () => void openHistory(p) },
      { label: 'Edit', tone: 'primary', onClick: () => navigate(`/admin/library/${encodeURIComponent(p.paper_id)}`) },
      p.is_published
        ? { label: busy(`paper:${p.paper_id}`) ? '...' : 'Hide', tone: 'destructive', onClick: () => openHide(p), disabled: busy(`paper:${p.paper_id}`) }
        : { label: busy(`paper:${p.paper_id}`) ? '...' : 'Restore', tone: 'mint', onClick: () => void doRestore(p), disabled: busy(`paper:${p.paper_id}`) },
    ],
  }));

  // One set of counts: the chips. (Stat tiles and a header sentence used to
  // repeat the same numbers.) A count that cannot be known yet shows "?".
  const chips: AdminFilterChip[] = LIBRARY_VIEWS.map((v) => ({
    key: v.key,
    label: v.label,
    hint: TIPS[v.tip],
    count: libraryCountsUnknown({ loading: papersLoading, error: papersQ.isError, rows: rows.length }) ? undefined : v.needsExtras && !extrasKnown ? undefined : counts[v.key],
  }));
  const listState = libraryListState({ loading: papersLoading, error: papersQ.isError, shown: filtered.length, view });
  const viewTip = LIBRARY_VIEWS.find((v) => v.key === view)?.tip;

  return (
    <BentoStack className="min-h-screen bg-muted">
      <AdminHeader nav={nav} signedInEmail={signedIn} />
      {banner}

      <BentoPanel fill="card" className="px-1.5 py-[18px] lg:px-1.5 lg:py-[18px]">
        <div className="mb-3 px-[18px]">
          <AdminPageIntro page="library" />
        </div>
        <AdminPanelHeader title="Library" />

        {liveStatus === 'live' ? (
          <p className="mb-4 flex items-center gap-2 px-[18px] text-[13px] text-warm-secondary" aria-live="polite">
            <span className="h-2 w-2 shrink-0 rounded-full bg-mint" aria-hidden />
            {othersOnline.length > 0 ? (
              <span><span className="font-semibold text-foreground">Online now:</span> {formatOnlineNames(othersOnline)}</span>
            ) : (
              <span>No one else is checking right now. This page updates as people work.</span>
            )}
          </p>
        ) : null}

        {/* Eight chips would wrap to four rows on a phone and push the list below the
            fold, so under sm they sit on one line that scrolls sideways. */}
        <div className="mb-2 overflow-x-auto px-[18px] sm:overflow-visible [&>div]:flex-nowrap [&_[role=group]]:flex-nowrap sm:[&>div]:flex-wrap sm:[&_[role=group]]:flex-wrap">
          <AdminFilterChips chips={chips} value={view} onChange={(k) => setView(k as LibraryView)} defaultValue="all" onClear={() => setView('all')} label="Show papers" />
        </div>
        <p className="mb-3 flex items-start gap-1.5 px-[18px] text-[13px] text-warm-meta">
          <InfoTip tip={viewTip} label="this view" className="mt-0.5" />
          <span>{TIPS[viewTip ?? 'view.all']}</span>
        </p>
        <LibraryExtrasNotice state={extras} onRetry={() => void extrasQ.refetch()} />
        {!papersLoading && !papersQ.isError && filtered.length > 0 ? (
          <p className="mb-3 px-[18px] text-[13px] text-warm-meta" aria-live="polite">
            Showing {Math.min(shown, filtered.length)} of {filtered.length}
          </p>
        ) : null}
        {listState === 'loading' ? (
          <AdminLoading shape="table" rows={5} label="Loading the papers" className="px-[18px]" />
        ) : listState === 'error' ? (
          <div className="px-[18px]">
            <AdminError what="the papers" onRetry={() => void papersQ.refetch()} />
          </div>
        ) : listState === 'empty-library' ? (
          <AdminEmpty title="The library has no papers yet." hint="Papers appear here once they are imported." />
        ) : listState === 'empty-view' ? (
          <AdminEmpty
            title="No papers in this view."
            hint="Another view may have some."
            action={{ label: 'Show all papers', onClick: () => setView('all') }}
          />
        ) : (
          <>
            <AdminTable columns={columns} rows={tableRows} />
            {filtered.length > shown ? (
              <div className="mt-4 flex justify-center px-[18px]">
                <AdminPillButton variant="secondary" onClick={() => setShown((n) => n + PAGE_SIZE)}>
                  Show {Math.min(PAGE_SIZE, filtered.length - shown)} more
                </AdminPillButton>
              </div>
            ) : null}
          </>
        )}
      </BentoPanel>

      <AdminAuditNote />

      {/* Hide dialog: names the paper, and a reason is required and stays on it. */}
      <AdminDialog
        open={!!hideTarget}
        onOpenChange={(open) => {
          if (!open) closeHide();
        }}
        title={hideTarget ? `Hide ${paperLabel(hideTarget)}?` : 'Hide this paper?'}
        description="Readers stop seeing it straight away. Restore brings it back."
        size="sm"
        footer={
          <>
            <AdminPillButton variant="secondary" onClick={closeHide}>
              Cancel
            </AdminPillButton>
            <AdminPillButton
              variant="destructive"
              onClick={() => void confirmHide()}
              disabled={!hideReason.trim()}
              busy={!!hideTarget && busy(`paper:${hideTarget.paper_id}`)}
            >
              Hide paper
            </AdminPillButton>
          </>
        }
      >
        <Label htmlFor="hide-reason" className="mb-1.5 block text-[14px] font-semibold text-foreground">
          Reason <span className="font-normal text-warm-meta">{HIDE_REASON_NOTE}</span>
        </Label>
        <Textarea
          id="hide-reason"
          value={hideReason}
          onChange={(e) => setHideReason(e.target.value)}
          placeholder="e.g. Half the pages were scanned upside down"
          rows={3}
          autoFocus
          aria-required="true"
        />
      </AdminDialog>

      {/* History dialog: every change in plain words, Undo asks first. */}
      <AdminDialog
        open={!!historyTarget}
        onOpenChange={(open) => {
          if (!open) {
            setHistoryTarget(null);
            setUndoConfirm(null);
          }
        }}
        title={historyTarget ? `History of ${paperLabel(historyTarget)}` : 'History'}
        size="md"
        footer={
          <AdminPillButton variant="secondary" onClick={() => setHistoryTarget(null)}>
            Close
          </AdminPillButton>
        }
      >
        {historyLoading ? (
          <AdminLoading shape="rows" rows={3} label="Loading the history" />
        ) : historyError ? (
          <AdminError what="the history" onRetry={() => historyTarget && void openHistory(historyTarget, true)} />
        ) : history.length === 0 ? (
          <AdminEmpty title="No changes recorded yet." hint="Edits, hides and restores to this paper will be listed here." />
        ) : (
          <ul className="space-y-3">
            {history.map((r) => (
              <li key={r.id} className="rounded-xl bg-muted p-3 text-[13px]">
                <p className="font-semibold text-foreground">{historyLine(r)}</p>
                <p className="mt-0.5 text-warm-meta">{new Date(r.created_at).toLocaleString()}</p>
                {r.reason ? <p className="mt-1 text-foreground">Reason: {r.reason}</p> : null}
                {UNDOABLE_ACTIONS.has(r.action) ? (
                  undoConfirm === r.id ? (
                    <div className="mt-2 rounded-xl bg-card p-3" role="group" aria-label="Confirm undo">
                      <p className="text-[13px] text-foreground">{undoEffect(r)}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <AdminPillButton variant="secondary" size="sm" onClick={() => setUndoConfirm(null)} disabled={busy(`undo:${r.id}`)}>
                          Keep it
                        </AdminPillButton>
                        <AdminPillButton variant="destructive" size="sm" onClick={() => void doUndo(r.id)} busy={busy(`undo:${r.id}`)}>
                          {busy(`undo:${r.id}`) ? 'Undoing...' : 'Undo this change'}
                        </AdminPillButton>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2">
                      <AdminPillButton variant="secondary" size="sm" onClick={() => setUndoConfirm(r.id)}>
                        Undo
                      </AdminPillButton>
                    </div>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </AdminDialog>
    </BentoStack>
  );
}

export default function AdminLibrary() {
  if (DummyLibrary && isDummyMode()) {
    return (
      <Suspense fallback={null}>
        <DummyLibrary />
      </Suspense>
    );
  }
  return <AdminLibraryPage />;
}
