import { useCallback, useEffect, useId, useMemo, useState, lazy, Suspense, type FormEvent, type ReactNode } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { toast as sonnerToast } from 'sonner';
import { UserPlus } from 'lucide-react';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useAuth } from '@/lib/auth-context';
import { useAdminGuard, AdminGuardErrorState } from '@/components/AdminConsole';
import { AdminHeader, AdminAuditNote, buildAdminNav } from '@/pages/admin/shell';
import { AdminStack } from '@/pages/admin/embed';
import { AdminTable, AdminPanelHeader, AdminStatusPill, type AdminTableColumn, type AdminTableRow } from '@/pages/admin/AdminTable';
import { BentoPanel } from '@/components/layout/PageContainer';
import { useAdminSectionCounts } from '@/pages/admin/useAdminSectionCounts';
import { useConfirm } from '@/components/ui/use-confirm';
import { AdminDialog } from '@/components/admin/AdminDialog';
import { AdminPillButton, adminPillClass } from '@/components/admin/AdminPillButton';
import { AdminError, AdminLoading } from '@/components/admin/AdminState';
import { loadView } from '@/lib/admin-load-view';
import { looksLikeEmail } from '@/lib/email-shape';
import { realPositionsApi } from '@/lib/positions-api';
import {
  POSITIONS,
  POSITION_BY_KEY,
  changeTargets,
  changedWords,
  grantedWords,
  groupByPosition,
  positionErrorWords,
  protectedReason,
  type PositionHolder,
  type PositionKey,
  type PositionsApi,
} from '@/lib/positions';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { isDummyMode } from '@/lib/dummy-mode';
import { cn } from '@/lib/utils';

const DummyAdminPositions = PREVIEW_TOOLS ? lazy(() => import('@/dummy/AdminPositionsDummy')) : null;

/* Owner words: "allow admins to assign new emails as any position (or
   remove/change members from positions)". One section of the People tab that
   covers all four positions, so an admin no longer needs SQL to add an admin or a
   verifier.

   An email with no account yet is not an error: it is kept as a pending grant and
   applies the first time that email signs in with Google. The page says so in the
   words it shows, rather than leaving the admin to wonder.

   Remove asks first. Admins cannot remove or change themselves and nobody can
   remove the owner; the rows say why those buttons are off, and the database
   refuses the same things whatever this page does. After a change the lists
   refresh quietly: the page stays mounted and nothing jumps. */

const COLUMNS: AdminTableColumn[] = [
  { key: 'person', label: 'Person', width: '2fr' },
  { key: 'since', label: 'Since', width: '1fr' },
  { key: 'status', label: 'Status', width: '1.2fr' },
];

function personCell(h: PositionHolder, reason: string | null): ReactNode {
  return (
    <div key="person" className="min-w-0">
      <p className="truncate font-semibold text-foreground">{h.full_name || h.email}</p>
      {h.full_name ? <p className="truncate text-[12px] text-warm-label">{h.email}</p> : null}
      {reason ? <p className="mt-0.5 text-pretty text-[12px] leading-[1.4] text-warm-meta">{reason}</p> : null}
    </div>
  );
}

function statusCell(h: PositionHolder): ReactNode {
  if (h.is_pending) return <AdminStatusPill key="status" status="pending" label="Waiting for first Google sign-in" />;
  if (h.is_owner) return <AdminStatusPill key="status" status="live" label="Owner" />;
  if (h.is_you) return <AdminStatusPill key="status" status="live" label="You" />;
  return <AdminStatusPill key="status" status="live" label="Active" />;
}

/** The rows of one position. Pure, so every state can be checked. */
export function PositionGroupTable({
  holders,
  onChange,
  onRemove,
}: {
  holders: PositionHolder[];
  onChange: (h: PositionHolder) => void;
  onRemove: (h: PositionHolder) => void;
}) {
  const rows: AdminTableRow[] = holders.map((h) => {
    const reason = protectedReason(h);
    return {
      id: `${h.role}:${h.email}`,
      subject: h.email,
      cells: [
        personCell(h, reason),
        <span key="since" className="text-warm-meta">{formatDistanceToNow(new Date(h.since), { addSuffix: true })}</span>,
        statusCell(h),
      ],
      actions: [
        { label: 'Change', tone: 'muted', disabled: reason !== null, onClick: () => onChange(h) },
        { label: 'Remove', tone: 'destructive', disabled: reason !== null, onClick: () => onRemove(h) },
      ],
    };
  });
  return <AdminTable columns={COLUMNS} rows={rows} />;
}

const FIELD =
  'h-11 w-full min-w-0 rounded-full bg-muted px-4 text-sm text-foreground outline-none transition-shadow duration-150 placeholder:text-warm-label focus-visible:ring-2 focus-visible:ring-brand';

export function AdminPositionsPage({
  api = realPositionsApi,
  dummy = false,
  banner,
}: {
  api?: PositionsApi;
  dummy?: boolean;
  banner?: ReactNode;
}) {
  usePageMeta('Positions | Shikshaq Admin', 'Who is an admin, HOD, verifier or teacher reviewer, and how to add, change or remove them.');
  const { user, profile } = useAuth();
  const actorName = dummy ? 'admin@example.com' : profile?.full_name || user?.email || 'Signed-in admin';
  const uid = useId();

  const [rows, setRows] = useState<PositionHolder[] | null>(null);
  const [error, setError] = useState(false);
  const [settled, setSettled] = useState(false);
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<PositionKey>('verifier');
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [changing, setChanging] = useState<PositionHolder | null>(null);
  const [changeTo, setChangeTo] = useState<PositionKey | null>(null);
  const [changeBusy, setChangeBusy] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);

  const { confirm, confirmDialog } = useConfirm();

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setRows(await api.list());
      setError(false);
    } catch (e) {
      if (import.meta.env.DEV) console.error('Error loading positions:', e);
      setError(true);
    } finally {
      setSettled(true);
      setBusy(false);
    }
  }, [api]);

  const guard = useAdminGuard(dummy ? null : user, { onGranted: () => void load(), redirectOnDenied: !dummy });
  const isAdmin = dummy ? true : guard.isAdmin;
  const checkingAdmin = dummy ? false : guard.checkingAdmin;
  const { error: adminGuardError, retry: retryAdminGuard } = guard;
  useEffect(() => {
    if (dummy) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dummy]);
  const sectionCounts = useAdminSectionCounts();

  const groups = useMemo(() => groupByPosition(rows ?? []), [rows]);
  const targets = useMemo(() => (changing ? changeTargets(rows ?? [], changing.email, changing.role) : []), [rows, changing]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!looksLikeEmail(trimmed)) {
      setFormError('Enter a full email address, like name@example.com.');
      return;
    }
    setFormError(null);
    setAdding(true);
    try {
      const result = await api.grant(trimmed, role);
      sonnerToast.success(grantedWords(result, trimmed.toLowerCase(), role));
      setEmail('');
      await load();
    } catch (err) {
      if (import.meta.env.DEV) console.error('Error adding to a position:', err);
      setFormError(positionErrorWords(err, 'Could not add that email. Nothing was changed. Try again.'));
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(h: PositionHolder) {
    const label = POSITION_BY_KEY[h.role].label;
    const lower = label.toLowerCase();
    const ok = await confirm({
      title: h.is_pending ? `Cancel the pending ${lower} grant for ${h.email}?` : `Remove ${h.email} as ${/^[aeiou]/.test(lower) ? 'an' : 'a'} ${lower}?`,
      description: h.is_pending
        ? 'Nothing is given when they sign in. You can add them again later.'
        : 'They lose this access straight away. Anything they already did stays.',
      confirmLabel: h.is_pending ? 'Cancel the grant' : `Remove ${lower}`,
    });
    if (!ok) return;
    try {
      await api.revoke(h.email, h.role);
      sonnerToast.success(h.is_pending ? `The pending grant for ${h.email} was cancelled.` : `${h.email} is no longer a ${lower}.`);
      await load();
    } catch (err) {
      if (import.meta.env.DEV) console.error('Error removing from a position:', err);
      sonnerToast.error(positionErrorWords(err, 'Could not remove them. Nothing was changed. Try again.'));
    }
  }

  function openChange(h: PositionHolder) {
    const options = changeTargets(rows ?? [], h.email, h.role);
    setChanging(h);
    setChangeTo(options[0]?.key ?? null);
    setChangeError(null);
  }

  async function submitChange() {
    if (!changing || !changeTo) return;
    setChangeBusy(true);
    setChangeError(null);
    try {
      const result = await api.change(changing.email, changing.role, changeTo);
      sonnerToast.success(changedWords(result, changing.email, changeTo));
      setChanging(null);
      await load();
    } catch (err) {
      if (import.meta.env.DEV) console.error('Error changing a position:', err);
      setChangeError(positionErrorWords(err, 'Could not change that. Nothing was changed. Try again.'));
    } finally {
      setChangeBusy(false);
    }
  }

  const nav = buildAdminNav('positions', sectionCounts);
  const signedIn = dummy ? 'admin@example.com' : user?.email ?? actorName;

  if (adminGuardError) return <AdminGuardErrorState onRetry={retryAdminGuard} />;

  if (checkingAdmin || !settled) {
    return (
      <AdminStack>
        <AdminHeader nav={nav} signedInEmail={signedIn} />
        <BentoPanel fill="card" className="px-1.5 py-[18px] lg:px-1.5 lg:py-[18px]">
          <div className="px-[18px]">
            <AdminLoading shape="table" label="Loading who holds each position" />
          </div>
        </BentoPanel>
        <AdminAuditNote />
      </AdminStack>
    );
  }
  if (!isAdmin) return null;

  const view = loadView({ settled, error, count: rows?.length ?? 0 });
  const total = rows?.length ?? 0;
  const pendingCount = (rows ?? []).filter((r) => r.is_pending).length;

  return (
    <AdminStack>
      <AdminHeader nav={nav} signedInEmail={signedIn} />
      {banner}

      <BentoPanel fill="card" className="px-1.5 py-[18px] lg:px-1.5 lg:py-[18px]">
        <AdminPanelHeader
          title="Positions"
          subtitle="Add an email to a position, change someone to another position, or remove them. Every change is recorded under Admin actions."
          meta={view === 'list' ? `${total} ${total === 1 ? 'entry' : 'entries'}${pendingCount ? `, ${pendingCount} waiting` : ''}` : undefined}
        />

        <form onSubmit={(e) => void handleAdd(e)} className="mb-5 px-[18px]" aria-label="Add an email to a position" noValidate>
          <div className="flex max-w-3xl flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex min-w-0 flex-1 flex-col gap-1" htmlFor={`${uid}-email`}>
              <span className="text-[12px] font-semibold text-warm-secondary">Email</span>
              <input
                id={`${uid}-email`}
                type="email"
                inputMode="email"
                autoComplete="off"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setFormError(null);
                }}
                placeholder="name@example.com"
                className={FIELD}
              />
            </label>
            <label className="flex flex-col gap-1 sm:w-56" htmlFor={`${uid}-role`}>
              <span className="text-[12px] font-semibold text-warm-secondary">Position</span>
              <select id={`${uid}-role`} value={role} onChange={(e) => setRole(e.target.value as PositionKey)} className={cn(FIELD, 'appearance-auto')}>
                {POSITIONS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={adding || !email.trim()}
              className={cn(adminPillClass('primary', 'md'), 'shrink-0 bg-brand text-foreground disabled:opacity-50')}
            >
              <UserPlus className="h-4 w-4" aria-hidden />
              {adding ? 'Adding...' : 'Add'}
            </button>
          </div>
          <p className="mt-1.5 max-w-3xl text-pretty text-[12px] leading-[1.5] text-warm-meta">
            {POSITION_BY_KEY[role].does} No account yet? That is fine: they get it the first time they sign in with Google using this email.
          </p>
          {formError ? (
            <p role="alert" className="mt-2 text-[13px] text-destructive">
              {formError}
            </p>
          ) : null}
        </form>

        <div aria-busy={busy || undefined}>
          {view === 'skeleton' ? <AdminLoading shape="table" label="Loading who holds each position" /> : null}
          {view === 'error' ? <AdminError what="the list of positions" onRetry={() => void load()} className="mx-[18px]" /> : null}
          {view === 'empty' ? <p className="px-[18px] text-[13px] text-warm-secondary">Nobody holds a position yet.</p> : null}
          {view === 'list' ? (
            <>
              {error ? <AdminError what="the latest positions" onRetry={() => void load()} detail="The lists below may be out of date." className="mx-[18px] mb-3" /> : null}
              {POSITIONS.map((p) => (
                <section key={p.key} aria-label={p.plural} className="mb-6 last:mb-0">
                  <div className="px-[18px] pb-1">
                    <h3 className="text-[15px] font-bold text-foreground">
                      {p.plural} <span className="font-semibold tabular-nums text-warm-meta">{groups[p.key].length}</span>
                    </h3>
                    <p className="text-[13px] text-warm-secondary">{p.does}</p>
                  </div>
                  {groups[p.key].length === 0 ? (
                    <p className="px-[18px] py-2 text-[13px] text-warm-meta">Nobody holds this position yet.</p>
                  ) : (
                    <PositionGroupTable holders={groups[p.key]} onChange={openChange} onRemove={(h) => void handleRemove(h)} />
                  )}
                </section>
              ))}
            </>
          ) : null}
        </div>
      </BentoPanel>

      <AdminAuditNote />
      {confirmDialog}

      <AdminDialog
        open={changing !== null}
        onOpenChange={(o) => {
          if (!o && !changeBusy) setChanging(null);
        }}
        title={changing ? `Change position for ${changing.email}` : 'Change position'}
        description="Their current position is replaced by the one you pick, in one step. If the new one cannot be given, nothing changes."
        size="sm"
        footer={
          <>
            <AdminPillButton variant="secondary" size="sm" onClick={() => setChanging(null)} disabled={changeBusy}>
              Cancel
            </AdminPillButton>
            <AdminPillButton variant="primary" size="sm" onClick={() => void submitChange()} busy={changeBusy} disabled={!changeTo} className="bg-brand text-foreground">
              {changeBusy ? 'Changing...' : 'Change position'}
            </AdminPillButton>
          </>
        }
      >
        {changing ? (
          <fieldset className="mt-1">
            <legend className="mb-2 text-[13px] text-warm-secondary">
              Now: <span className="font-bold text-foreground">{POSITION_BY_KEY[changing.role].label}</span>. Change to:
            </legend>
            {targets.length === 0 ? (
              <p className="text-[13px] text-warm-secondary">They already hold every other position.</p>
            ) : (
              <div className="space-y-1.5">
                {targets.map((p) => (
                  <label key={p.key} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl bg-muted px-3 py-2.5">
                    <input
                      type="radio"
                      name={`${uid}-to`}
                      value={p.key}
                      checked={changeTo === p.key}
                      onChange={() => setChangeTo(p.key)}
                      className="mt-1 h-4 w-4 accent-[#1a1a1a]"
                    />
                    <span>
                      <span className="block text-[14px] font-bold text-foreground">{p.label}</span>
                      <span className="block text-[12px] leading-[1.4] text-warm-secondary">{p.does}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
            {changeError ? (
              <p role="alert" className="mt-3 text-[13px] text-destructive">
                {changeError}
              </p>
            ) : null}
          </fieldset>
        ) : null}
      </AdminDialog>
    </AdminStack>
  );
}

export default function AdminPositions() {
  if (DummyAdminPositions && isDummyMode()) {
    return (
      <Suspense fallback={null}>
        <DummyAdminPositions />
      </Suspense>
    );
  }
  return <AdminPositionsPage />;
}
