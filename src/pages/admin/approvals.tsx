import { lazy, Suspense, useCallback, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Search } from 'lucide-react';
import { toast as sonnerToast } from 'sonner';
import { writeErrorWords } from '@/lib/admin-approval-shape';
import { useAuth } from '@/lib/auth-context';
import { recordAdminAction } from '@/lib/audit';
import { formatDistanceToNow } from 'date-fns';
import { usePageMeta } from '@/hooks/usePageMeta';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useConfirm } from '@/components/ui/use-confirm';
import { useAdminGuard, AdminGuardErrorState } from '@/components/AdminConsole';
import { AdminHeader, AdminAuditNote, buildAdminNav } from '@/pages/admin/shell';
import { AdminStack } from '@/pages/admin/embed';
import { AdminPageIntroPanel } from '@/components/admin/AdminHelp';
import { AdminEmpty, AdminError } from '@/components/admin/AdminState';
import { AdminFilterChips, type AdminFilterChip } from '@/components/admin/AdminFilterChips';
import { ApplicationDialog } from '@/components/admin/ApplicationDialog';
import { useRefreshAdminCounts } from '@/pages/admin/useAdminSectionCounts';
import {
  AdminTable,
  AdminTableSkeleton,
  AdminPanelHeader,
  AdminStatusPill,
  type AdminTableColumn,
  type AdminTableRow,
} from '@/pages/admin/AdminTable';
import { BentoPanel } from '@/components/layout/PageContainer';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { isDummyMode } from '@/lib/dummy-mode';
import { APPLICATION_STATUS_LABEL, docsLabel, placeWords } from '@/lib/teacher-review-api';
import {
  APPLICATION_COLUMNS,
  STATUS_TONE,
  STATUS_VIEWS,
  ALREADY_DECIDED_WORDS,
  AlreadyDecidedError,
  approveWithConfirm,
  isAlreadyDecided,
  countsByView,
  defaultOrder,
  emptyCopy,
  filterApplications,
  neighbours,
  nextToOpen,
  normaliseApplicationRow,
  rejectWithReason,
  sortApplications,
  textedLabel,
  viewFromParam,
  withDecision,
  type ApprovalsApi,
  type SortOrder,
  type StatusView,
  type TeacherApplication,
  type TextedStatus,
} from '@/lib/admin-applications';

/* Admin Applications: teachers who asked to join. Same teacher_applications
   reads, the same approve_teacher_application RPC, the same reject update and
   the same recordAdminAction calls as before (handoff 09i AD-001..004). What
   changed is how the page behaves:

   - A failed read says so, with Try again. It never reads "nothing waiting".
   - Waiting / Approved / Rejected / All are chips with their own counts;
     Waiting is the default and works from the oldest.
   - Approve asks first, because it lists the teacher on the site at once.
   - After a decision the row is patched in place, the next waiting application
     opens, and the list refreshes quietly. The page never re-skeletons.
   - The outreach note (Not texted / Texted / Follow up) lives on each one.

   The page takes its database as `api`, so dummy mode (test builds only) can
   run it against made-up applications. */

const DummyApprovals = PREVIEW_TOOLS ? lazy(() => import('@/dummy/AdminApprovalsDummy')) : null;

const APPROVALS_KEY = (scope: string) => ['admin', 'approvals', scope] as const;

/* An explicit column list, not select('*'): every name is in APPLICATION_COLUMNS
   (admin-applications.ts), each proven readable by the admin role. To undo this
   commit and go back to the wildcard, set this to '*'. */
const APPLICATION_SELECT = APPLICATION_COLUMNS.join(',');

export const realApprovalsApi: ApprovalsApi = {
  async list() {
    const { data, error } = await supabase.from('teacher_applications').select(APPLICATION_SELECT).order('created_at', { ascending: false });
    if (error) throw error;
    return ((data ?? []) as unknown as Record<string, unknown>[]).map(normaliseApplicationRow);
  },
  async approve(applicationId, adminId) {
    const { error } = await supabase.rpc('approve_teacher_application', { application_id: applicationId, admin_id: adminId });
    if (error) throw error;
  },
  async reject(applicationId, adminId, reason) {
    const { data, error } = await supabase
      .from('teacher_applications')
      .update({
        status: 'rejected',
        reviewed_by: adminId,
        reviewed_at: new Date().toISOString(),
        rejection_reason: reason || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', applicationId)
      // Only a waiting application can be rejected. If another admin approved or
      // rejected it first, no row matches and we say so rather than overwrite them.
      .eq('status', 'pending')
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new AlreadyDecidedError();
  },
  async setTexted(applicationId, status) {
    const { error } = await supabase.from('teacher_applications').update({ texted_status: status }).eq('id', applicationId);
    if (error) throw error;
  },
  async reviewerNames(ids) {
    if (ids.length === 0) return {};
    const { data, error } = await supabase.from('profiles').select('id, full_name, email').in('id', ids);
    if (error || !data) return {};
    const map: Record<string, string> = {};
    data.forEach((row) => {
      map[row.id] = row.full_name || row.email || 'an admin';
    });
    return map;
  },
};

// ------------------------------------------------------------------ the list

const COLUMNS: AdminTableColumn[] = [
  { key: 'applicant', label: 'Applicant', width: '1.6fr' },
  { key: 'contact', label: 'Contact', width: '1.3fr' },
  { key: 'subjects', label: 'Subjects', width: '1.6fr', wrap: true },
  { key: 'area', label: 'Where they teach', width: '1.1fr', wrap: true },
  { key: 'submitted', label: 'Submitted', width: '1fr', wrap: true },
  { key: 'docs', label: 'Documents sent', width: '1.1fr', wrap: true },
  { key: 'status', label: 'Status', width: '1fr' },
];

export type ApplicationsLoad = 'loading' | 'error' | 'ready';

/** The body of the panel: skeleton, error, empty or the table. Presentational,
 *  so every state can be rendered and checked on its own. A failed read shows
 *  the error and NEVER an empty-state sentence. */
export function ApplicationsBody({
  load,
  shown,
  view,
  search,
  onRetry,
  onClearSearch,
  onShowAll,
  onOpen,
}: {
  load: ApplicationsLoad;
  shown: TeacherApplication[];
  view: StatusView;
  search: string;
  onRetry: () => void;
  onClearSearch: () => void;
  onShowAll: () => void;
  onOpen: (id: string) => void;
}) {
  if (load === 'loading') return <AdminTableSkeleton label="Loading the applications" />;
  if (load === 'error') return <AdminError what="the applications" onRetry={onRetry} className="mx-[18px]" />;
  if (shown.length === 0) {
    const copy = emptyCopy(view, search);
    const action = search.trim()
      ? { label: 'Clear search', onClick: onClearSearch }
      : view !== 'all'
        ? { label: 'Show all applications', onClick: onShowAll }
        : undefined;
    return (
      <div className="mx-[18px] rounded-2xl bg-muted">
        <AdminEmpty title={copy.title} hint={copy.hint} action={action} />
      </div>
    );
  }
  const rows: AdminTableRow[] = shown.map((a) => ({
    id: a.id,
    cells: [
      a.name,
      <div key="c" className="min-w-0">
        <p className="truncate">+91 {a.phone_number}</p>
        {a.texted_status !== 'not_texted' ? <p className="truncate text-[12px] font-semibold text-brand-blue">{textedLabel(a.texted_status)}</p> : null}
      </div>,
      [a.subjects, a.classes_taught_for_backend].filter(Boolean).join(' · ') || 'Not said',
      placeWords(a.location_v2),
      formatDistanceToNow(new Date(a.created_at), { addSuffix: true }),
      docsLabel(a),
      <AdminStatusPill key="status" status={STATUS_TONE[a.status]} label={APPLICATION_STATUS_LABEL[a.status]} />,
    ],
    actions: [{ label: a.status === 'pending' ? 'Review' : 'Open', tone: 'primary', onClick: () => onOpen(a.id) }],
  }));
  return <AdminTable columns={COLUMNS} rows={rows} />;
}

// ---------------------------------------------------------------- the page

export function AdminApprovalsPage({
  api = realApprovalsApi,
  dummy = false,
  banner,
}: {
  api?: ApprovalsApi;
  dummy?: boolean;
  banner?: ReactNode;
}) {
  usePageMeta('Applications | Shikshaq Admin', 'Review teachers who applied to join, then approve or reject them.');
  const { user, profile } = useAuth();
  const actorName = dummy ? 'admin@example.com' : profile?.full_name || user?.email || 'an admin';
  const adminId = dummy ? 'dummy-admin' : user?.id ?? null;
  const guard = useAdminGuard(dummy ? null : user, { redirectOnDenied: !dummy });
  const isAdmin = dummy ? true : guard.isAdmin;
  const checkingAdmin = dummy ? false : guard.checkingAdmin;
  const qc = useQueryClient();
  const refreshCounts = useRefreshAdminCounts();
  const { confirm, confirmDialog } = useConfirm();
  const [params, setParams] = useSearchParams();

  const scope = dummy ? 'dummy' : 'live';
  const key = APPROVALS_KEY(scope);
  const view = viewFromParam(params.get('status'));
  const [search, setSearch] = useState('');
  const [sortOverride, setSortOverride] = useState<SortOrder | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [outreachBusy, setOutreachBusy] = useState(false);

  const q = useQuery({
    queryKey: key,
    queryFn: () => api.list(),
    enabled: !!isAdmin,
    staleTime: 15_000,
    refetchOnMount: true,
    retry: false,
  });
  const apps = useMemo(() => q.data ?? [], [q.data]);
  // Only the first load skeletons. A refetch that fails after data arrived
  // keeps the rows and says so above them.
  const load: ApplicationsLoad = q.data ? 'ready' : q.isError ? 'error' : 'loading';

  const counts = useMemo(() => countsByView(apps), [apps]);
  const order = sortOverride ?? defaultOrder(view);
  const shown = useMemo(() => sortApplications(filterApplications(apps, view, search), order), [apps, view, search, order]);
  const open = apps.find((a) => a.id === openId) ?? null;
  const pos = open ? neighbours(shown, open.id) : null;

  const namesQ = useQuery({
    queryKey: [...key, 'names', open?.reviewed_by ?? ''],
    queryFn: () => api.reviewerNames(open?.reviewed_by ? [open.reviewed_by] : []),
    enabled: !!isAdmin && !!open?.reviewed_by,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const setView = useCallback(
    (next: StatusView) => {
      setParams(
        (p) => {
          const n = new URLSearchParams(p);
          if (next === 'waiting') n.delete('status');
          else n.set('status', next);
          return n;
        },
        { replace: true },
      );
      setSortOverride(null);
    },
    [setParams],
  );

  const patch = useCallback(
    (fn: (list: TeacherApplication[]) => TeacherApplication[]) => {
      qc.setQueryData<TeacherApplication[]>(key, (old) => (old ? fn(old) : old));
    },
    [qc, key],
  );

  const quietRefresh = useCallback(() => {
    refreshCounts();
    void qc.invalidateQueries({ queryKey: key });
  }, [qc, key, refreshCounts]);

  const afterDecision = (app: TeacherApplication, status: 'approved' | 'rejected', reason: string | null) => {
    const nextId = nextToOpen(shown, app.id);
    const left = counts.waiting - (app.status === 'pending' ? 1 : 0);
    patch((list) => list.map((a) => (a.id === app.id ? withDecision(a, status, adminId ?? '', reason) : a)));
    if (!dummy && user) {
      void recordAdminAction({
        actorId: user.id,
        actorName,
        action: status === 'approved' ? 'approve' : 'reject',
        targetType: 'teacher_application',
        targetId: app.id,
        targetLabel: app.name || 'teacher',
        ...(status === 'rejected' ? { reason: reason || null } : {}),
      });
    }
    sonnerToast.success(`"${app.name || 'Application'}" ${status}${left > 0 ? `. ${left} left.` : '. Nothing else is waiting.'}`);
    setOpenId(nextId);
    quietRefresh();
  };

  // Another admin got there first: refresh so the row shows their decision, say
  // so, and move on to the next waiting application.
  const handleAlreadyDecided = (app: TeacherApplication) => {
    sonnerToast.error(ALREADY_DECIDED_WORDS);
    setOpenId(nextToOpen(shown, app.id));
    quietRefresh();
  };

  const onApprove = async (app: TeacherApplication) => {
    if (!adminId) return;
    try {
      const res = await approveWithConfirm({
        app,
        adminId,
        confirm,
        api: {
          approve: async (id, aid) => {
            setProcessingId(id);
            await api.approve(id, aid);
          },
        },
      });
      if (res === 'approved') afterDecision(app, 'approved', null);
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error approving application:', error);
      if (isAlreadyDecided(error)) handleAlreadyDecided(app);
      else sonnerToast.error(writeErrorWords(error, 'Failed to approve application. Nothing was changed.'));
    } finally {
      setProcessingId(null);
    }
  };

  const onReject = async (app: TeacherApplication, reason: string) => {
    if (!adminId) return;
    try {
      setProcessingId(app.id);
      const res = await rejectWithReason({ app, adminId, reason, api });
      if (res === 'rejected') afterDecision(app, 'rejected', reason);
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error rejecting application:', error);
      if (isAlreadyDecided(error)) handleAlreadyDecided(app);
      else sonnerToast.error(writeErrorWords(error, 'Failed to reject application. Nothing was changed.'));
    } finally {
      setProcessingId(null);
    }
  };

  const onTexted = async (app: TeacherApplication, status: TextedStatus) => {
    try {
      setOutreachBusy(true);
      await api.setTexted(app.id, status);
      patch((list) => list.map((a) => (a.id === app.id ? { ...a, texted_status: status } : a)));
      quietRefresh();
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error saving the outreach note:', error);
      sonnerToast.error('Could not save the outreach note. Try again.');
    } finally {
      setOutreachBusy(false);
    }
  };

  const signedIn = dummy ? 'admin@example.com' : user?.email ?? actorName;
  // Counts come from the shared hook inside AdminHeader; no page-level plumbing.
  const nav = buildAdminNav('applications');

  if (!dummy && guard.error) return <AdminGuardErrorState onRetry={guard.retry} />;
  if (!checkingAdmin && !isAdmin) return null;

  const known = load === 'ready';
  const chips: AdminFilterChip[] = STATUS_VIEWS.map((v) => ({
    key: v.key,
    label: v.label,
    hint: v.hint,
    ...(known ? { count: counts[v.key] } : load === 'loading' ? { noCount: true } : {}),
  }));

  return (
    <AdminStack>
      <AdminHeader nav={nav} signedInEmail={signedIn} />
      {banner}
      <AdminPageIntroPanel page="applications" />

      <BentoPanel fill="card" className="px-1.5 py-[18px] lg:px-1.5 lg:py-[18px]">
        <AdminPanelHeader title="Applications" />

        <div className="mb-4 flex flex-col gap-3 px-[18px]">
          <AdminFilterChips chips={chips} value={view} onChange={setView} onClear={() => setView('waiting')} defaultValue="waiting" label="Which applications to show" />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 w-full sm:w-[280px] sm:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-label" aria-hidden />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email, phone"
                aria-label="Search applications"
                className="h-11 w-full max-w-full rounded-full bg-muted pl-9 pr-4 text-sm text-foreground placeholder:text-warm-label outline-none transition-shadow duration-150 focus-visible:ring-2 focus-visible:ring-brand"
              />
            </div>
            <Select value={order} onValueChange={(v) => setSortOverride(v as SortOrder)}>
              <SelectTrigger aria-label="Order" className="h-11 w-full shrink-0 rounded-full border-0 bg-muted text-sm font-semibold sm:w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="oldest">Oldest first</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {q.isError && q.data ? (
          <AdminError
            what="the latest applications"
            detail="You are looking at the list as it was a moment ago."
            onRetry={() => void q.refetch()}
            className="mx-[18px] mb-3"
          />
        ) : null}

        <div aria-busy={q.isFetching && !!q.data} aria-live="polite">
          <ApplicationsBody
            load={load}
            shown={shown}
            view={view}
            search={search}
            onRetry={() => void q.refetch()}
            onClearSearch={() => setSearch('')}
            onShowAll={() => setView('all')}
            onOpen={setOpenId}
          />
        </div>
      </BentoPanel>

      <AdminAuditNote />

      <ApplicationDialog
        app={open}
        position={pos && open ? { index: pos.index, total: shown.length } : null}
        prevId={pos?.prev ?? null}
        nextId={pos?.next ?? null}
        reviewerName={open?.reviewed_by ? namesQ.data?.[open.reviewed_by] : undefined}
        busy={processingId !== null}
        outreachBusy={outreachBusy}
        onClose={() => setOpenId(null)}
        onOpen={setOpenId}
        onApprove={(a) => void onApprove(a)}
        onReject={(a, r) => void onReject(a, r)}
        onTexted={(a, s) => void onTexted(a, s)}
      />
      {confirmDialog}
    </AdminStack>
  );
}

export default function AdminApprovals() {
  if (DummyApprovals && isDummyMode()) {
    return (
      <Suspense fallback={null}>
        <DummyApprovals />
      </Suspense>
    );
  }
  return <AdminApprovalsPage />;
}
