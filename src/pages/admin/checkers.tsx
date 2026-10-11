import { useCallback, useEffect, useMemo, useState, lazy, Suspense, type ReactNode } from 'react';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useSearchParams } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { toast as sonnerToast } from 'sonner';
import { useAuth } from '@/lib/auth-context';
import { recordAdminAction } from '@/lib/audit';
import { useAdminGuard, AdminGuardErrorState } from '@/components/AdminConsole';
import { AdminHeader, AdminAuditNote, buildAdminNav } from '@/pages/admin/shell';
import { AdminTable, AdminPanelHeader, AdminStatusPill, type AdminStatus, type AdminTableColumn, type AdminTableRow } from '@/pages/admin/AdminTable';
import { BentoPanel, BentoStack } from '@/components/layout/PageContainer';
import { useAdminSectionCounts } from '@/pages/admin/useAdminSectionCounts';
import { useConfirm } from '@/components/ui/use-confirm';
import { HodSection } from '@/components/admin/HodSection';
import { realHodAdminApi, realHodApi, type HodAdminApi, type HodApi, type HodRow, type HodVerifierProfile } from '@/lib/hod-api';
import { realTeacherReviewerAdminApi, type ReviewerRow, type TeacherReviewerAdminApi } from '@/lib/teacher-review-api';
import { VerifierProfileForm } from '@/components/hod/VerifierProfileForm';
import { realCheckerAdminApi, type CheckerAdminApi, type CheckerAdminRow } from '@/lib/checker-admin-api';
import { AdminPageIntro } from '@/components/admin/AdminHelp';
import { AdminDialog } from '@/components/admin/AdminDialog';
import { AdminTabs } from '@/components/admin/AdminTabs';
import { AdminEmpty, AdminError, AdminLoading } from '@/components/admin/AdminState';
import { PEOPLE_NO_ACCOUNT, PeoplePicker } from '@/components/admin/PeoplePicker';
import { AddStudentGuide } from '@/components/admin/AddStudentGuide';
import { TIPS } from '@/lib/admin-hints';
import { loadView } from '@/lib/admin-load-view';
import {
  DETAILS_LABEL,
  detailsState,
  needDetailsCount,
  needDetailsText,
  profilesById,
  sortByDetails,
  type DetailsState,
} from '@/lib/verifier-details';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { isDummyMode } from '@/lib/dummy-mode';

const DummyAdminCheckers = PREVIEW_TOOLS ? lazy(() => import('@/dummy/AdminCheckersDummy')) : null;

/* Pipeline-plan Step 2, #7: who can open /checker. Its own admin page
   rather than a section of an existing one because none of the existing
   admin pages hold "which accounts have a permission" -- this is a small
   membership list, closer in shape to Feedback's plain table than to a
   moderation queue. Add-by-email is deliberately the whole flow: no role
   picker, no bulk import, because there is no evidence yet this list will
   ever need either.

   Two views, in the URL as ?view= so back and shared links work:
     verifiers (default)  who can verify papers, and who still lacks details
     hods                 HODs, and teacher reviewers (see HodSection)

   One first-load gate covers both views. After that, adding or removing
   someone refreshes the lists quietly: the page stays mounted, nothing jumps,
   focus stays where it was. A failed read is an error with Try again, never
   an empty list. */

type View = 'verifiers' | 'hods';

const DETAILS_TONE: Record<DetailsState, AdminStatus> = { missing: 'pending', expired: 'hidden', ready: 'live', unknown: 'paused' };

const DETAILS_HINT =
  'Ready: grade, school and board are saved and in date. Missing: nothing saved yet, so papers are given with no class limit. Expired: no new papers until the date is renewed.';

/** The verifiers table (or the reason it is not there). Pure, so every state can be checked. */
export function VerifierListBody({
  rows,
  error,
  profiles,
  onRetry,
  onDetails,
  onRemove,
  openingId,
}: {
  rows: CheckerAdminRow[] | null;
  error: boolean;
  /** null = the profiles read failed or has not happened: details are "not known". */
  profiles: HodVerifierProfile[] | null;
  onRetry: () => void;
  onDetails: (r: CheckerAdminRow) => void;
  onRemove: (r: CheckerAdminRow) => void;
  openingId?: string | null;
}) {
  const view = loadView({ settled: rows !== null || error, error, count: rows?.length ?? 0 });
  if (view === 'error') return <AdminError what="the verifier list" onRetry={onRetry} className="mx-[18px]" />;
  if (view === 'skeleton') return <AdminLoading shape="table" label="Loading the verifiers" />;
  if (view === 'empty') {
    return <AdminEmpty title="There are no verifiers yet" hint="Search for someone above and add them." />;
  }
  const list = rows ?? [];
  const byId = profilesById(profiles);
  const stateOf = (r: CheckerAdminRow) => detailsState(byId.get(r.user_id), profiles !== null);
  const sorted = sortByDetails(list, stateOf);

  const columns: AdminTableColumn[] = [
    { key: 'email', label: 'Verifier', width: '1.6fr', hint: TIPS['col.checker'] },
    { key: 'details', label: 'Details', width: '0.9fr', hint: DETAILS_HINT },
    { key: 'added', label: 'Added', width: '1fr', hint: TIPS['col.added'] },
    { key: 'today', label: 'Today', width: '0.6fr', hint: TIPS['col.today'] },
    { key: 'total', label: 'Total', width: '0.6fr', hint: TIPS['col.total'] },
  ];
  const tableRows: AdminTableRow[] = sorted.map((r) => {
    const s = stateOf(r);
    return {
      id: r.user_id,
      cells: [
        <div key="email" className="min-w-0">
          <p className="truncate font-semibold text-foreground">{r.full_name || r.email}</p>
          {r.full_name ? <p className="truncate text-[12px] text-warm-label">{r.email}</p> : null}
        </div>,
        <AdminStatusPill key="details" status={DETAILS_TONE[s]} label={DETAILS_LABEL[s]} />,
        <span key="added" className="text-warm-meta">{formatDistanceToNow(new Date(r.added_at), { addSuffix: true })}</span>,
        <span key="today" className="font-bold tabular-nums text-foreground">{r.checked_today}</span>,
        <span key="total" className="font-bold tabular-nums text-foreground">{r.checked_total}</span>,
      ],
      actions: [
        {
          label: openingId === r.user_id ? 'Opening...' : s === 'ready' ? 'Details' : s === 'unknown' ? 'Details' : 'Add details',
          tone: 'primary',
          disabled: openingId === r.user_id,
          onClick: () => onDetails(r),
        },
        { label: 'Remove', tone: 'destructive', onClick: () => onRemove(r) },
      ],
    };
  });
  return (
    <>
      {error ? <AdminError what="the latest verifier list" onRetry={onRetry} detail="The list below may be out of date." className="mx-[18px] mb-3" /> : null}
      <AdminTable columns={columns} rows={tableRows} />
    </>
  );
}

export function AdminCheckersPage({
  api = realCheckerAdminApi,
  hodApi = realHodAdminApi,
  profileApi = realHodApi,
  reviewerApi = realTeacherReviewerAdminApi,
  dummy = false,
  banner,
}: {
  api?: CheckerAdminApi;
  /** The HODs section's API (admin_*_hod). */
  hodApi?: HodAdminApi;
  /** The verifier details form's API (hod_set_verifier_profile, hod_verifier_profiles). */
  profileApi?: Pick<HodApi, 'setProfile' | 'profiles'>;
  /** The teacher reviewers list (hod_*_teacher_reviewer). */
  reviewerApi?: TeacherReviewerAdminApi;
  /** Dummy mode (D75): no sign-in, no real admin check, a fake API. */
  dummy?: boolean;
  banner?: ReactNode;
}) {
  usePageMeta('Verifiers | Shikshaq Admin', 'Who can verify papers, and their details.');
  const { user, profile } = useAuth();
  const actorName = dummy ? 'admin@example.com' : profile?.full_name || user?.email || 'Signed-in admin';
  const [searchParams, setSearchParams] = useSearchParams();
  const view: View = searchParams.get('view') === 'hods' ? 'hods' : 'verifiers';

  const [rows, setRows] = useState<CheckerAdminRow[] | null>(null);
  const [rowsError, setRowsError] = useState(false);
  const [profiles, setProfiles] = useState<HodVerifierProfile[] | null>(null);
  const [hods, setHods] = useState<HodRow[] | null>(null);
  const [hodsError, setHodsError] = useState(false);
  const [reviewers, setReviewers] = useState<ReviewerRow[] | null>(null);
  const [reviewersError, setReviewersError] = useState(false);
  const [settled, setSettled] = useState(false);
  const [busy, setBusy] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  // The verifier whose details are being filled in: straight after an admin
  // adds someone, or from a row's Details button.
  const [detailsFor, setDetailsFor] = useState<{ user_id: string; label: string; initial: Partial<HodVerifierProfile> } | null>(null);
  const [savingDetails, setSavingDetails] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  // One read of everything both views need. Each list fails on its own: a
  // failed read keeps whatever was already held and flags an error, and the
  // profiles read (only used for the Details column) may fail without
  // blocking the page.
  const loadAll = useCallback(async () => {
    setBusy(true);
    const [c, p, h, r] = await Promise.allSettled([api.listCheckers(), profileApi.profiles(), hodApi.listHods(), reviewerApi.list()]);
    if (c.status === 'fulfilled') {
      setRows(c.value);
      setRowsError(false);
    } else {
      if (import.meta.env.DEV) console.error('Error fetching checkers:', c.reason);
      setRowsError(true);
    }
    if (p.status === 'fulfilled') setProfiles(p.value);
    if (h.status === 'fulfilled') {
      setHods(h.value);
      setHodsError(false);
    } else {
      setHodsError(true);
    }
    if (r.status === 'fulfilled') {
      setReviewers(r.value);
      setReviewersError(false);
    } else {
      setReviewersError(true);
    }
    setSettled(true);
    setBusy(false);
  }, [api, profileApi, hodApi, reviewerApi]);

  // In dummy mode there is no real signed-in admin to check for, so the
  // guard is asked never to redirect and its verdict is overridden below --
  // same shape Checker.tsx uses for CheckerPage's own `dummy` prop.
  const guard = useAdminGuard(dummy ? null : user, {
    onGranted: () => void loadAll(),
    redirectOnDenied: !dummy,
  });
  const isAdmin = dummy ? true : guard.isAdmin;
  const checkingAdmin = dummy ? false : guard.checkingAdmin;
  const { error: adminGuardError, retry: retryAdminGuard } = guard;
  useEffect(() => {
    if (dummy) void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dummy]);
  const sectionCounts = useAdminSectionCounts();

  async function openDetails(userId: string, label: string) {
    setOpeningId(userId);
    let initial: Partial<HodVerifierProfile> = { name: label };
    try {
      const found = (await profileApi.profiles()).find((p) => p.user_id === userId);
      if (found) initial = found;
    } catch {
      /* the form still works blank */
    }
    setOpeningId(null);
    setDetailsFor({ user_id: userId, label, initial });
  }

  async function handleAdd(email: string) {
    let newUserId: string;
    try {
      newUserId = await api.addChecker(email);
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error adding checker:', error);
      throw new Error(
        error instanceof Error && /no account|not found/i.test(error.message)
          ? PEOPLE_NO_ACCOUNT
          : 'Could not add that verifier. Check the email and try again.',
      );
    }
    sonnerToast.success(`${email} is now a verifier. Add their details so papers match their grade.`);
    if (user) {
      void recordAdminAction({
        actorId: user.id,
        actorName,
        action: 'grant_checker',
        targetType: 'checker',
        targetId: newUserId,
        targetLabel: email,
      });
    }
    // Refresh quietly, then open the form: the list does not flash.
    await loadAll();
    void openDetails(newUserId, email);
  }

  async function handleRemove(row: CheckerAdminRow) {
    const ok = await confirm({
      title: `Remove ${row.email} as a verifier?`,
      description: 'They will no longer be able to open the verifying screen. This does not undo any question they already verified.',
      confirmLabel: 'Remove verifier',
    });
    if (!ok) return;

    try {
      await api.removeChecker(row.user_id);
      setRows((prev) => (prev ? prev.filter((r) => r.user_id !== row.user_id) : prev));
      sonnerToast.success(`${row.email} removed`);
      if (user) {
        void recordAdminAction({
          actorId: user.id,
          actorName,
          action: 'revoke_checker',
          targetType: 'checker',
          targetId: row.user_id,
          targetLabel: row.email,
        });
      }
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error removing checker:', error);
      sonnerToast.error('Failed to remove that verifier');
    }
  }

  const states = useMemo(() => {
    const byId = profilesById(profiles);
    return (rows ?? []).map((r) => detailsState(byId.get(r.user_id), profiles !== null));
  }, [rows, profiles]);
  const needs = needDetailsCount(states);
  const activeHodCount = (hods ?? []).filter((h) => h.active).length;
  const activeReviewerCount = (reviewers ?? []).filter((r) => r.active).length;

  const nav = buildAdminNav('checkers', sectionCounts);

  function setView(next: string) {
    const p = new URLSearchParams(searchParams);
    if (next === 'hods') p.set('view', 'hods');
    else p.delete('view');
    setSearchParams(p);
  }

  if (adminGuardError) return <AdminGuardErrorState onRetry={retryAdminGuard} />;

  const firstLoad = checkingAdmin || !settled;
  if (firstLoad) {
    return (
      <BentoStack className="min-h-screen bg-muted">
        <AdminHeader nav={nav} signedInEmail={dummy ? 'admin@example.com' : user?.email ?? actorName} />
        <BentoPanel fill="card" className="px-1.5 py-[18px] lg:px-1.5 lg:py-[18px]">
          <div className="px-[18px]">
            <AdminLoading shape="table" label="Loading the verifiers" />
          </div>
        </BentoPanel>
        <AdminAuditNote />
      </BentoStack>
    );
  }

  if (!isAdmin) return null;

  return (
    <BentoStack className="min-h-screen bg-muted">
      <AdminHeader nav={nav} signedInEmail={dummy ? 'admin@example.com' : user?.email ?? actorName} />
      {banner}

      <BentoPanel fill="card" className="px-1.5 py-[18px] lg:px-1.5 lg:py-[18px]">
        <div className="mb-3 px-[18px]">
          <AdminPageIntro page="checkers" />
        </div>
        <AdminTabs
          label="Verifiers, or HODs and reviewers"
          value={view}
          onChange={setView}
          className="px-[18px]"
          tabs={[
            { key: 'verifiers', label: 'Verifiers', count: rowsError && rows === null ? null : rows?.length || undefined },
            {
              key: 'hods',
              label: 'HODs and reviewers',
              count: (hodsError && hods === null) || (reviewersError && reviewers === null) ? null : activeHodCount + activeReviewerCount || undefined,
            },
          ]}
        >
          <div className="-mx-[18px]" aria-busy={busy || undefined}>
            {view === 'verifiers' ? (
              <section aria-label="Verifiers">
                <AddStudentGuide />
                <AdminPanelHeader
                  title="Verifiers"
                  subtitle={needDetailsText(needs) || undefined}
                  meta={rows ? `${rows.length} ${rows.length === 1 ? 'verifier' : 'verifiers'}` : undefined}
                />
                <PeoplePicker
                  label="Find a person to add"
                  ariaLabel="Search by name or email to add a verifier"
                  resultsLabel="People found"
                  tip="checkers.search"
                  tipLabel="the search"
                  searchUsers={api.searchUsers}
                  onAdd={handleAdd}
                  actionLabel={(u) => (u.is_checker ? 'Turn back on' : 'Add')}
                  isAlready={(u) => Boolean(u.is_checker && u.checker_active && (rows ?? []).some((r) => r.user_id === u.user_id))}
                  alreadyLabel="Already a verifier"
                />
                <VerifierListBody
                  rows={rows}
                  error={rowsError}
                  profiles={profiles}
                  openingId={openingId}
                  onRetry={() => void loadAll()}
                  onDetails={(r) => void openDetails(r.user_id, r.full_name || r.email)}
                  onRemove={(r) => void handleRemove(r)}
                />
              </section>
            ) : (
              <HodSection
                hodApi={hodApi}
                reviewerApi={reviewerApi}
                searchUsers={api.searchUsers}
                hods={hods}
                hodsError={hodsError}
                reviewers={reviewers}
                reviewersError={reviewersError}
                onReload={loadAll}
                user={dummy ? null : user}
                actorName={actorName}
              />
            )}
          </div>
        </AdminTabs>
      </BentoPanel>

      <AdminAuditNote />
      {confirmDialog}

      <AdminDialog
        open={detailsFor !== null}
        onOpenChange={(o) => {
          if (!o) setDetailsFor(null);
        }}
        title={detailsFor ? `Details for ${detailsFor.label}` : 'Verifier details'}
        size="md"
      >
        {detailsFor ? (
          <div data-testid="verifier-details-panel">
            <p className="mb-3 text-pretty text-[13px] leading-[1.5] text-warm-secondary">
              A verifier can also fill in their own details. With no details, or no grade, they still get papers with no class limit, as if they were in Class 12. Once a grade is saved, papers are never given above it. Expired details get no new papers until you renew them.
            </p>
            <VerifierProfileForm
              key={detailsFor.user_id}
              initial={detailsFor.initial}
              busy={savingDetails}
              saveLabel="Save details"
              cancelLabel="Do this later"
              onCancel={() => setDetailsFor(null)}
              onSave={(input) => {
                setSavingDetails(true);
                profileApi
                  .setProfile(detailsFor.user_id, input)
                  .then(() => {
                    sonnerToast.success('Details saved. New papers will match their grade.');
                    setDetailsFor(null);
                    void loadAll();
                  })
                  .catch((err: unknown) => {
                    const raw = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message) : '';
                    sonnerToast.error(raw || 'Could not save those details. Try again.');
                  })
                  .finally(() => setSavingDetails(false));
              }}
            />
          </div>
        ) : null}
      </AdminDialog>
    </BentoStack>
  );
}

export default function AdminCheckers() {
  if (DummyAdminCheckers && isDummyMode()) {
    return (
      <Suspense fallback={null}>
        <DummyAdminCheckers />
      </Suspense>
    );
  }
  return <AdminCheckersPage />;
}
