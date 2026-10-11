import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from '@/lib/auth-context';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useAdminGuard, AdminGuardErrorState } from '@/components/AdminConsole';
import { AdminHeader, AdminAuditNote, buildAdminNav } from '@/pages/admin/shell';
import { AdminTable, AdminPanelHeader, AdminStatusPill, type AdminTableColumn, type AdminTableRow } from '@/pages/admin/AdminTable';
import { BentoPanel, BentoStack } from '@/components/layout/PageContainer';
import { useRefreshAdminCounts } from '@/pages/admin/useAdminSectionCounts';
import { AdminPageIntro } from '@/components/admin/AdminHelp';
import { AdminEmpty, AdminError, AdminLoading } from '@/components/admin/AdminState';
import { AdminFilterChips, type AdminFilterChip } from '@/components/admin/AdminFilterChips';
import { AdminTabs, type AdminTabItem } from '@/components/admin/AdminTabs';
import { TIPS } from '@/lib/admin-hints';
import { displaySchool } from '@/lib/school-display';
import { realApprovalApi } from '@/lib/admin-approval';
import {
  isReady,
  oldestFirst,
  rowStatus,
  type ApprovalApi,
  type ApprovalHistoryRow,
  type ApprovalQueueRow,
  historyCapNote,
} from '@/lib/admin-approval-shape';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { isDummyMode } from '@/lib/dummy-mode';
import { UpdateLivePapers } from '@/components/admin/approval/UpdateLivePapers';
import { realLiveUpdateApi, type LiveUpdateApi } from '@/lib/admin-live-update';

const DummyPaperApprovals = PREVIEW_TOOLS ? lazy(() => import('@/dummy/AdminPaperApprovalsDummy')) : null;

/* /admin/paper-approvals: papers waiting for an admin to approve them for
   launch (owner, 2026-10-02: "papers whose AI checks pass go to an admin
   approval queue ... an admin views, may edit, then approves").

   Two kinds share the list: NEW papers (not on the site yet) and papers that
   are ALREADY LIVE and need approving after the fact (the 23 auto-published
   on 2 October). A paper with any open question cannot be approved; the
   chips say so before you open it.

   Three views, kept in the URL (?view=) so back and shared links work:
     waiting       the queue, oldest first, with one chip per kind
     decided       the approval history
     live-updates  live papers whose reviewed changes have not reached the site

   One number, once: the nav badge is the headline, the chips carry the
   per-view counts, and there are no stat tiles repeating them.

   Named paper-approvals, not approvals: /admin/approvals is the teacher
   applications queue and stays as it is. */

type Filter = 'all' | 'ready' | 'open' | 'retro';
export type ApprovalsView = 'waiting' | 'decided' | 'live-updates';

const VIEWS: ApprovalsView[] = ['waiting', 'decided', 'live-updates'];

export function viewFromParam(raw: string | null, hasLive: boolean): ApprovalsView {
  const v = VIEWS.find((x) => x === raw) ?? 'waiting';
  return v === 'live-updates' && !hasLive ? 'waiting' : v;
}

/** "38 passed, 1 set aside" with the open count as its own warn pill. */
function Counts({ row }: { row: ApprovalQueueRow }) {
  return (
    <span className="tabular-nums" title={`${row.passed} passed, ${row.open} open, ${row.set_aside} set aside`}>
      {row.passed} passed
      {row.set_aside ? `, ${row.set_aside} set aside` : null}
      {row.open ? (
        <span className="ml-1.5 inline-flex h-[22px] items-center rounded-full bg-brand-subtle px-2 text-[12px] font-bold text-brand-deep">
          {row.open} open
        </span>
      ) : null}
    </span>
  );
}

function aiWords(a: ApprovalQueueRow['ai_summary']): string {
  const parts = [
    a.pass ? `${a.pass} passed` : null,
    a.fix ? `${a.fix} fixed` : null,
    a.student ? `${a.student} sent to students` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Not checked yet';
}

export function AdminPaperApprovalsPage({
  api = realApprovalApi,
  dummy = false,
  banner,
  liveApi,
}: {
  api?: ApprovalApi;
  dummy?: boolean;
  banner?: ReactNode;
  /** Dummy mode only: a fake "Update live paper" API. Real mode uses the real one. */
  liveApi?: LiveUpdateApi;
}) {
  usePageMeta('Ready to go live | Shikshaq Admin', 'Approve checked papers for launch on the site.');
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { user, profile } = useAuth();
  const signedIn = dummy ? 'admin@example.com' : user?.email ?? profile?.full_name ?? 'Signed-in admin';
  const refreshCounts = useRefreshAdminCounts();
  const [rows, setRows] = useState<ApprovalQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [decided, setDecided] = useState<ApprovalHistoryRow[] | null>(null);
  const [decidedState, setDecidedState] = useState<'idle' | 'loading' | 'error'>('idle');
  // undefined = not read yet, null = the read failed (shown as "?")
  const [liveCount, setLiveCount] = useState<number | null | undefined>(undefined);

  const activeLiveApi = dummy ? liveApi : liveApi ?? realLiveUpdateApi;
  const view = viewFromParam(params.get('view'), Boolean(activeLiveApi));
  function setView(next: string) {
    const p = new URLSearchParams(params);
    if (next === 'waiting') p.delete('view');
    else p.set('view', next);
    setParams(p, { replace: true });
  }

  const loadDecided = useCallback(async () => {
    setDecidedState('loading');
    try {
      setDecided(await api.history());
      setDecidedState('idle');
    } catch (e) {
      if (import.meta.env.DEV) console.error('paper approvals history', e);
      setDecidedState('error');
    }
  }, [api]);

  useEffect(() => {
    if (view === 'decided' && decided === null && decidedState === 'idle') void loadDecided();
  }, [view, decided, decidedState, loadDecided]);

  const guard = useAdminGuard(dummy ? null : user, { onGranted: load, redirectOnDenied: !dummy });
  const isAdmin = dummy ? true : guard.isAdmin;
  const checkingAdmin = dummy ? false : guard.checkingAdmin;

  useEffect(() => {
    if (dummy) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dummy]);
  useEffect(() => {
    if (!checkingAdmin && !isAdmin) setLoading(false);
  }, [checkingAdmin, isAdmin]);

  const countLive = useCallback(async () => {
    if (!activeLiveApi) return;
    try {
      setLiveCount((await activeLiveApi.pending()).length);
    } catch {
      setLiveCount(null);
    }
  }, [activeLiveApi]);
  useEffect(() => {
    if (isAdmin) void countLive();
  }, [isAdmin, countLive]);

  // First load shows the skeleton. A later load keeps the page and the rows on
  // screen; if it fails the rows already read stay, they are not blanked.
  async function load() {
    if (!hasLoaded) setLoading(true);
    setLoadError(false);
    try {
      setRows(await api.queue());
      setHasLoaded(true);
    } catch (e) {
      if (import.meta.env.DEV) console.error('paper approvals', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  const sorted = useMemo(() => oldestFirst(rows), [rows]);
  const counts = useMemo(
    () => ({
      all: rows.length,
      ready: rows.filter(isReady).length,
      open: rows.filter((r) => !isReady(r)).length,
      retro: rows.filter((r) => r.kind === 'retro').length,
    }),
    [rows],
  );
  const known = hasLoaded;
  const shown = useMemo(
    () =>
      sorted.filter((r) =>
        filter === 'ready' ? isReady(r) : filter === 'open' ? !isReady(r) : filter === 'retro' ? r.kind === 'retro' : true,
      ),
    [sorted, filter],
  );
  const nav = buildAdminNav('ready', known ? { paperApprovals: rows.length } : {});

  if (checkingAdmin || (loading && !hasLoaded)) {
    return (
      <BentoStack className="min-h-screen bg-muted">
        <AdminHeader nav={nav} signedInEmail={signedIn} />
        {banner}
        <BentoPanel fill="card" className="px-1.5 py-[18px] lg:px-1.5 lg:py-[18px]">
          <div className="px-[18px]">
            <div className="mb-4 h-11 w-72 max-w-full animate-pulse rounded-full bg-muted" aria-hidden />
            <AdminLoading shape="table" rows={5} label="Loading the queue" />
          </div>
        </BentoPanel>
        <AdminAuditNote />
      </BentoStack>
    );
  }
  if (!dummy && guard.error) return <AdminGuardErrorState onRetry={guard.retry} />;
  if (!isAdmin) return null;

  const columns: AdminTableColumn[] = [
    { key: 'paper', label: 'Paper', width: '2fr', wrap: true, hint: TIPS['col.ready.paper'] },
    { key: 'school', label: 'School', width: '1.5fr', wrap: true, hint: TIPS['col.school'] },
    { key: 'questions', label: 'Questions', width: '1.6fr', wrap: true, hint: TIPS['col.ready.questions'] },
    { key: 'ai', label: 'AI check', width: '1.3fr', wrap: true, hint: TIPS['col.ready.ai'] },
    { key: 'queued', label: 'Waiting', width: '0.9fr', hint: TIPS['col.ready.waiting'] },
    { key: 'state', label: 'State', width: '1.1fr', hint: TIPS['col.ready.state'] },
  ];
  const tableRows: AdminTableRow[] = shown.map((r) => {
    const st = rowStatus(r);
    return {
      id: r.audit_paper_id,
      cells: [
        <span key="t" title={r.title}>
          {r.title}
        </span>,
        r.school ? displaySchool(r.school) : 'School not recorded',
        <Counts key="c" row={r} />,
        aiWords(r.ai_summary),
        <span key="q" className="text-warm-meta">
          {r.queued_at ? formatDistanceToNow(new Date(r.queued_at), { addSuffix: true }) : 'Not recorded'}
        </span>,
        <AdminStatusPill key="s" status={st.tone} label={st.label} />,
      ],
      actions: [
        {
          label: 'Review',
          tone: 'primary',
          onClick: () => navigate(`/admin/paper-approvals/${encodeURIComponent(r.audit_paper_id)}`),
        },
      ],
    };
  });

  const chips: AdminFilterChip[] = [
    { key: 'all', label: 'All', count: known ? counts.all : undefined },
    { key: 'ready', label: 'Ready to approve', count: known ? counts.ready : undefined, hint: TIPS['ready.ready'] },
    { key: 'open', label: 'Has open questions', count: known ? counts.open : undefined, hint: TIPS['ready.open'] },
    { key: 'retro', label: 'Already live', count: known ? counts.retro : undefined, hint: TIPS['ready.live'] },
  ];

  const tabs: AdminTabItem[] = [
    { key: 'waiting', label: 'Waiting for you', count: known ? rows.length : loadError ? null : undefined },
    { key: 'decided', label: 'Already decided' },
    ...(activeLiveApi ? [{ key: 'live-updates', label: 'Live updates', count: liveCount }] : []),
  ];

  return (
    <BentoStack className="min-h-screen bg-muted">
      <AdminHeader nav={nav} signedInEmail={signedIn} />
      {banner}

      <BentoPanel fill="card" className="px-1.5 py-[18px] lg:px-1.5 lg:py-[18px]">
        <div className="mb-3 px-[18px]">
          <AdminPageIntro page="ready" />
        </div>
        <AdminPanelHeader title="Ready to go live" />
        <div className="px-[18px]">
          <AdminTabs tabs={tabs} value={view} onChange={setView} label="Papers to show">
            {view === 'decided' ? (
              <DecidedList
                rows={decided}
                state={decidedState}
                onRetry={() => {
                  setDecided(null);
                  void loadDecided();
                }}
                onOpen={(id) => navigate(`/admin/paper-approvals/${encodeURIComponent(id)}`)}
              />
            ) : view === 'live-updates' && activeLiveApi ? (
              <UpdateLivePapers
                api={activeLiveApi}
                bare
                onLoaded={(n) => setLiveCount(n)}
                onChanged={refreshCounts}
              />
            ) : (
              <>
                {typeof liveCount === 'number' && liveCount > 0 ? (
                  <p className="mb-2 flex flex-wrap items-center gap-x-2 text-[13px] text-warm-secondary">
                    <span>{liveCount === 1 ? '1 live paper has changes waiting.' : `${liveCount} live papers have changes waiting.`}</span>
                    <button
                      type="button"
                      onClick={() => setView('live-updates')}
                      className="inline-flex min-h-10 items-center font-bold text-brand-blue hover:text-brand-blue-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      See them
                    </button>
                  </p>
                ) : null}
                {loadError && !known ? (
                  <AdminError what="the queue" onRetry={() => void load()} />
                ) : (
                  <>
                    <AdminFilterChips
                      chips={chips}
                      value={filter}
                      onChange={(k) => setFilter(k as Filter)}
                      onClear={() => setFilter('all')}
                      label="Show"
                      className="mb-3"
                    />
                    {loadError ? (
                      <AdminError
                        what="the latest queue"
                        detail="The papers below are from the last time it loaded."
                        onRetry={() => void load()}
                        className="mb-3"
                      />
                    ) : null}
                    {shown.length ? (
                      <div className="-mx-[18px]">
                        <AdminTable columns={columns} rows={tableRows} />
                      </div>
                    ) : rows.length ? (
                      <AdminEmpty
                        title="No papers match this view."
                        hint="Pick another view above."
                        action={{ label: 'Show all', onClick: () => setFilter('all') }}
                      />
                    ) : (
                      <AdminEmpty
                        title="Nothing is waiting for approval."
                        hint="Papers appear here once their checks finish. The pipeline page shows what is still being checked."
                        action={{ label: 'Open the pipeline', onClick: () => navigate('/admin/pipeline') }}
                      />
                    )}
                  </>
                )}
              </>
            )}
          </AdminTabs>
        </div>
      </BentoPanel>

      <AdminAuditNote />
    </BentoStack>
  );
}

function DecidedList({
  rows,
  state,
  onRetry,
  onOpen,
}: {
  rows: ApprovalHistoryRow[] | null;
  state: 'idle' | 'loading' | 'error';
  onRetry: () => void;
  onOpen: (auditPaperId: string) => void;
}) {
  if (state === 'error') return <AdminError what="the history" onRetry={onRetry} />;
  if (rows === null) return <AdminLoading shape="table" rows={4} label="Loading the history" />;
  if (rows.length === 0) {
    return <AdminEmpty title="No paper has been approved or sent back yet." hint="Decisions appear here, with who made them and why." />;
  }
  const columns: AdminTableColumn[] = [
    { key: 'paper', label: 'Paper', width: '2fr', wrap: true, hint: TIPS['col.ready.paper'] },
    { key: 'result', label: 'Result', width: '1fr', hint: TIPS['col.decided.result'] },
    { key: 'by', label: 'By', width: '1fr', hint: TIPS['col.decided.by'] },
    { key: 'when', label: 'When', width: '1fr', hint: TIPS['col.decided.when'] },
    { key: 'note', label: 'Note', width: '2fr', wrap: true, hint: TIPS['col.decided.note'] },
  ];
  const tableRows: AdminTableRow[] = rows.map((r) => ({
    id: r.audit_paper_id,
    cells: [
      <span key="t" title={r.title}>
        {r.title}
      </span>,
      r.state === 'approved' ? (
        <AdminStatusPill key="s" status="live" label={r.kind === 'retro' ? 'Approved, was live' : 'Approved'} />
      ) : (
        <AdminStatusPill key="s" status="hidden" label="Sent back" />
      ),
      r.by_name ?? 'Not recorded',
      <span key="w" className="text-warm-meta">{r.at ? formatDistanceToNow(new Date(r.at), { addSuffix: true }) : 'Not recorded'}</span>,
      r.note || 'No note',
    ],
    actions: [{ label: 'Open', tone: 'primary', onClick: () => onOpen(r.audit_paper_id) }],
  }));
  const capNote = historyCapNote(rows.length);
  return (
    <div className="-mx-[18px]">
      <AdminTable columns={columns} rows={tableRows} />
      {capNote ? (
        <p className="mt-3 px-[18px] text-[13px] text-warm-secondary" role="note">
          {capNote}
        </p>
      ) : null}
    </div>
  );
}

export default function AdminPaperApprovals() {
  if (DummyPaperApprovals && isDummyMode()) {
    return (
      <Suspense fallback={null}>
        <DummyPaperApprovals />
      </Suspense>
    );
  }
  return <AdminPaperApprovalsPage />;
}
