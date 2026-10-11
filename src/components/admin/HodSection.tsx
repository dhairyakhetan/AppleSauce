import { formatDistanceToNow } from 'date-fns';
import { toast as sonnerToast } from 'sonner';
import { ChevronDown } from 'lucide-react';
import { AdminPanelHeader, AdminStatusPill, AdminTable, type AdminTableColumn, type AdminTableRow } from '@/pages/admin/AdminTable';
import { AdminEmpty, AdminError } from '@/components/admin/AdminState';
import { PEOPLE_NO_ACCOUNT, PeoplePicker } from '@/components/admin/PeoplePicker';
import { useConfirm } from '@/components/ui/use-confirm';
import { grantHod, revokeHod } from '@/lib/hod-admin-actions';
import { addHodSteps, HOD_NOTE } from '@/lib/checker-onboarding';
import type { CheckerAdminApi } from '@/lib/checker-admin-api';
import type { HodAdminApi, HodRow } from '@/lib/hod-api';
import type { ReviewerRow, TeacherReviewerAdminApi } from '@/lib/teacher-review-api';

/* The HODs view of /admin/checkers: who leads the verifiers, and who reviews
   teachers.

   - HODs are added by email through admin_add_hod. That is one obvious
     action at the top: search, press Make HOD.
   - Teacher reviewers are listed underneath, with the same flow, through the
     existing hod_*_teacher_reviewer functions. Their grants and removals are
     audited by the database functions themselves, so this page does not write
     a second audit row for them.
   - Making or removing an HOD is audited here (grant_hod, revoke_hod).

   The lists are loaded by the page (one first-load gate for both views); this
   component only shows them and, after a change, asks the page to reload them
   quietly. */

function HodGuide() {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return (
    <details className="group mx-[18px] mb-4 rounded-2xl bg-muted" data-testid="add-hod-guide">
      <summary className="tap-44 flex cursor-pointer list-none items-center justify-between gap-2 rounded-2xl px-4 py-2.5 text-[14px] font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand [&::-webkit-details-marker]:hidden">
        How to add an HOD
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-150 group-open:rotate-180" aria-hidden />
      </summary>
      <div className="px-4 pb-3">
        <ol className="list-decimal space-y-1.5 pl-5 text-[14px] leading-snug text-foreground">
          {addHodSteps(origin).map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="mt-3 text-pretty text-[13px] leading-snug text-warm-secondary">{HOD_NOTE}</p>
      </div>
    </details>
  );
}

const when = (iso: string | null) => (iso ? formatDistanceToNow(new Date(iso), { addSuffix: true }) : 'Not recorded');

/** The HODs list, or the reason it is not there. A failed read is never "no HOD yet". */
export function HodListBody({
  hods,
  error,
  onRetry,
  onRemove,
}: {
  hods: HodRow[] | null;
  error: boolean;
  onRetry: () => void;
  onRemove: (h: HodRow) => void;
}) {
  const active = (hods ?? []).filter((h) => h.active);
  if (hods === null && error) return <AdminError what="the HOD list" onRetry={onRetry} className="mx-[18px]" />;
  if (hods === null) return <div className="mx-[18px] h-14 rounded-2xl bg-muted" aria-hidden />;
  const columns: AdminTableColumn[] = [
    { key: 'who', label: 'HOD', width: '1.6fr', hint: 'A person who leads the verifiers.' },
    { key: 'added', label: 'Added', width: '1fr', hint: 'When they became an HOD.' },
  ];
  const rows: AdminTableRow[] = active.map((h) => ({
    id: h.user_id,
    cells: [
      <div key="who" className="min-w-0">
        <p className="truncate font-semibold text-foreground">{h.name || h.email || 'Unnamed account'}</p>
        {h.name && h.email ? <p className="truncate text-[12px] text-warm-label">{h.email}</p> : null}
      </div>,
      <span key="added" className="text-warm-meta">{when(h.granted_at)}</span>,
    ],
    actions: [{ label: 'Remove', tone: 'destructive', onClick: () => onRemove(h) }],
  }));
  return (
    <>
      {error ? <AdminError what="the latest HOD list" onRetry={onRetry} detail="The list below may be out of date." className="mx-[18px] mb-3" /> : null}
      {active.length === 0 ? (
        <AdminEmpty title="No HOD yet" hint="Admins can still open the HOD desk. Search above to make someone an HOD." />
      ) : (
        <AdminTable columns={columns} rows={rows} />
      )}
    </>
  );
}

/** The teacher reviewers: who, when they were added, and whether they are active. */
export function ReviewerListBody({
  reviewers,
  error,
  onRetry,
  onRemove,
}: {
  reviewers: ReviewerRow[] | null;
  error: boolean;
  onRetry: () => void;
  onRemove: (r: ReviewerRow) => void;
}) {
  if (reviewers === null && error) return <AdminError what="the teacher reviewer list" onRetry={onRetry} className="mx-[18px]" />;
  if (reviewers === null) return <div className="mx-[18px] h-14 rounded-2xl bg-muted" aria-hidden />;
  const sorted = [...reviewers].sort((a, b) => Number(b.active) - Number(a.active));
  const columns: AdminTableColumn[] = [
    { key: 'who', label: 'Teacher reviewer', width: '1.6fr', hint: 'A person who can approve, reject and edit teachers without being an admin.' },
    { key: 'added', label: 'Added', width: '1fr', hint: 'When they were given the role.' },
    { key: 'status', label: 'Status', width: '0.8fr', hint: 'Removed people keep a record here but can no longer open the teacher review page.' },
  ];
  const rows: AdminTableRow[] = sorted.map((r) => ({
    id: r.user_id,
    cells: [
      <div key="who" className="min-w-0">
        <p className="truncate font-semibold text-foreground">{r.name || r.email || 'Unnamed account'}</p>
        {r.name && r.email ? <p className="truncate text-[12px] text-warm-label">{r.email}</p> : null}
      </div>,
      <span key="added" className="text-warm-meta">{when(r.granted_at)}</span>,
      <AdminStatusPill key="status" status={r.active ? 'live' : 'paused'} label={r.active ? 'Active' : 'Removed'} />,
    ],
    actions: r.active ? [{ label: 'Remove', tone: 'destructive', onClick: () => onRemove(r) }] : [],
  }));
  const anyActive = sorted.some((r) => r.active);
  return (
    <>
      {error ? <AdminError what="the latest reviewer list" onRetry={onRetry} detail="The list below may be out of date." className="mx-[18px] mb-3" /> : null}
      {sorted.length === 0 ? (
        <AdminEmpty title="No teacher reviewers yet" hint="Search above to give someone the role." />
      ) : (
        <>
          <AdminTable columns={columns} rows={rows} />
          {!anyActive ? <p className="px-[18px] pt-2 text-[13px] text-warm-secondary">Nobody holds the role right now.</p> : null}
        </>
      )}
    </>
  );
}

export function HodSection({
  hodApi,
  reviewerApi,
  searchUsers,
  hods,
  hodsError,
  reviewers,
  reviewersError,
  onReload,
  user,
  actorName,
}: {
  hodApi: HodAdminApi;
  reviewerApi: TeacherReviewerAdminApi;
  searchUsers: CheckerAdminApi['searchUsers'];
  hods: HodRow[] | null;
  hodsError: boolean;
  reviewers: ReviewerRow[] | null;
  reviewersError: boolean;
  /** Re-reads both lists without bringing the skeleton back. */
  onReload: () => Promise<void>;
  /** The signed-in admin, for the audit log. Null in dummy mode. */
  user: { id: string } | null;
  actorName: string;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const activeHods = (hods ?? []).filter((h) => h.active);
  const activeReviewers = (reviewers ?? []).filter((r) => r.active);

  const actor = user ? { id: user.id, name: actorName } : null;

  async function addHod(email: string) {
    try {
      await grantHod(hodApi, email, actor);
    } catch (e) {
      throw new Error(
        e instanceof Error && /no account|not found|sign up/i.test(e.message)
          ? PEOPLE_NO_ACCOUNT
          : 'Could not make that person an HOD. Check the email and try again.',
      );
    }
    sonnerToast.success(`${email} is now an HOD`);
    await onReload();
  }

  async function removeHod(h: HodRow) {
    const who = h.name ?? h.email ?? 'this person';
    const ok = await confirm({
      title: `Remove ${who} as an HOD?`,
      description: 'They will no longer be able to open the HOD desk. Decisions they already made stay as they are.',
      confirmLabel: 'Remove HOD',
    });
    if (!ok) return;
    try {
      await revokeHod(hodApi, h, actor);
    } catch {
      sonnerToast.error('Failed to remove that HOD');
      return;
    }
    sonnerToast.success(`${who} removed as an HOD`);
    await onReload();
  }

  async function addReviewer(email: string) {
    try {
      await reviewerApi.add(email);
    } catch (e) {
      throw new Error(
        e instanceof Error && /no account|not found|sign up/i.test(e.message)
          ? PEOPLE_NO_ACCOUNT
          : 'Could not make that person a teacher reviewer. Check the email and try again.',
      );
    }
    sonnerToast.success(`${email} is now a teacher reviewer`);
    // The database function writes its own audit row, so none is written here.
    await onReload();
  }

  async function removeReviewer(r: ReviewerRow) {
    const who = r.name ?? r.email ?? 'this person';
    const ok = await confirm({
      title: `Remove ${who} as a teacher reviewer?`,
      description: 'They will no longer be able to open the teacher review page. Decisions they already made stay as they are.',
      confirmLabel: 'Remove teacher reviewer',
    });
    if (!ok) return;
    try {
      await reviewerApi.remove(r.user_id);
    } catch {
      sonnerToast.error('Failed to remove that teacher reviewer');
      return;
    }
    sonnerToast.success(`${who} removed as a teacher reviewer`);
    await onReload();
  }

  return (
    <section aria-labelledby="hods-heading" data-testid="hod-section">
      <h2 id="hods-heading" className="sr-only">
        HODs and teacher reviewers
      </h2>
      <HodGuide />
      <AdminPanelHeader
        title="HODs"
        subtitle="They lead the verifiers and use the HOD desk."
        meta={hods ? `${activeHods.length} ${activeHods.length === 1 ? 'HOD' : 'HODs'}` : undefined}
      />
      <PeoplePicker
        label="Find a person to make an HOD"
        ariaLabel="Search by name or email to make an HOD"
        resultsLabel="People found for HOD"
        searchUsers={searchUsers}
        onAdd={addHod}
        actionLabel={() => 'Make HOD'}
        isAlready={(u) => activeHods.some((h) => h.user_id === u.user_id)}
        alreadyLabel="Already an HOD"
      />
      <HodListBody hods={hods} error={hodsError} onRetry={() => void onReload()} onRemove={removeHod} />

      <div className="mt-8" data-testid="reviewer-section">
        <AdminPanelHeader
          title="Teacher reviewers"
          subtitle="They approve, reject and edit teachers on the teacher review page. They cannot pause a teacher or open papers."
          meta={reviewers ? `${activeReviewers.length} active` : undefined}
        />
        <PeoplePicker
          label="Find a person to make a teacher reviewer"
          ariaLabel="Search by name or email to make a teacher reviewer"
          resultsLabel="People found for teacher reviewer"
          searchUsers={searchUsers}
          onAdd={addReviewer}
          actionLabel={() => 'Make teacher reviewer'}
          isAlready={(u) => activeReviewers.some((r) => r.user_id === u.user_id)}
          alreadyLabel="Already a teacher reviewer"
        />
        <ReviewerListBody reviewers={reviewers} error={reviewersError} onRetry={() => void onReload()} onRemove={removeReviewer} />
      </div>
      {confirmDialog}
    </section>
  );
}
