import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ExternalLink, Map as MapIcon } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { BentoPanel } from '@/components/layout/PageContainer';
import { cn } from '@/lib/utils';
import { useAdminDebugToggle } from '@/lib/admin-debug';
import { AdminDebugToggle } from '@/components/DebugId';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ADMIN_GROUPS, ADMIN_PAGES, type AdminGroupKey, type AdminPageKey } from '@/lib/admin-hints';
import { adminPrefetchProps } from '@/lib/admin-prefetch';
import { supabase } from '@/integrations/supabase/client';
import { setAdminConfirmed } from '@/lib/admin-confirmed';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { isDummyMode } from '@/lib/dummy-mode';
import { useAdminCountsState, type AdminCountField, type AdminCountsState } from '@/pages/admin/useAdminSectionCounts';

/* Handoff 09i AD-001/AD-002/AD-002a — the admin shell.

   Replaces the old S7 "Redesign Admin.dc.html" rail + toolbar (a 244px
   fixed near-black sidebar, desktop-only) with the actual handoff spec:
   admin opts OUT of the bento tilt/sticker/eyes/footer/bottom-nav language
   but opts IN to the panel radius, bone/bg-card fills, type scale and a
   pill tab row (AD-001). One bg-card BentoPanel (edge="top", square top /
   rounded bottom) holds the logo + Admin chip + account menu row and the pill
   rows underneath it.

   Admin rework, Batch 1:
   - six groups by job (Needs you, Papers, People, Teachers, Logs, System)
   - each pill row is ONE line that scrolls sideways on a phone and wraps from
     `sm` up; the group blurb paragraph is gone (it lives in the pill's title
     and the Map); a group with a single page shows no second row
   - links that leave the admin carry an arrow and a hidden "opens outside the
     admin" label, and sit last in their group
   - badges: a real number shows, 0 shows nothing, an unreadable count shows a
     muted "?" and a "Counts unavailable. Retry" button appears
   - an account menu replaces the blank avatar disc: email, Back to the site,
     Sign out */

export interface AdminNavItem {
  key: AdminPageKey;
  label: string;
  path: string;
  /** One line about the page, shown on hover and in the map of the admin. */
  short: string;
  group: AdminGroupKey;
  /** A real count. A page passes it only to override the shared one; leave it
   *  off and the header fills it from the shared counts. `0` shows no badge. */
  count?: number;
  active: boolean;
}

/** Where a group tab goes: its first page that lives inside the admin. A page
 *  such as the student screen (/checker) sits outside the admin shell, so a
 *  group tab that led there would drop the admin out of the menu altogether. */
export const isAdminPath = (path: string): boolean => path === '/admin' || path.startsWith('/admin/');
export function groupLandingPath(nav: AdminNavItem[], group: AdminGroupKey): string {
  const inGroup = nav.filter((n) => n.group === group);
  return (inGroup.find((n) => isAdminPath(n.path)) ?? inGroup[0])?.path ?? '/admin';
}

/** Which shared count belongs to which page. Pages not listed have no badge. */
export const COUNT_FIELD_OF: Partial<Record<AdminPageKey, AdminCountField>> = {
  ready: 'paperApprovals',
  'admin-queue': 'adminQueue',
  submissions: 'submissions',
  applications: 'approvals',
  reviews: 'reviews',
};

export type NavBadge = { kind: 'n'; n: number } | { kind: 'unknown' } | null;

/** The badge for one page. A number above 0 shows; 0 shows nothing; a count
 *  that failed to load is unknown ("?"); a count still loading shows nothing. */
export function navBadge(item: Pick<AdminNavItem, 'key' | 'count'>, state: Pick<AdminCountsState, 'counts' | 'failed'>): NavBadge {
  const field = COUNT_FIELD_OF[item.key];
  if (!field) return null;
  const n = typeof item.count === 'number' ? item.count : state.counts[field];
  if (typeof n === 'number') return n > 0 ? { kind: 'n', n } : null;
  return state.failed.includes(field) ? { kind: 'unknown' } : null;
}

/** The badge on a group tab: the sum of its pages' known counts. The "Needs
 *  you" tab sums every queue. All pages unreadable and nothing known gives "?". */
export function groupBadge(nav: AdminNavItem[], group: AdminGroupKey, state: Pick<AdminCountsState, 'counts' | 'failed'>): NavBadge {
  const items = group === 'now' ? nav : nav.filter((n) => n.group === group);
  let sum = 0;
  let unknown = false;
  for (const item of items) {
    const b = navBadge(item, state);
    if (b?.kind === 'n') sum += b.n;
    else if (b?.kind === 'unknown') unknown = true;
  }
  if (sum > 0) return { kind: 'n', n: sum };
  return unknown ? { kind: 'unknown' } : null;
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

/** Shown at the end of the group row when any count could not be read. */
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

/** Scrolls the active pill to the middle of its single-line row on a phone. */
function useScrollActiveIntoView(activeKey: string, layoutKey: string) {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const run = () => {
      const list = ref.current;
      const el = list?.querySelector<HTMLElement>('[aria-current]');
      if (!list || !el || list.scrollWidth <= list.clientWidth) return;
      list.scrollTo({ left: Math.max(0, el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2) });
    };
    run();
    // The pills change width when the web font arrives and when badges fill in,
    // so measure again once those have settled.
    void document.fonts?.ready.then(run).catch(() => undefined);
    const t = window.setTimeout(run, 400);
    return () => window.clearTimeout(t);
  }, [activeKey, layoutKey]);
  return ref;
}

const SCROLLER =
  'flex flex-nowrap items-center gap-1.5 overflow-x-auto overscroll-x-contain pr-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden snap-x snap-proximity [mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)] sm:flex-wrap sm:overflow-visible sm:pr-0 sm:[mask-image:none]';

const PILL =
  'relative inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-[14px] sm:px-4 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

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
      await supabase.auth.signOut();
    } catch {
      // Signing out locally is still the right outcome if the call fails.
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

/** The header BentoPanel (logo, Admin chip, account menu) with a two level
 *  nav inside it: six labelled groups, and under them the active group's
 *  pages. Each page link carries its one-line description (hover and screen
 *  readers), and "Map of the admin" lists every page with its line. Reads the
 *  shared counts itself, so a page does not have to pass any. */
export function AdminHeader(props: AdminHeaderProps) {
  const live = useAdminCountsState();
  return <AdminHeaderView {...props} counts={props.counts ?? live} />;
}

export function AdminHeaderView({ nav, signedInEmail, className, counts }: AdminHeaderProps & { counts: AdminCountsState }) {
  const debug = useAdminDebugToggle();
  const [mapOpen, setMapOpen] = useState(false);
  const activeItem = nav.find((n) => n.active);
  const activeGroup = (activeItem?.group ?? 'now') as AdminGroupKey;
  const pagesOfActive = nav.filter((n) => n.group === activeGroup);
  const activeCopy = ADMIN_GROUPS.find((g) => g.key === activeGroup);
  const groupsRef = useScrollActiveIntoView(activeGroup, counts.status);
  const pagesRef = useScrollActiveIntoView(activeItem?.key ?? '', counts.status);
  const countsBroken = counts.status === 'error' || counts.status === 'partial';
  return (
    <BentoPanel fill="card" edge="top" className={cn('px-4 py-[14px] sm:px-6 sm:py-[18px] lg:px-6 lg:py-[18px]', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <Logo size="sm" className="tap-44" />
          <span className="inline-flex h-6 items-center rounded-lg bg-muted px-[9px] text-[12px] font-bold uppercase tracking-[.04em] text-warm-secondary">
            Admin
          </span>
          {/* Owner, 2026-09-28: admin-only debug mode -- shows teacher/paper/
              question/audit ids on screen. Never rendered for a non-admin
              (AdminDebugToggle itself returns null when canToggle is false). */}
          <AdminDebugToggle on={debug.on} canToggle={debug.canToggle} toggle={debug.toggle} />
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="hidden max-w-[220px] truncate text-[13px] text-warm-secondary lg:inline">{signedInEmail}</span>
          <AccountMenu email={signedInEmail} />
        </div>
      </div>

      <nav aria-label="Admin sections" className="mt-3 sm:mt-4">
        <div className="flex items-center gap-1">
          <ul className={cn(SCROLLER, 'min-w-0 flex-1')} ref={groupsRef} aria-label="Groups">
            {ADMIN_GROUPS.map((g) => {
              const on = g.key === activeGroup;
              const badge = groupBadge(nav, g.key, counts);
              const to = groupLandingPath(nav, g.key);
              return (
                <li key={g.key} className="shrink-0 snap-start">
                  <Link
                    to={to}
                    aria-current={on ? 'true' : undefined}
                    title={g.blurb}
                    {...adminPrefetchProps(to)}
                    className={cn(PILL, on ? 'bg-panel font-bold text-background' : 'bg-muted font-semibold text-warm-secondary hover:bg-warm-hairline')}
                  >
                    {g.label}
                    {badge ? <Badge badge={badge} on={on} /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            aria-expanded={mapOpen}
            aria-controls="admin-map"
            aria-label="Map of the admin"
            onClick={() => setMapOpen((v) => !v)}
            className="inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] font-semibold text-brand-blue transition-colors duration-150 hover:bg-brand-blue-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MapIcon className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Map of the admin</span>
          </button>
        </div>

        {/* Under the group row, not inside its scroller, so on a phone it is
            seen without scrolling sideways. */}
        {countsBroken ? <CountsRetry onRetry={counts.refetch} /> : null}

        {pagesOfActive.length > 1 ? (
          <ul className={cn(SCROLLER, 'mt-2')} ref={pagesRef} aria-label={`${activeCopy?.label ?? ''} pages`}>
            {pagesOfActive.map((item) => {
              const outside = !isAdminPath(item.path);
              const badge = navBadge(item, counts);
              return (
                <li key={item.key} className="shrink-0 snap-start">
                  <Link
                    to={item.path}
                    aria-current={item.active ? 'page' : undefined}
                    title={outside ? `${item.short} (opens outside the admin)` : item.short}
                    {...adminPrefetchProps(item.path)}
                    className={cn(
                      PILL,
                      item.active
                        ? 'bg-brand-blue-subtle font-bold text-foreground shadow-[inset_0_0_0_1.5px_hsl(var(--foreground))]'
                        : 'bg-muted font-semibold text-warm-secondary hover:bg-warm-hairline',
                    )}
                  >
                    {item.label}
                    {outside ? (
                      <>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span className="sr-only">(opens outside the admin)</span>
                      </>
                    ) : null}
                    {badge ? <Badge badge={badge} on={item.active} /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}

        {mapOpen ? (
          <div id="admin-map" className="mt-3 grid gap-3 rounded-[18px] bg-muted p-4 sm:grid-cols-2 lg:grid-cols-3">
            {ADMIN_GROUPS.map((g) => (
              <div key={g.key}>
                <p className="text-[11px] font-bold uppercase tracking-[.06em] text-warm-label">{g.label}</p>
                <ul className="mt-1.5 space-y-1">
                  {nav
                    .filter((n) => n.group === g.key)
                    .map((n) => (
                      <li key={n.key}>
                        <Link
                          to={n.path}
                          onClick={() => setMapOpen(false)}
                          className="block min-h-10 rounded-xl py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="text-[14px] font-bold text-foreground">{n.label}</span>
                          <span className="block text-[13px] leading-[1.45] text-warm-secondary">{n.short}</span>
                        </Link>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
      </nav>
    </BentoPanel>
  );
}

export type AdminSectionKey = AdminPageKey;

export interface AdminNavCounts {
  /** Teacher applications waiting. */
  approvals?: number;
  /** Teacher reviews waiting. */
  reviews?: number;
  /** Papers waiting in Ready to go live. */
  paperApprovals?: number;
  /** Questions waiting in the Admin queue. */
  adminQueue?: number;
  /** Student uploads waiting. */
  submissions?: number;
}

/** The fixed tab set, in six groups, each page with its one-line description
 *  from admin-hints.ts. Every section page builds its nav through this one
 *  function so labels, order and descriptions can't drift between pages. A
 *  count passed here overrides the shared one; leave it off (or undefined) and
 *  AdminHeader fills it. A count of 0 never renders a badge. */
export function buildAdminNav(active: AdminSectionKey, counts: AdminNavCounts = {}): AdminNavItem[] {
  const countFor: Partial<Record<AdminPageKey, number | undefined>> = {
    applications: counts.approvals,
    reviews: counts.reviews,
    ready: counts.paperApprovals,
    'admin-queue': counts.adminQueue,
    submissions: counts.submissions,
  };
  return ADMIN_GROUPS.flatMap((g) =>
    g.pages.map((key) => {
      const copy = ADMIN_PAGES[key];
      return { key, label: copy.label, path: copy.path, short: copy.short, group: g.key, count: countFor[key], active: active === key };
    }),
  );
}

/** AD-003 footer note, present on every section's content: "every mutation
 *  still writes to the audit log ... the footer note is visible." Square
 *  top corners (butts the panel above), rounded bottom (meets the page's
 *  bottom edge — admin renders no bottom nav to reserve space for). */
export function AdminAuditNote({ className }: { className?: string }) {
  return (
    <BentoPanel
      fill="muted"
      edge="bottom"
      className={cn('flex flex-wrap items-center justify-between gap-2 px-6 py-4 lg:px-6 lg:py-4', className)}
    >
      <span className="text-[13px] text-warm-secondary">
        Every action is written to the audit log with your account and a timestamp.
      </span>
      <Link to="/admin/audit" className="tap-44 text-[13px] font-bold text-brand-blue hover:text-brand-blue-deep">
        Open audit log
      </Link>
    </BentoPanel>
  );
}
