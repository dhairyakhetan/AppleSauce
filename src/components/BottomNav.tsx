import { useLocation } from 'react-router-dom';
import { Home, Search, FileText, User } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ExpandableTabs, type ExpandableTab } from '@/components/ui/expandable-tabs';
import { useSearchExpanded } from '@/hooks/useSearchExpanded';
import {
  BROWSE_PATH, isHomeActive, isBrowseActive, isPapersActive, isAccountActive, getAccountPath, papersHrefFor, type UserRole,
} from '@/lib/nav-config';

/**
 * Primary navigation on mobile (see DESIGN_SYSTEM §11 "Bottom navigation").
 * Hidden from `lg:` up, where the top Navbar carries navigation instead.
 *
 * Dark floating pill, detached from the screen edge. The active tab expands
 * to reveal its label next to the icon on a solid mode-color background —
 * brand orange for teacher-mode destinations, brand blue for the papers
 * destination (VISUAL_LANGUAGE §2.2's two-mode color system) — built on the
 * shared `ExpandableTabs` primitive (framer-motion width/opacity animation,
 * active state driven by route via `useLocation()`).
 */
export function BottomNav() {
  const location = useLocation();
  const { user, profile } = useAuth();
  const searchExpanded = useSearchExpanded();

  const role = (profile?.role as UserRole) || null;
  const accountPath = getAccountPath(user, role);

  const tabs: ExpandableTab[] = [
    { to: '/', label: 'Home', icon: Home, isActive: isHomeActive },
    {
      to: BROWSE_PATH,
      label: 'Browse',
      icon: Search,
      isActive: isBrowseActive,
    },
    {
      // Carries the current subject/class/board filters across when
      // switching over from a filtered Teachers listing (see papersHrefFor).
      to: papersHrefFor(location.pathname, location.search),
      label: 'Papers',
      icon: FileText,
      isActive: isPapersActive,
      accent: 'brand-blue',
    },
    {
      to: accountPath,
      label: 'Account',
      icon: User,
      isActive: isAccountActive,
    },
  ];

  return (
    <nav
      aria-label="Primary"
      /* Same fix as Navbar.tsx's top pill: while SearchControl's mobile-pinned
         popup is open, its "Past papers" tab sits directly under where the
         popup's tall suggestion list can scroll to. With SearchControl's
         scroll-lock setting `document.body.style.position = 'fixed'`, a
         plain z-index drop doesn't reliably keep this bar out of hit-testing
         (see the Navbar.tsx comment for the confirmed repro) — pointer-events
         is the part that actually stops a tap meant for the popup from
         quietly landing on "Past papers" underneath and navigating away. */
      className={`fixed inset-x-3 bottom-3 pb-[env(safe-area-inset-bottom)] lg:hidden ${
        searchExpanded ? 'z-30 pointer-events-none' : 'z-50'
      }`}
    >
      <ExpandableTabs
        tabs={tabs}
        pathname={location.pathname}
        theme="dark"
        /* Solid opaque dark nav bar. Previously used glass with backdrop-filter
             blur; now solid opaque with the same visual polish. This floats
             over whatever the reader is scrolling. */
        className="solid-dark mx-auto max-w-sm rounded-full px-2.5 shadow-pill"
      />
    </nav>
  );
}
