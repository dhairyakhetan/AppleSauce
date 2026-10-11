import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  HelpCircle, MessageCircleQuestion, Menu, User,
  FileText, BookOpen, School, type LucideIcon,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { useLikes } from '@/lib/likes-context';
import { supabase } from '@/integrations/supabase/client';
import { Logo } from '@/components/Logo';
import { openProductTour } from '@/components/ProductTour';
import { logger } from '@/utils/logger';
import { useSearchExpanded } from '@/hooks/useSearchExpanded';
import { useIsAdminBadge } from '@/hooks/useIsAdminBadge';
import { useIsCheckerBadge } from '@/hooks/useIsCheckerBadge';
import { useIsHodBadge } from '@/hooks/useIsHodBadge';
import { useIsTeacherReviewerBadge } from '@/hooks/useIsTeacherReviewerBadge';
import { useSiteCounts } from '@/hooks/useSiteCounts';
import {
  Sheet, SheetClose, SheetContent, SheetGrabHandle, SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { getDashboardLink, type UserRole } from '@/lib/nav-config';
import { roleGroups } from '@/lib/role-home';
import { LINK_ICON, TEAM_STYLE } from '@/components/layout/team-style';
import { Button } from '@/components/ui/button';

const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2';

/* Handoff O-007: real, live counts for the menu's two product-half cards
 * and the signed-in account row -- "counts are live or absent, never a
 * placeholder." Gated on the sheet actually being open so this globally-
 * rendered component doesn't fire four count queries on every page load
 * whether or not anyone ever opens the menu. */
function useNavMenuCounts(open: boolean, userId: string | undefined) {
  /* The shared hook, not a fifth hand-rolled copy of this query.

     This menu counted `papers`, which has 18 rows, while the footer, About and
     the papers announcement all counted `bank_papers`, which has 1,282. The
     same site told the same reader "18, free to read" here and "1,282" a
     screen further down.

     That exact bug was found and fixed on About, whose comment says the page
     "was the only surface reading the old one". It was not -- this menu was
     reading it too, and got missed, because the query existed in five places
     and fixing one copy fixed one copy. Hence one hook.

     No `enabled: open` gate any more and no extra request either: Footer
     renders on every route and already holds ['site','counts'], so this shares
     the cached result rather than issuing its own. */
  const siteCounts = useSiteCounts();

  const papersRead = useQuery({
    queryKey: ['nav-menu', 'papers-read', userId],
    enabled: open && !!userId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { count } = await supabase
        .from('paper_reads')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId!);
      return count ?? null;
    },
  });

  return {
    teachersCount: siteCounts.data?.teachers ?? null,
    papersCount: siteCounts.data?.papers ?? null,
    papersReadCount: papersRead.data ?? null,
  };
}

/**
 * The logo does double duty (components.md C10): on the home page there is
 * nowhere to navigate to, so tapping it opens the product tour; everywhere else
 * it goes home, which is what people expect a wordmark to do.
 *
 * The tour itself is mounted by the page and listens for the event, so the
 * trigger needs no prop path to it.
 */
function LogoOrTourTrigger({ onDark = false }: { onDark?: boolean }) {
  const location = useLocation();
  const isHome = location.pathname === '/';

  /* Logo renders its own <Link>, so this must NOT wrap it in another anchor or
     a button -- that produced nested interactive elements (invalid HTML, and a
     real "<a> inside <a>" console warning). Instead the handler is passed down
     and the navigation suppressed, keeping exactly one control. */
  if (isHome) {
    return (
      <Logo
        size="nav"
        className="tap-44 flex-none"
        onDark={onDark}
        ariaLabel="How Shikshaq works"
        priority
        onClick={(e) => {
          e.preventDefault();
          openProductTour();
        }}
      />
    );
  }

  return <Logo size="nav" className="tap-44 flex-none" onDark={onDark} priority />;
}

/* Which fill family the first (`edge="top"`) panel of a route uses. The pill
   floats on that panel, so this decides whether it needs a light or an
   on-dark treatment. Kept as an explicit map rather than read from the DOM:
   the pill paints on the first frame, before any page effect could report it,
   and a flash of the wrong fill is worse than a list to maintain. */
type TopFill = 'light' | 'dark' | 'indigo';
function topPanelFill(pathname: string): TopFill {
  if (/^\/tuition-teachers\/[^/]+\/?$/.test(pathname)) return 'dark';
  if (pathname === '/recommend-teacher' || pathname === '/dashboard/teacher') return 'dark';
  if (pathname === '/past-papers' || pathname === '/past-papers/results') return 'indigo';
  if (/^\/school\/[^/]+\/?$/.test(pathname)) return 'indigo';
  return 'light';
}

export function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  /* R4G2: opening the sheet with Enter/Space used to autofocus the "Sign in"
     button, which sits near the bottom (below Teachers/Past papers/Subjects/
     Schools/FAQ/Help) -- a keyboard user tabbing forward from there had to
     cycle almost the whole sheet to reach those. Radix focuses the first
     focusable descendant by default, but that "first" one is DOM order, and
     "Sign in" only reads first because it's rendered before the quiet link
     row that follows it, not because it IS first -- the Teachers card (the
     sheet's actual first row) is what should get initial focus. */
  const firstMenuLinkRef = useRef<HTMLAnchorElement>(null);
  const { user, signOut, profile } = useAuth();
  const { likedTeacherIds } = useLikes();
  /* Was this component's own `admins` select in a [user] effect. Footer ran
     an identical one, and between them (StrictMode double-invoke, plus a
     re-run when `user` settles) a single page load fired NINE copies of the
     same request -- see useIsAdminBadge for the measurement. One shared
     react-query key now serves both. */
  const isAdmin = useIsAdminBadge();
  const isChecker = useIsCheckerBadge();
  const isHod = useIsHodBadge();
  const isTeacherReviewer = useIsTeacherReviewerBadge();
  const staffGroups = roleGroups({ isAdmin, isHod, isChecker, isTeacherReviewer });
  const userRole = (profile?.role as UserRole) || null;
  const dashboardLink = getDashboardLink(userRole);
  const { teachersCount, papersCount, papersReadCount } = useNavMenuCounts(menuOpen, user?.id);

  // Close the mobile sheet on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const searchExpanded = useSearchExpanded();
  const initial = (user?.email?.charAt(0) || '?').toUpperCase();

  // Nav track dissolve -- VISUAL_LANGUAGE.md §9: the header's hairline/backdrop
  // fades in once the page has scrolled past a small threshold, distinguishing
  // "at top" from "scrolled" states. Was 48px, which read as sluggish on a
  // mobile QA pass -- the pill sat transparent-over-hero for nearly a full
  // swipe before it caught up. 24px lets it react to the first flick of a
  // scroll instead of waiting for a deliberate one. `prefers-reduced-motion`
  // makes the transition instant via the global guard in index.css, so no
  // separate branch is needed here.
  const [scrolled, setScrolled] = useState(false);
  /* T-010: "logo inversion follows the panel, not the route." Now that
     `edge="top"` panels actually run underneath this pill (the nav reserve
     moved inside BentoPanel), what sits behind the pill is that panel's fill  -- 
     so the treatment is keyed on the fill family, not on a hand-listed route.

     Previously only `/` and `/past-papers` were special-cased, which left the
     teacher profile -- whose first panel is the near-black identity card -- with
     the default bone pill: a light grey slab sitting on black. */
  const topFill = topPanelFill(location.pathname);
  /* T-009: home's first panel is bone after the redesign, so the pill is
     bone too and the logo is NOT inverted. */
  const onTintBlock = topFill !== 'light' && !scrolled;
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      /* On home, 2a draws the logo and Sign in INSIDE the dark control block
         rather than in a separate bone bar above it. Rendering it as a
         transparent overlay achieves that without moving the markup into
         Index.tsx and without dropping the sheet menu, which is the only
         mobile route to Sign out, admin, favourites and My teachers. Once
         scrolled past the block it becomes the normal opaque bar, because
         white-on-bone would be unreadable. */
      className={`fixed inset-x-3 top-3 rounded-full shadow-pill transition-colors duration-tap lg:hidden ${
        /* Solid opaque nav bar, tinted for what it is sitting over.
           Previously used glass with backdrop-filter blur; now solid opaque
           with the same visual polish (gradient highlights and inset shadows). */
        scrolled
          ? 'solid-light'
          : topFill === 'dark' || topFill === 'indigo'
            /* Over the near-black panel or the indigo block: the dark body,
               so the pill reads as a solid bar over a saturated surface. */
            ? 'solid-dark'
            /* T-009: bone on the bone hero, dark logo. */
            : 'solid-light'
      } ${
        /* pointer-events-none, not just a lower z-index: with SearchControl's
           mobile-pinned scroll lock (`document.body.style.position = 'fixed'`
           while the popup is open -- see useEffect in SearchControl.tsx), this
           header's own `position: fixed` box stops losing hit-testing to the
           popup's z-[70] the way a lower z-index alone implies. Verified in
           the running app: with only the z-30 drop, taps on the pinned
           popup's Teachers/Past papers toggle (which sits at the same
           `top-3` corner as this bar) were landing on the navbar logo/menu
           underneath instead of the toggle -- the popup visually painted on
           top, but the browser's hit-test still resolved to this header. That
           silent misroute is what a rework brief described as the toggle
           "taking me" somewhere else. Disabling pointer events here removes
           the header from hit-testing outright, independent of whichever
           element the compositor's paint order happens to favor. */
        searchExpanded ? 'z-30 pointer-events-none' : 'z-50'
      }`}
      /* fixed (not sticky): a sticky element can't be inset from the side
         edges and still read as a floating pill -- its box still spans the
         full flow width even with side margins -- so this is `fixed` with a
         `top-3` offset, same "pinned while scrolling" behaviour as before but
         now genuinely detached from the viewport edges like BottomNav's own
         floating pill. Being taken out of flow means the page needs an
         explicit offset underneath it: see TopNavSpacer in
         PageContainer.tsx, rendered once by AppShell right after this bar.

         Desktop chrome now lives in <TopBar> (mounted globally, hidden below
         lg). Navbar is retained purely for the mobile floating pill + sheet
         menu -- the hamburger's Sign out / admin / favourites / My teachers
         items have no desktop equivalent elsewhere except TopBar's own
         account dropdown, so this component must not disappear on mobile. */
    >
      {/* pr-1.5, not a symmetric px-4. The pill is 56px tall and the menu
          trigger is a 44px circle, so it sits 6px off the top and bottom -- but
          16px of right padding pushed it 10px further in than that, and a
          circle inset unevenly inside a rounded corner reads as off-centre.
          6px on the right makes the trigger concentric with the pill's own
          corner arc. The logo keeps the larger left inset because it is a
          wordmark, not a circle -- the same asymmetry D-004 specifies for the
          desktop bar (`pl-6 pr-2.5`). */}
      <div className="mx-auto w-full max-w-6xl pl-4 pr-1.5 sm:px-6 lg:px-8">
        {/* Mobile: short bar -- logo + a single action. The bottom tab bar carries navigation. */}
        <div className="flex h-14 items-center justify-between gap-4">
          <LogoOrTourTrigger onDark={onTintBlock} />

          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger
              aria-label="Open menu"
              className={`flex h-11 w-11 flex-none items-center justify-center rounded-full transition-colors duration-150 active:scale-[0.97] ${
                onTintBlock
                  ? 'text-background shadow-none hover:bg-white/10'
                  : 'text-foreground shadow-border hover:bg-muted'
              } ${FOCUS_RING}`}
            >
              <Menu className="h-5 w-5" aria-hidden />
            </SheetTrigger>

            <SheetContent
              side="bottom"
              aria-describedby={undefined}
              /* A half-height frosted sheet rather than the opaque near-full
                 one this was. Three parts, and each is doing something:

                 max-h-[60vh] makes it a half modal. The menu was rendering at
                 71% of the viewport, which reads as "the page has been
                 replaced" rather than "something has opened over it". Capping
                 it leaves the page visible above and makes the sheet feel
                 dismissible. overflow-y-auto because the row count varies --
                 an admin sees one more than a signed-out reader.

                 bg-[hsl(var(--card)/0.75)] + backdrop-blur-2xl is the frosting. `card` is the
                 hsl(var(--card)) token, so the /72 modifier actually computes
                 here -- the raw-hex tokens in the warm-* block and `panel` do
                 NOT, which is the bug that left this sheet's own scrim
                 invisible.

                 The overlay gets a light blur too, opted into per-sheet. A
                 translucent panel over a perfectly sharp page does not read as
                 frosted, it reads as a rendering fault. */
              overlayClassName="backdrop-blur-[8px] backdrop-saturate-[130%]"
              onOpenAutoFocus={(e) => {
                if (firstMenuLinkRef.current) {
                  e.preventDefault();
                  firstMenuLinkRef.current.focus();
                }
              }}
              className={[
                /* Sized by its content. max-h is a guard, not a layout: the
                   rows come to about 71% of an 812px screen, so nothing
                   scrolls in normal use. It was capped at 60vh, which turned a
                   menu of eight items into a scrolling one for no reason. The
                   cap still earns its place on a short screen, a landscape
                   phone, or when a reader has set large text. */
                'max-h-[88svh] overflow-y-auto overscroll-contain border-0 px-4',
                'pb-[calc(env(safe-area-inset-bottom)+1.625rem)]',
                'solid-light',
              ].join(' ')}
            >
              <SheetGrabHandle />
              <SheetTitle className="sr-only">Menu</SheetTitle>

              {/* Handoff O-007: both halves of the product, always first, in
                  this order, on every route (C-019). Counts are live or
                  absent -- never a placeholder. */}
              <div className="grid grid-cols-2 gap-2">
                <SheetClose asChild>
                  <Link
                    ref={firstMenuLinkRef}
                    to="/all-tuition-teachers-in-kolkata"
                    className={`rounded-[24px] bg-brand-subtle p-[18px_16px] ${FOCUS_RING}`}
                  >
                    <span className="flex h-[38px] w-[38px] items-center justify-center rounded-xl bg-brand">
                      <User className="h-[19px] w-[19px] text-foreground" strokeWidth={2} aria-hidden="true" />
                    </span>
                    <span className="mt-3 block font-display text-[19px] font-extrabold tracking-[-0.04em] text-brand-deep">Teachers</span>
                    <span className="mt-0.5 block text-[13px] text-warm-secondary">
                      {teachersCount != null ? `${teachersCount} in Kolkata` : 'In Kolkata'}
                    </span>
                  </Link>
                </SheetClose>
                <SheetClose asChild>
                  <Link to="/past-papers" className={`rounded-[24px] bg-brand-blue-subtle p-[18px_16px] ${FOCUS_RING}`}>
                    <span className="flex h-[38px] w-[38px] items-center justify-center rounded-xl bg-brand-blue">
                      <FileText className="h-[19px] w-[19px] text-white" strokeWidth={2} aria-hidden="true" />
                    </span>
                    <span className="mt-3 block font-display text-[19px] font-extrabold tracking-[-0.04em] text-brand-blue-deep">Past papers</span>
                    <span className="mt-0.5 block text-[13px] text-warm-secondary">
                      {papersCount != null ? `${papersCount}, free to read` : 'Free to read'}
                    </span>
                  </Link>
                </SheetClose>
              </div>

              <div className="mt-2 rounded-[24px] bg-muted p-1.5">
                <SheetMenuRow to="/subjects" icon={BookOpen} label="Subjects" hairline />
                <SheetMenuRow to="/schools" icon={School} label="Schools" hairline />
                <SheetMenuRow to="/faq" icon={MessageCircleQuestion} label="FAQ" hairline />
                <SheetMenuRow to="/more" icon={HelpCircle} label="Help" />
              </div>

              {/* One block per staff team the person belongs to, each with its
                  own label and accent (team-style.ts). Nothing shows for a
                  team they are not in. */}
              {staffGroups.map((g) => (
                <div key={g.team} role="group" aria-label={g.label} className="mt-2 rounded-[24px] bg-muted p-1.5">
                  <div className={`px-3 pb-1 pt-2.5 text-[12px] font-bold uppercase tracking-[0.08em] ${TEAM_STYLE[g.team].label}`}>{g.label}</div>
                  {g.links.map((l, i) => (
                    <SheetMenuRow
                      key={l.key}
                      to={l.to}
                      icon={LINK_ICON[l.key]}
                      label={l.label}
                      chip={TEAM_STYLE[g.team].chip}
                      hairline={i < g.links.length - 1}
                    />
                  ))}
                </div>
              ))}

              {/* Handoff O-007: account block -- signed in gets a real "{n}
                  saved · {m} papers" row (never a placeholder; each half
                  omitted when its own count isn't loaded yet), signed out
                  gets the one Sign in action in the same slot. */}
              {user ? (
                <SheetClose asChild>
                  <Link
                    to={dashboardLink?.to ?? '/account'}
                    className={`mt-2 flex items-center gap-3 rounded-[24px] bg-panel p-[16px_18px] text-background ${FOCUS_RING}`}
                  >
                    <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-brand font-display text-[17px] font-black text-brand-foreground">
                      {initial}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-bold">{user.email}</span>
                      <span className="mt-px block text-[13px] text-background/60">
                        {[
                          `${likedTeacherIds.size} saved`,
                          papersReadCount != null ? `${papersReadCount} papers` : null,
                        ].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <ArrowIcon />
                  </Link>
                </SheetClose>
              ) : (
                <Button variant="primary" size={54} onClick={() => { setMenuOpen(false); navigate('/auth'); }} className="mt-2 w-full rounded-full">
                  Sign in
                </Button>
              )}

              {/* Handoff O-007: a centred row of quiet links. Sign out moved
                  here from the old per-item list -- it's real functionality,
                  reachable one tap further via the account row above rather
                  than a separate destructive item in this menu. */}
              <div className="mt-3 flex min-h-11 flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[13px] text-warm-meta">
                <SheetClose asChild>
                  <Link to="/about" className={`tap-44 rounded ${FOCUS_RING}`}>About</Link>
                </SheetClose>
                <SheetClose asChild>
                  <Link to="/contact" className={`tap-44 rounded ${FOCUS_RING}`}>Contact</Link>
                </SheetClose>
                <SheetClose asChild>
                  <Link to="/join" className={`tap-44 rounded ${FOCUS_RING}`}>Join as a teacher</Link>
                </SheetClose>
                {user && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await signOut();
                      } finally {
                        window.location.href = '/';
                      }
                    }}
                    className={`tap-44 rounded text-destructive ${FOCUS_RING}`}
                  >
                    Sign out
                  </button>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>

      </div>
    </header>
  );
}

/* Handoff O-007: secondary-row group inside the bg-muted p-1.5 wrapper  -- 
 * min-h-[52px], 18px leading glyph, 15.5px/600 label, 16px trailing arrow,
 * hairlines between (not on the last row). */
function SheetMenuRow({ to, icon: Icon, label, hairline = false, chip }: { to: string; icon: LucideIcon; label: string; hairline?: boolean; chip?: string }) {
  return (
    <SheetClose asChild>
      <Link
        to={to}
        className={`flex min-h-[52px] items-center gap-3 px-3 text-foreground ${hairline ? 'shadow-[inset_0_-1px_0_hsl(var(--border))]' : ''} ${FOCUS_RING}`}
      >
        {chip ? (
          <span className={`flex h-8 w-8 flex-none items-center justify-center rounded-full ${chip}`}>
            <Icon className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
          </span>
        ) : (
          <Icon className="h-[18px] w-[18px] text-warm-secondary" strokeWidth={2} aria-hidden="true" />
        )}
        <span className="flex-1 text-[16px] font-semibold">{label}</span>
        <ArrowIcon />
      </Link>
    </SheetClose>
  );
}

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="flex-none text-warm-quaternary" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

