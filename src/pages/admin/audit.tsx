import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useAdminGuard, AdminGuardErrorState } from '@/components/AdminConsole';
import { AdminHeader, AdminAuditNote, buildAdminNav } from '@/pages/admin/shell';
import { AdminPageIntroPanel } from '@/components/admin/AdminHelp';
import { AdminTable, AdminPanelHeader, AdminStatusPill, type AdminTableColumn, type AdminTableRow } from '@/pages/admin/AdminTable';
import { AdminEmpty, AdminError, AdminLoading } from '@/components/admin/AdminState';
import { BentoPanel, BentoStack } from '@/components/layout/PageContainer';
import { useAdminSectionCounts } from '@/pages/admin/useAdminSectionCounts';
import { AUDIT_LIMIT, realAuditApi, type AuditApi, type AuditRow } from '@/lib/audit-api';
import { describeAction } from '@/lib/audit-describe';
import { relativeWords, timeWords } from '@/lib/history-labels';
import { usePageMeta } from '@/hooks/usePageMeta';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { isDummyMode } from '@/lib/dummy-mode';
import { Search } from 'lucide-react';

const DummyAdminAudit = PREVIEW_TOOLS ? lazy(() => import('@/dummy/AdminAuditDummy')) : null;

/* Handoff 09i AD-008 — "Audit". No legacy page to port from (grepped the
   repo — nothing else reads admin_audit_log). Read-only, append-only, no
   delete: RLS on admin_audit_log grants `authenticated` only SELECT +
   INSERT (see supabase/migrations/20260818000000_admin_audit_log.sql and
   src/lib/audit.ts's own doc comment). AdminTable's `readOnly` prop hides
   the action column entirely so this page can't offer one.

   Admin rework, Batch 6: the read goes through AuditApi (so dummy mode has
   a fixture), a failed read shows AdminError and never "no actions yet", and
   times use the one log format (absolute, with the relative time on hover). */

export function AdminAuditPage({
  api = realAuditApi,
  dummy = false,
  banner,
}: {
  api?: AuditApi;
  dummy?: boolean;
  banner?: ReactNode;
}) {
  usePageMeta('Admin actions | Shikshaq admin', 'Every change an admin made, with who and when.');
  const { user, profile } = useAuth();
  const signedInName = dummy ? 'admin@example.com' : profile?.full_name || user?.email || 'Signed-in admin';
  // null = not read yet, which is different from an empty log.
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const guard = useAdminGuard(dummy ? null : user, { onGranted: load, redirectOnDenied: !dummy });
  const isAdmin = dummy ? true : guard.isAdmin;
  const checkingAdmin = dummy ? false : guard.checkingAdmin;
  const sectionCounts = useAdminSectionCounts();

  // Dummy mode has no sign-in, so nothing calls onGranted: the first read starts here.
  useEffect(() => {
    if (dummy) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dummy]);

  async function load() {
    setLoadError(false);
    try {
      setRows(await api.list(AUDIT_LIMIT));
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error fetching audit log:', error);
      setRows(null);
      setLoadError(true);
    }
  }

  const nav = buildAdminNav('audit', sectionCounts);

  if (checkingAdmin) {
    return (
      <BentoStack className="min-h-screen bg-muted">
        <AdminHeader nav={nav} signedInEmail={dummy ? 'admin@example.com' : user?.email ?? signedInName} />
        <BentoPanel fill="card" className="px-[18px] py-[18px] lg:px-[18px] lg:py-[18px]">
          <AdminLoading shape="table" rows={8} label="Loading the admin actions" />
        </BentoPanel>
      </BentoStack>
    );
  }

  if (guard.error && !dummy) return <AdminGuardErrorState onRetry={guard.retry} />;
  if (!isAdmin) return null;

  return (
    <BentoStack className="min-h-screen bg-muted">
      <AdminHeader nav={nav} signedInEmail={dummy ? 'admin@example.com' : user?.email ?? signedInName} />
      <AdminPageIntroPanel page="audit" />
      {banner}
      <AuditPanel rows={rows} loadError={loadError} onRetry={() => void load()} searchQuery={searchQuery} onSearch={setSearchQuery} />
      {/* No AdminAuditNote here: it would link this page to itself. */}
    </BentoStack>
  );
}

/** The panel: loading, error, empty and the list. `rows` is null until the first read finishes, which is not the same as an empty log. */
export function AuditPanel({
  rows,
  loadError,
  onRetry,
  searchQuery,
  onSearch,
}: {
  rows: AuditRow[] | null;
  loadError: boolean;
  onRetry: () => void;
  searchQuery: string;
  onSearch: (q: string) => void;
}) {
  const query = searchQuery.trim().toLowerCase();
  const filteredRows = !rows
    ? []
    : query
      ? rows.filter(
          (r) =>
            r.actor_name?.toLowerCase().includes(query) ||
            r.action?.toLowerCase().includes(query) ||
            describeAction(r).verb.toLowerCase().includes(query) ||
            r.target_type?.toLowerCase().includes(query) ||
            r.target_label?.toLowerCase().includes(query) ||
            r.reason?.toLowerCase().includes(query),
        )
      : rows;

  // AD-008 columns: When · Who · Action · Target · Result — read-only, no actions column.
  const columns: AdminTableColumn[] = [
    { key: 'when', label: 'When', width: '1.1fr' },
    { key: 'who', label: 'Who', width: '1.4fr' },
    { key: 'action', label: 'Action', width: '1.3fr' },
    { key: 'target', label: 'Target', width: '1.6fr', wrap: true },
    { key: 'result', label: 'Result', width: '1fr' },
  ];

  const tableRows: AdminTableRow[] = filteredRows.map((r) => {
    const { verb, result, status } = describeAction(r);
    return {
      id: r.id,
      cells: [
        // AD-008: "When" is in the muted meta colour, NOT bold, which overrides
        // AdminTable's default bold-first-column treatment (right for every other section,
        // where column 1 is the record's name; wrong here, where "Action" carries the weight).
        <span key="when" className="font-normal text-warm-meta" title={relativeWords(r.created_at)}>
          {timeWords(r.created_at)}
        </span>,
        r.actor_name,
        <span key="action" className="font-bold text-foreground">{verb}</span>,
        r.target_label || r.target_type,
        <AdminStatusPill key="result" status={status} label={result} />,
      ],
    };
  });

  const searchSlot = (
    <div className="relative w-full sm:w-[280px] max-w-full">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-label" aria-hidden />
      <input
        type="search"
        value={searchQuery}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search by admin, action, or entity..."
        aria-label="Search the admin actions"
        className="h-11 w-full rounded-full bg-muted pl-9 pr-4 text-sm text-foreground placeholder:text-warm-label outline-none transition-shadow duration-150 focus-visible:ring-2 focus-visible:ring-brand"
      />
    </div>
  );

  const atCap = rows !== null && rows.length >= AUDIT_LIMIT;

  return (
    <BentoPanel fill="card" className="px-1.5 py-[18px] lg:px-1.5 lg:py-[18px]">
      <AdminPanelHeader
        title="Admin actions"
        subtitle="What each admin changed, newest first. It is a record only: nothing here can be edited or deleted."
        meta={rows ? (atCap ? `latest ${AUDIT_LIMIT}` : `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`) : undefined}
      />

      {loadError ? (
        <div className="px-[18px]">
          <AdminError what="the admin actions" onRetry={onRetry} />
        </div>
      ) : rows === null ? (
        <div className="px-[18px]">
          <AdminLoading shape="table" rows={8} label="Loading the admin actions" />
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2 px-[18px]">{searchSlot}</div>

          {filteredRows.length === 0 ? (
            query ? (
              <AdminEmpty
                title={`No entries match "${searchQuery.trim()}"`}
                hint="Try a shorter search, or an admin's first name."
                action={{ label: 'Clear search', onClick: () => onSearch('') }}
              />
            ) : (
              <AdminEmpty title="No admin actions recorded yet" hint="The first approval, rejection or removal an admin makes will appear here." />
            )
          ) : (
            <AdminTable columns={columns} rows={tableRows} readOnly />
          )}

          {atCap ? (
            <p className="mt-4 px-[18px] text-[13px] leading-[1.5] text-warm-label">
              Showing the latest {AUDIT_LIMIT} entries. Older ones are kept but not listed here.
            </p>
          ) : null}
        </>
      )}
    </BentoPanel>
  );
}

export default function AdminAuditLog() {
  if (DummyAdminAudit && isDummyMode()) {
    return (
      <Suspense fallback={null}>
        <DummyAdminAudit />
      </Suspense>
    );
  }
  return <AdminAuditPage />;
}
