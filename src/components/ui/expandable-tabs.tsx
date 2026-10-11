import { NavLink } from 'react-router-dom';
import { useRef, useState } from 'react';
import { useOnClickOutside } from 'usehooks-ts';
import type { LucideIcon } from 'lucide-react';

export interface ExpandableTab {
  to: string;
  label: string;
  icon: LucideIcon;
  isActive: (pathname: string) => boolean;
  /** Mode color for the active fill (VISUAL_LANGUAGE §2.2: teacher-mode
   *  surfaces are brand orange, papers-mode surfaces are brand blue).
   *  Defaults to 'brand' — set 'brand-blue' on tabs whose destination is
   *  the papers flow so the nav's active-tab color actually matches which
   *  audience mode the user is in, instead of always being orange. */
  accent?: 'brand' | 'brand-blue';
}

/**
 * Shared expand-on-select tab primitive backing both the mobile bottom nav
 * and the desktop top nav (DESIGN_SYSTEM §11 / VISUAL_LANGUAGE §9).
 *
 * The "expanded" tab is the one whose route matches the current location
 * (via `isActive`), not click-driven local state — the label reveal tracks
 * `useLocation()` in the caller. A lightweight `peek` state (hover/focus on
 * an *inactive* tab) previews its label too, and collapses on outside
 * click/tap via `useOnClickOutside` so a touch tap elsewhere always closes
 * any open peek instead of leaving it stuck expanded.
 *
 * Width/opacity of the revealed label animate with framer-motion. This
 * reverses the original BottomNav decision (see HANDOFF.md) to avoid an
 * animation library — an explicit, owner-approved exception for this one
 * component. DESIGN_SYSTEM.md §6 does not itself mention framer-motion;
 * don't cite it as blanket cover for using the library elsewhere.
 */
export function ExpandableTabs({
  tabs,
  pathname,
  theme,
  className = '',
}: {
  tabs: ExpandableTab[];
  pathname: string;
  theme: 'dark' | 'light';
  className?: string;
}) {
  const [peekIndex, setPeekIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLUListElement>(null);
  useOnClickOutside(containerRef as React.RefObject<HTMLElement>, () => setPeekIndex(null));
  /* DESIGN_SYSTEM §6: no exceptions for reduced-motion. This used to need a
     useReducedMotion() hook because framer-motion does not auto-honor the
     media query for arbitrary animate props. Now that the label animates in
     CSS, `motion-reduce:transition-none` handles it at the same layer as the
     rest of the codebase, and the hook is gone with the dependency. */

  const isDark = theme === 'dark';

  return (
    <ul
      ref={containerRef}
      className={`relative flex w-full items-stretch ${className}`}
    >
      {tabs.map((tab, index) => {
        const active = tab.isActive(pathname);
        const expanded = active || peekIndex === index;
        const Icon = tab.icon;
        const accentBg = tab.accent === 'brand-blue' ? 'bg-brand-blue' : 'bg-brand';
        /* The ink an ACTIVE pill needs, decided by which accent it is wearing.
           Both branches below used to hardcode text-white, which is right on
           brand-blue (5.44:1) and wrong on brand orange (2.52:1, the pair
           index.css:112-123 documents as banned). This is the nav, so the
           orange case was repeating on every scoped page. Applies in dark mode
           too: the active pill is painted accentBg there as well. */
        const accentInk = tab.accent === 'brand-blue' ? 'text-white' : 'text-brand-foreground';
        const accentRing = tab.accent === 'brand-blue' ? 'focus-visible:ring-brand-blue' : 'focus-visible:ring-brand';

        return (
          <li
            key={tab.label}
            /* M33: flex-grow is layout-affecting (every frame reflows the
               whole row, not just this tab), which is unavoidable for a
               nav where the expanding tab genuinely takes space from its
               siblings — a transform-only approach can't redistribute that
               space without a JS-measured rewrite. motion-reduce drops the
               movement per CRAFT §2 while keeping the (non-animated) width
               change itself, same as every other motion path in this file. */
            className={`flex items-stretch transition-[flex-grow] duration-300 ease-out motion-reduce:transition-none ${
              expanded ? 'flex-[1.6]' : 'flex-1'
            } ${isDark ? 'py-2' : ''}`}
          >
            <NavLink
              to={tab.to}
              aria-current={active ? 'page' : undefined}
              aria-label={tab.label}
              onMouseEnter={() => !active && setPeekIndex(index)}
              onMouseLeave={() => setPeekIndex((v) => (v === index ? null : v))}
              onFocus={() => !active && setPeekIndex(index)}
              onBlur={() => setPeekIndex((v) => (v === index ? null : v))}
              className={`relative flex w-full items-center justify-center gap-1.5 overflow-hidden rounded-full transition-[background-color,box-shadow] duration-200 focus-visible:outline-none focus-visible:ring-2 ${accentRing} focus-visible:ring-offset-2 active:scale-[0.96] ${
                /* Handoff T-008: active pill grows to 46px with 20px side
                   padding; inactive tabs keep the 44px hit target. */
                active ? 'h-[46px] px-5' : 'h-11'
              } ${
                isDark
                  ? `focus-visible:ring-offset-panel ${active ? accentBg : ''}`
                  : `focus-visible:ring-offset-background ${active ? `${accentBg} shadow-border-hover` : 'text-foreground hover:bg-muted'}`
              }`}
            >
              <Icon
                className={`relative z-10 h-5 w-5 shrink-0 transition-colors duration-150 ${
                  isDark
                    ? active
                      ? accentInk
                      : 'text-white/50'
                    : active
                      ? accentInk
                      : 'text-muted-foreground'
                }`}
                strokeWidth={active ? 2.25 : 1.8}
                aria-hidden
              />
              {/* Was framer-motion animating maxWidth/opacity/marginLeft.
                  Identical in CSS: max-w-24 is 96px, ml-1.5 is 6px, and
                  ease-snap is cubic-bezier(0.16, 1, 0.3, 1), the exact curve
                  this used (tailwind.config.ts:361). motion-reduce replaces
                  the useReducedMotion duration check, and does it at the CSS
                  layer where the rest of this codebase already handles it. */}
              <span
                aria-hidden
                className={`relative z-10 overflow-hidden whitespace-nowrap text-[14px] font-bold tracking-[-0.01em] transition-[max-width,opacity,margin-left] duration-300 ease-snap motion-reduce:transition-none ${
                  expanded ? 'ml-1.5 max-w-24 opacity-100' : 'ml-0 max-w-0 opacity-0'
                } ${active ? accentInk : isDark ? 'text-white' : 'text-foreground'}`}
              >
                {tab.label}
              </span>
            </NavLink>
          </li>
        );
      })}
    </ul>
  );
}
