import { useEffect, useRef, type KeyboardEvent } from 'react';
import { toast } from 'sonner';
import { Link, useNavigate } from 'react-router-dom';
import { Logo } from '@/components/Logo';
import { BentoPanel } from '@/components/layout/PageContainer';
import { cn } from '@/lib/utils';
import { useAdminDebugToggle } from '@/lib/admin-debug';
import { AdminDebugToggle } from '@/components/DebugId';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ADMIN_TABS, adminHref, tabOfPage, type AdminPageKey, type AdminTabKey } from '@/lib/admin-hints';
import { adminPrefetchProps } from '@/lib/admin-prefetch';
import { CHIP } from '@/lib/checker-button-styles';
import { supabase } from '@/integrations/supabase/client';
import { setAdminConfirmed } from '@/lib/admin-confirmed';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { isDummyMode } from '@/lib/dummy-mode';
import { useAdminCountsState, type AdminCountField, type AdminCountsState } from '@/pages/admin/useAdminSectionCounts';
import { useAdminEmbedded } from '@/pages/admin/embed';

/* The admin shell: the header every admin screen opens with.

   The Admin page is laid out like the HOD desk (/hod): a title row, a row of
   pill tabs, and the tab's content under it. Four tabs:

     People    verifiers, HODs, teacher reviewers, how far the verifiers got
     Teachers  applications, reviews, listed teachers
     Logs      question changes, checker activity, admin actions
     System    the pipeline page, visitor feedback

   Papers are not here. Everything about getting a paper checked and live is on
   the HOD desk, which admins open too; the "HOD desk" chip carries its count.

   Two ways to draw the tab row:
     AdminTabBar     real tabs (role="tab"), used by the Admin page itself. The
                     choice lives in the address as ?tab=, like the HOD desk.
     AdminHeader     a header with the same four tabs as links, for the few
                     screens that still sit on their own address (a paper being
                     edited, one verifier's days). Draws nothing inside a section
                     of the Admin page, which already has its own header.

   Badges: a real number shows, 0 shows nothing, an unreadable count shows a
   muted "?" and a "Counts unavailable. Retry" button appears. */

export interface AdminNavItem {
  key: AdminTabKey;
  label: string;
  path: string;
  /** The tab's tooltip. */
  short: string;
  /** A real count. A page passes it only to override the shared one; leave it
   *  off and the header fills it from the shared counts. `0` shows no badge. */
  count?: number;
  active: boolean;
}

export const isAdminPath = (path: string): boolean => path === '/admin' || path.startsWith('/admin/') || path.startsWith('/admin?');

/** Which shared counts add up to which tab's badge. Tabs not listed have none. */
export const TAB_COUNT_FIELDS: Partial<Record<AdminTabKey, AdminCountField[]>> = {
  teachers: ['approvals', 'reviews'],
};

/** The counts that add up to the HOD desk chip: everything about papers. */
export const HOD_COUNT_FIELDS: AdminCountField[] = ['paperApprovals', 'adminQueue', 'submissions'];

export type NavBadge = { kind: 'n'; n: number } | { kind: 'unknown' } | null;

/** The sum of some counts. 0 shows nothing; a field that could not be read is
 *  unknown ("?") unless something else already gave a real number; a field
 *  still loading is quiet. */
export function sumBadge(fields: AdminCountField[], state: Pick<AdminCountsState, 'counts' | 'failed'>): NavBadge {
  let sum = 0;
  let unknown = false;
  for (const f of fields) {
    const n = state.counts[f];
    if (typeof n === 'number') sum += n;
    else if (state.failed.includes(f)) unknown = true;
  }
  if (sum > 0) return { kind: 'n', n: sum };
  return unknown ? { kind: 'unknown' } : null;
}

/** The badge on one tab. A count a page passed in wins over the shared ones. */
export function navBadge(item: Pick<AdminNavItem, 'key' | 'count'>, state: Pick<AdminCountsState, 'counts' | 'failed'>): NavBadge {
  const fields = TAB_COUNT_FIELDS[item.key];
  if (!fields) return null;
  if (typeof item.count === 'number') return item.count > 0 ? { kind: 'n', n: item.count } : null;
  return sumBadge(fields, state);
}

/** The badge on the HOD desk chip: papers waiting on a person. */
export function hodBadge(state: Pick<AdminCountsState, 'counts' | 'failed'>): NavBadge {
  return sumBadge(HOD_COUNT_FIELDS, state);
}

export interface AdminHeaderProps {
  nav: AdminNavItem[];
  /** Signed-in staff email, shown in the account menu. */
  signedInEmail: string;
  className?: string;
  /** Override the shared counts (tests, the sandbox). Omit to read them live. */
  counts?: AdminCountsState;
}

function Badge({ badge, on }: { badge: NonNullable<NavBadge>; on: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-full px-[5px] text-[11px] font-bold tabular-nums',
        badge.kind === 'unknown' ? 'bg-card text-warm-secondary' : on ? 'bg-brand text-foreground' : 'bg-card text-warm-secondary',
      )}
      {...(badge.kind === 'unknown' ? { title: 'Count unavailable' } : {})}
    >
      {badge.kind === 'unknown' ? (
        <>
          <span aria-hidden>?</span>
          <span className="sr-only">count unavailable</span>
        </>
      ) : (
        <>
          {badge.n}
          <span className="sr-only"> waiting</span>
        </>
      )}
    </span>
  );
}

/** Shown under the tabs when any count could not be read. */
export function CountsRetry({ onRetry }: { onRetry: () => void }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      className="mt-1 inline-flex min-h-10 items-center whitespace-nowrap rounded-full px-3 text-[13px] font-bold text-brand-blue hover:bg-brand-blue-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      Counts unavailable. Retry
    </button>
  );
}

/** The same pill row as the HOD desk's tab row. One row, never a wrap: when the
 *  tabs are wider than the card, the row scrolls sideways. */
export const TAB_ROW =
  'relative flex w-max max-w-full items-center gap-1 overflow-x-auto rounded-full bg-muted p-1 scrollbar-hide';

export const TAB_PILL =
  'flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';

export const tabPillTone = (on: boolean) => (on ? 'bg-card text-foreground' : 'text-warm-secondary hover:text-foreground');

/** The account disc: first letter of the email, opening a menu with the full
 *  email, a way back to the site, and Sign out (not offered in dummy mode,
 *  where nobody is signed in). */
function AccountMenu({ email }: { email: string }) {
  const navigate = useNavigate();
  const canSignOut = !(PREVIEW_TOOLS && isDummyMode());
  const initial = email.trim().charAt(0).toUpperCase() || 'A';
  async function signOut() {
    // Stop the nav counts and forget who was confirmed before the session goes.
    setAdminConfirmed(null);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch {
      // Stay on the page: going home while still signed in would look like it worked.
      toast.error('Could not sign you out. Check your connection and try again.');
      return;
    }
    navigate('/');
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account menu for ${email}`}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-[15px] font-bold text-foreground transition-colors duration-150 hover:bg-warm-hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {initial}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 rounded-2xl bg-card p-1.5">
        <DropdownMenuLabel className="break-all px-3 py-2 text-[13px] font-semibold text-warm-secondary">{email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="min-h-10 cursor-pointer rounded-xl px-3 text-[14px] font-semibold">
          <Link to="/">Back to the site</Link>
        </DropdownMenuItem>
        {canSignOut ? (
          <DropdownMenuItem onSelect={() => void signOut()} className="min-h-10 cursor-pointer rounded-xl px-3 text-[14px] font-semibold">
            Sign out
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Logo, the Admin chip, the HOD desk chip with its count, and the account menu. */
export function AdminTopRow({ signedInEmail, counts, asHeading = false }: { signedInEmail: string; counts: AdminCountsState; asHeading?: boolean }) {
  const debug = useAdminDebugToggle();
  const hod = hodBadge(counts);
  const Chip = asHeading ? 'h1' : 'span';
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <Logo size="sm" className="tap-44" />
        <Chip className="inline-flex h-6 items-center rounded-lg bg-muted px-[9px] text-[12px] font-bold uppercase tracking-[.04em] text-warm-secondary">
          Admin
        </Chip>
        {/* Owner, 2026-09-28: admin-only debug mode -- shows teacher/paper/
            question/audit ids on screen. Never rendered for a non-admin
            (AdminDebugToggle itself returns null when canToggle is false). */}
        <AdminDebugToggle on={debug.on} canToggle={debug.canToggle} toggle={debug.toggle} />
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <Link
          to="/hod"
          title="Papers: questions that need a person, papers ready to go live, student uploads and live papers"
          {...adminPrefetchProps('/hod')}
          className={cn(CHIP, 'gap-1.5 bg-muted text-warm-secondary hover:bg-warm-hairline')}
        >
          HOD desk
          {hod ? <Badge badge={hod} on={false} /> : null}
        </Link>
        <span className="hidden max-w-[220px] truncate text-[13px] text-warm-secondary lg:inline">{signedInEmail}</span>
        <AccountMenu email={signedInEmail} />
      </div>
    </div>
  );
}

/** The four tabs as real tabs. The Admin page owns the state (the address's
 *  ?tab=) and passes the same keyboard handling the HOD desk has. */
export function AdminTabBar({
  items,
  activeKey,
  counts,
  onSelect,
  onKeyDown,
  registerTab,
}: {
  items: AdminNavItem[];
  activeKey: AdminTabKey;
  counts: AdminCountsState;
  onSelect: (key: AdminTabKey) => void;
  onKeyDown: (ev: KeyboardEvent<HTMLButtonElement>) => void;
  registerTab?: (key: AdminTabKey, el: HTMLButtonElement | null) => void;
}) {
  // The row scrolls on narrow screens: keep the selected tab in view (horizontally only).
  const rowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const row = rowRef.current;
    const el = row?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!row || !el) return;
    const left = el.offsetLeft;
    const right = left + el.offsetWidth;
    if (left >= row.scrollLeft && right <= row.scrollLeft + row.clientWidth) return;
    const target = left - (row.clientWidth - el.offsetWidth) / 2;
    row.scrollTo({ left: Math.max(0, Math.min(target, row.scrollWidth - row.clientWidth)), behavior: 'auto' });
  }, [activeKey, counts]);
  return (
    <div ref={rowRef} role="tablist" aria-label="Admin" className={TAB_ROW}>
      {items.map((t) => {
        const on = t.key === activeKey;
        const badge = navBadge(t, counts);
        return (
          <button
            key={t.key}
            ref={(el) => registerTab?.(t.key, el)}
            type="button"
            role="tab"
            id={`admin-tab-${t.key}`}
            aria-selected={on}
            aria-controls="admin-panel"
            tabIndex={on ? 0 : -1}
            title={t.short}
            onClick={() => onSelect(t.key)}
            onKeyDown={onKeyDown}
            className={cn(TAB_PILL, tabPillTone(on))}
          >
            {t.label}
            {badge ? <Badge badge={badge} on={on} /> : null}
          </button>
        );
      })}
    </div>
  );
}

/** The header BentoPanel (logo, Admin chip, HOD desk chip, account menu) with
 *  the four tabs as links under it. Reads the shared counts itself, so a page
 *  does not have to pass any. Nothing is drawn inside a section of the Admin
 *  page. */
export function AdminHeader(props: AdminHeaderProps) {
  const live = useAdminCountsState();
  const embedded = useAdminEmbedded();
  if (embedded) return null;
  return <AdminHeaderView {...props} counts={props.counts ?? live} />;
}

export function AdminHeaderView({ nav, signedInEmail, className, counts }: AdminHeaderProps & { counts: AdminCountsState }) {
  const countsBroken = counts.status === 'error' || counts.status === 'partial';
  return (
    <BentoPanel fill="card" edge="top" className={cn('px-4 py-[14px] sm:px-6 sm:py-[18px] lg:px-6 lg:py-[18px]', className)}>
      <AdminTopRow signedInEmail={signedInEmail} counts={counts} />
      <nav aria-label="Admin sections" className="mt-3 sm:mt-4">
        <ul className={TAB_ROW} aria-label="Tabs">
          {nav.map((item) => {
            const badge = navBadge(item, counts);
            return (
              <li key={item.key} className="contents">
                <Link
                  to={item.path}
                  aria-current={item.active ? 'page' : undefined}
                  title={item.short}
                  className={cn(TAB_PILL, tabPillTone(item.active))}
                >
                  {item.label}
                  {badge ? <Badge badge={badge} on={item.active} /> : null}
                </Link>
              </li>
            );
          })}
        </ul>
        {countsBroken ? <CountsRetry onRetry={counts.refetch} /> : null}
      </nav>
    </BentoPanel>
  );
}

export type AdminSectionKey = AdminPageKey | AdminTabKey;

export interface AdminNavCounts {
  /** Teacher applications waiting. */
  approvals?: number;
  /** Teacher reviews waiting. */
  reviews?: number;
  /** Papers waiting to go live (shown on the HOD desk chip, not on a tab). */
  paperApprovals?: number;
  adminQueue?: number;
  submissions?: number;
}

/** The four tabs, each with its one-line description from admin-hints.ts. Every
 *  screen builds its nav through this one function so labels, order and
 *  descriptions cannot drift between pages. `active` is a tab or a page; a page
 *  that moved to the HOD desk activates no tab. A count passed here overrides
 *  the shared one; leave it off and AdminHeader fills it. */
export function buildAdminNav(active: AdminSectionKey, counts: AdminNavCounts = {}): AdminNavItem[] {
  const activeTab: AdminTabKey | null = ADMIN_TABS.some((t) => t.key === active)
    ? (active as AdminTabKey)
    : (tabOfPage(active as AdminPageKey)?.key ?? null);
  const teacherCount =
    counts.approvals === undefined && counts.reviews === undefined ? undefined : (counts.approvals ?? 0) + (counts.reviews ?? 0);
  return ADMIN_TABS.map((t) => ({
    key: t.key,
    label: t.label,
    path: adminHref(t.key),
    short: t.hint,
    count: t.key === 'teachers' ? teacherCount : undefined,
    active: t.key === activeTab,
  }));
}

/** The note that closes a section's content: every change is logged. Draws
 *  nothing inside a section of the Admin page, which has it once at the foot. */
export function AdminAuditNote({ className }: { className?: string }) {
  const embedded = useAdminEmbedded();
  if (embedded) return null;
  return <AdminAuditFooter className={className} />;
}

export function AdminAuditFooter({ className }: { className?: string }) {
  return (
    <BentoPanel
      fill="muted"
      edge="bottom"
      className={cn('flex flex-wrap items-center justify-between gap-2 px-6 py-4 lg:px-6 lg:py-4', className)}
    >
      <span className="text-[13px] text-warm-secondary">
        Every action is written to the audit log with your account and a timestamp.
      </span>
      <Link to={adminHref('logs', 'admin-actions')} className="tap-44 text-[13px] font-bold text-brand-blue hover:text-brand-blue-deep">
        Open audit log
      </Link>
    </BentoPanel>
  );
}
