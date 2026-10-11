import * as React from "react";
import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Heart, GraduationCap, Users,
  BookMarked, type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { openProductTour } from "@/components/ProductTour";
import { logger } from "@/utils/logger";
import { useExitPresence } from "@/hooks/useExitPresence";
import { useIsAdminBadge } from "@/hooks/useIsAdminBadge";
import { useIsCheckerBadge } from "@/hooks/useIsCheckerBadge";
import { useIsHodBadge } from "@/hooks/useIsHodBadge";
import { useIsTeacherReviewerBadge } from "@/hooks/useIsTeacherReviewerBadge";
import { roleGroups } from "@/lib/role-home";
import { LINK_ICON, TEAM_STYLE } from "@/components/layout/team-style";
import {
  BROWSE_PATH,
  getDashboardLink,
  isBrowseActive,
  isPapersActive,
  papersHrefFor,
  type UserRole,
} from "@/lib/nav-config";

/* Redesign S2 (components.md §3, design.md §5), restyled per Handoff D-004.

   The desktop counterpart to the bottom nav: a 60px near-black pill carrying
   the logo, four plain-text nav links (both halves of the product — Teachers
   then Past papers — plus Subjects/About; Schools was dropped from this bar,
   still reachable from the mobile sheet menu), and two right-aligned
   actions. `hidden lg:block` — below lg the floating pill (S1) is the
   navigation, and the two must never both be visible. */

const isAboutActive = (p: string) => p === "/about";
const isSubjectsActive = (p: string) => p === "/subjects";

function LogoOrTourTrigger() {
  const location = useLocation();
  const isHome = location.pathname === "/";

  if (isHome) {
    return (
      <Logo
        className="tap-44 h-8 w-auto"
        onDark
        ariaLabel="How Shikshaq works"
        onClick={(e) => {
          e.preventDefault();
          openProductTour();
        }}
      />
    );
  }

  return <Logo className="tap-44 h-8 w-auto" onDark priority />;
}

export function TopBar({ className }: { className?: string }) {
  const location = useLocation();
  const { user, profile, signOut } = useAuth();
  const role = (profile?.role as UserRole) || null;
  /* Third copy of the same `admins` select (Navbar and Footer had the other
     two) — all three render on every route, so a single page load fired
     nine of them between them. Shared react-query key now. See
     useIsAdminBadge for the measurement. */
  const isAdmin = useIsAdminBadge();
  const isChecker = useIsCheckerBadge();
  const isHod = useIsHodBadge();
  const isTeacherReviewer = useIsTeacherReviewerBadge();
  // One section per team the person belongs to, one link per role in it (not a list of admin pages: the admin menu itself holds those).
  const staffGroups = roleGroups({ isAdmin, isHod, isChecker, isTeacherReviewer });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuPresence = useExitPresence(menuOpen);
  const initial = (user?.email?.charAt(0) || "?").toUpperCase();
  const dashboardLink = getDashboardLink(role);

  // "Past papers" carries the current subject/class/board filters when
  // switching over from a filtered Teachers listing (see papersHrefFor) —
  // the other links are plain routes and don't need location awareness.
  const navLinks = [
    { to: BROWSE_PATH, label: "Teachers", match: isBrowseActive },
    { to: papersHrefFor(location.pathname, location.search), label: "Past papers", match: isPapersActive },
    { to: "/subjects", label: "Subjects", match: isSubjectsActive },
    { to: "/about", label: "About", match: isAboutActive },
  ] as const;

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <header
      className={cn(
        /* Solid opaque desktop nav bar, dark body. Previously used glass with
           backdrop-filter blur; now solid opaque with the same visual polish
           (gradient highlights and inset shadows). */
        "fixed inset-x-3 top-3 z-40 hidden h-[60px] rounded-full solid-dark shadow-pill lg:block",
        className,
      )}
      /* One <nav> per bar; the links inside are the primary desktop navigation.
         fixed (not sticky): a sticky element can't be inset from the side
         edges and still read as a floating pill (its box still spans the
         full flow width even with side margins), so this is `fixed` with a
         `top-3` offset instead — same "pinned while scrolling" behaviour as
         before, but now genuinely detached from the viewport edges like
         BottomNav's own floating pill. Being taken out of flow means the
         page needs an explicit offset underneath it: see TopNavSpacer in
         PageContainer.tsx, rendered once by AppShell right after this bar. */
    >
      {/* Handoff D-004: pl-6 pr-2.5 directly on the bar, not PageContainer's
          centred max-w-6xl column — this pill spans (near) the full width
          the outer inset-x-3 gives it, matching the bottom nav's own pill
          being the whole of its navigation rather than page content. */}
      <nav aria-label="Primary" className="flex h-[60px] items-center gap-6 pl-6 pr-2.5">
        <LogoOrTourTrigger />

        <ul className="flex items-center gap-6">
          {navLinks.map(({ to, label, match }) => {
            const active = match(location.pathname);
            return (
              <li key={label}>
                <Link
                  to={to}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    // C-013: this is a plain-text link with no padding of its
                    // own, only ~18px tall — tap-44 gives it an invisible hit
                    // area at the pointer-input floor (40px at lg, per the
                    // utility's own responsive rule) without changing its
                    // visible size.
                    "tap-44 inline-flex items-center text-[15px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background focus-visible:ring-offset-2 focus-visible:ring-offset-panel",
                    active ? "text-background" : "text-background/70 hover:text-background",
                  )}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="ml-auto flex items-center gap-3">

            {/* Handoff D-004: bg-muted, not the orange primary fill "List
                yourself" used before — a neutral second action reads
                correctly on every page now, including papers-mode ones,
                where the old orange CTA would have broken the "exactly one
                accent per page" rule (C-007); this one no longer carries
                that accent, so it no longer needs to hide there.

                Order matters and this one comes first: D-004 lists the
                right-aligned pair as "`Join as a teacher` … and `Sign in`",
                which puts the orange primary outermost. It used to render
                second, leaving the accent pinned between two neutrals. */}
            <Button asChild variant="muted" size={44}>
              <Link to="/join">Join as a teacher</Link>
            </Button>

            {user ? (
              <div className="relative">
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-label="Account menu"
                  aria-expanded={menuOpen}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-sm font-semibold text-background transition-colors duration-150 hover:bg-white/25 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
                >
                  {initial}
                </button>
                {menuPresence.mounted && (
                  <>
                    <button
                      type="button"
                      onClick={() => setMenuOpen(false)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setMenuOpen(false);
                        }
                      }}
                      aria-label="Close menu"
                      className="fixed inset-0 z-50"
                      style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'auto' }}
                    />
                    <div
                      className={cn(
                        "absolute right-0 top-full z-[51] mt-2 grid min-w-[220px] gap-1 rounded-2xl bg-card p-2 text-foreground shadow-border-hover",
                        menuPresence.closing ? "animate-accordion-up" : "animate-fade-slide-up",
                      )}
                    >
                      <div className="truncate px-3 py-2 text-xs text-muted-foreground">{user.email}</div>
                      <hr className="border-border" />
                      {dashboardLink && (
                        <TopBarMenuLink
                          to={dashboardLink.to}
                          icon={role === "guardian" ? Users : GraduationCap}
                          label={dashboardLink.label}
                          onClick={() => setMenuOpen(false)}
                        />
                      )}
                      <TopBarMenuLink to="/liked-teachers" icon={Heart} label="Favourite teachers" onClick={() => setMenuOpen(false)} />
                      {role === "student" && (
                        <TopBarMenuLink to="/my-teachers" icon={BookMarked} label="My teachers" onClick={() => setMenuOpen(false)} />
                      )}
                      {staffGroups.map((g) => (
                        <div key={g.team} role="group" aria-label={g.label} className="grid gap-1">
                          <hr className="border-border" />
                          <div className={cn("px-3 pt-1 text-[11px] font-bold uppercase tracking-[0.08em]", TEAM_STYLE[g.team].label)}>{g.label}</div>
                          {g.links.map((l) => (
                            <TopBarMenuLink
                              key={l.key}
                              to={l.to}
                              icon={LINK_ICON[l.key]}
                              label={l.label}
                              chip={TEAM_STYLE[g.team].chip}
                              onClick={() => setMenuOpen(false)}
                            />
                          ))}
                        </div>
                      ))}
                      <hr className="border-border" />
                      <button
                        onClick={async () => {
                          setMenuOpen(false);
                          try {
                            await signOut();
                          } finally {
                            window.location.href = "/";
                          }
                        }}
                        className="flex min-h-[44px] items-center rounded-lg px-3 text-sm font-semibold text-destructive transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        Sign out
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              /* Handoff D-004: a real h44 rounded-full bg-brand button, not
                 a plain text link — "Sign in" is one of the two actions this
                 bar names explicitly. */
              <Button asChild variant="primary" size={44}>
                <Link to="/auth">Sign in</Link>
              </Button>
            )}
          </div>
      </nav>
    </header>
  );
}

function TopBarMenuLink({ to, icon: Icon, label, onClick, chip }: { to: string; icon: LucideIcon; label: string; onClick: () => void; chip?: string }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="flex min-h-[44px] items-center gap-2 rounded-lg px-3 text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      {chip ? (
        <span className={cn("flex h-7 w-7 flex-none items-center justify-center rounded-full", chip)}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
      ) : (
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
      )}
      {label}
    </Link>
  );
}
