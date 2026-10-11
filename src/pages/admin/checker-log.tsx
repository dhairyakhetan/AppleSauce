import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { useAuth } from '@/lib/auth-context';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useAdminGuard, AdminGuardErrorState } from '@/components/AdminConsole';
import { AdminHeader, AdminAuditNote, buildAdminNav } from '@/pages/admin/shell';
import { AdminPageIntroPanel } from '@/components/admin/AdminHelp';
import { AdminTable, AdminPanelHeader, type AdminTableColumn, type AdminTableRow } from '@/pages/admin/AdminTable';
import { AdminEmpty, AdminError, AdminLoading } from '@/components/admin/AdminState';
import { AdminFilterChips } from '@/components/admin/AdminFilterChips';
import { BentoPanel, BentoStack } from '@/components/layout/PageContainer';
import { useAdminSectionCounts } from '@/pages/admin/useAdminSectionCounts';
import { realCheckerLogApi } from '@/lib/checker-log-api';
import { ROLE_LABELS, sinceWords, type CheckerLogApi, type CheckerRow } from '@/lib/checker-log';
import { timeWords, type ActorKind } from '@/lib/history-labels';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { isDummyMode } from '@/lib/dummy-mode';

const DummyCheckerLog = PREVIEW_TOOLS ? lazy(() => import('@/dummy/AdminCheckerLogDummy')) : null;

/* /admin/checker-log: everyone and everything that checks papers, people
   first, then the AI checks and the pipeline. Open one to read their work
   day by day (owner, 2026-10-02: "an admin page to see a checker's log day
   wise in good english language visually").

   Named checker-log because /admin/checkers is the page that grants checker
   access, and stays as it is.

   Admin rework, Batch 6: the whole row is the link (it used to carry eight
   identical "Open log" buttons), the role is a small badge under the name,
   and the scope chips carry the People and AI counts the old tiles showed.
   The scope words match the Activity page: Everyone, People, AI and pipeline. */

type Filter = 'all' | 'people' | 'machines';

const ROLE_ORDER: Record<ActorKind, number> = { student: 0, admin: 1, ai: 2, pipeline: 3 };

const isPerson = (r: CheckerRow) => r.role === 'student' || r.role === 'admin';

export function AdminCheckerLogPage({
  api = realCheckerLogApi,
  dummy = false,
  banner,
}: {
  api?: CheckerLogApi;
  dummy?: boolean;
  banner?: ReactNode;
}) {
  usePageMeta('Checker activity | Shikshaq Admin', 'What each checker did, day by day.');
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const signedIn = dummy ? 'admin@example.com' : user?.email ?? profile?.full_name ?? 'Signed-in admin';
  const [rows, setRows] = useState<CheckerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const guard = useAdminGuard(dummy ? null : user, { onGranted: load, redirectOnDenied: !dummy });
  const isAdmin = dummy ? true : guard.isAdmin;
  const checkingAdmin = dummy ? false : guard.checkingAdmin;
  const sectionCounts = useAdminSectionCounts();

  useEffect(() => {
    if (dummy) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dummy]);
  useEffect(() => {
    if (!checkingAdmin && !isAdmin) setLoading(false);
  }, [checkingAdmin, isAdmin]);

  async function load() {
    setLoading(true);
    setLoadError(false);
    try {
      setRows(await api.list());
    } catch (e) {
      if (import.meta.env.DEV) console.error('checker log', e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  const nav = buildAdminNav('checker-log', sectionCounts);

  const sorted = useMemo(
    () =>
      [...rows]
        .filter((r) => (filter === 'people' ? isPerson(r) : filter === 'machines' ? !isPerson(r) : true))
        .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || (b.last_at ?? '').localeCompare(a.last_at ?? '')),
    [rows, filter],
  );

  if (checkingAdmin || loading) {
    return (
      <BentoStack className="min-h-screen bg-muted">
        <AdminHeader nav={nav} signedInEmail={signedIn} />
        {banner}
        <BentoPanel fill="card" className="px-[18px] py-[18px]">
          <AdminLoading shape="table" rows={6} label="Loading the checker activity" />
        </BentoPanel>
        <AdminAuditNote />
      </BentoStack>
    );
  }
  if (!dummy && guard.error) return <AdminGuardErrorState onRetry={guard.retry} />;
  if (!isAdmin) return null;

  const people = rows.filter(isPerson).length;
  const dayAgo = Date.now() - 24 * 3600_000;
  const activeToday = rows.filter((r) => r.last_at && new Date(r.last_at).getTime() >= dayAgo).length;
  const total = rows.reduce((s, r) => s + r.total_actions, 0);

  const columns: AdminTableColumn[] = [
    { key: 'name', label: 'Name', width: '2fr' },
    { key: 'last', label: 'Last active', width: '1.4fr' },
    { key: 'total', label: 'Actions', width: '0.8fr' },
    { key: 'since', label: 'Since', width: '1fr' },
  ];
  const tableRows: AdminTableRow[] = sorted.map((r) => ({
    id: r.actor_key,
    href: `/admin/checker-log/${encodeURIComponent(r.actor_key)}`,
    cells: [
      <span key="n" className="flex min-w-0 flex-col items-start gap-0.5">
        <span className="max-w-full truncate">{r.name}</span>
        <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-warm-secondary">{ROLE_LABELS[r.role]}</span>
      </span>,
      <span key="l" className="text-warm-meta" title={r.last_at ? timeWords(r.last_at) : undefined}>
        {r.last_at ? formatDistanceToNow(new Date(r.last_at), { addSuffix: true }) : 'Never'}
      </span>,
      <span key="t" className="tabular-nums">
        {r.total_actions.toLocaleString()}
      </span>,
      <span key="s" className="text-warm-meta">
        {sinceWords(r.first_at)}
      </span>,
    ],
  }));

  return (
    <BentoStack className="min-h-screen bg-muted">
      <AdminHeader nav={nav} signedInEmail={signedIn} />
      <AdminPageIntroPanel page="checker-log" />
      {banner}

      <BentoPanel fill="card" className="px-1.5 py-[18px] lg:px-1.5 lg:py-[18px]">
        <AdminPanelHeader title="Checker activity" subtitle="People first, then the AI checks and the pipeline. Open a name to read their days." />
        {loadError ? (
          <div className="px-[18px]">
            <AdminError what="the checker activity" onRetry={() => void load()} />
          </div>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-3 px-[18px]">
              <Stat label="Active in the last day" value={activeToday} />
              <Stat label="Actions recorded" value={total.toLocaleString()} />
            </div>
            <AdminFilterChips
              className="mb-3 px-[18px]"
              label="Show"
              chips={[
                { key: 'all', label: 'Everyone', count: rows.length },
                { key: 'people', label: 'People', count: people, hint: 'Student checkers and admins.' },
                { key: 'machines', label: 'AI and pipeline', count: rows.length - people, hint: 'The AI checks and the automatic pipeline.' },
              ]}
              value={filter}
              onChange={(k) => setFilter(k as Filter)}
              onClear={() => setFilter('all')}
            />
            {sorted.length ? (
              <AdminTable columns={columns} rows={tableRows} readOnly />
            ) : (
              <AdminEmpty
                title={rows.length ? 'Nobody in this view' : 'Nobody has checked anything yet'}
                hint={
                  rows.length
                    ? 'Try Everyone to see all of the log.'
                    : 'Give someone verifier access on the Verifiers page to get started.'
                }
                action={
                  rows.length
                    ? { label: 'Show everyone', onClick: () => setFilter('all') }
                    : { label: 'Open Verifiers', onClick: () => navigate('/admin/checkers') }
                }
              />
            )}
          </>
        )}
      </BentoPanel>

      <AdminAuditNote />
    </BentoStack>
  );
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="rounded-2xl bg-muted px-4 py-3">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-warm-label">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</p>
      {sub ? <p className="mt-0.5 text-[13px] text-warm-meta">{sub}</p> : null}
    </div>
  );
}

export default function AdminCheckerLog() {
  if (DummyCheckerLog && isDummyMode()) {
    return (
      <Suspense fallback={null}>
        <DummyCheckerLog />
      </Suspense>
    );
  }
  return <AdminCheckerLogPage />;
}
