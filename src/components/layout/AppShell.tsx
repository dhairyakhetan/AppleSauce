import * as React from 'react';
import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

import { TopBar } from '@/components/layout/TopBar';
import { Navbar } from '@/components/Navbar';
import { BottomNav } from '@/components/BottomNav';
import { PreFooter, preFooterFor, type PreFooterVariant, type B2Counts } from '@/components/layout/PreFooter';
import { isChromelessPath, isFooterlessPath } from '@/lib/chromeless-routes';

/* Footer is always below the fold (it is, by definition, the LAST thing on
   every page) and its own `sanitize()` helper pulls in DOMPurify (~23KB) at
   module scope -- but AppShell used to import it eagerly, which put that
   whole dependency into the SAME static graph every route's entry HTML
   preloads before its own page code, on a component nothing above the fold
   ever needs. Lazy here costs nothing visible: `fallback={null}` renders
   nothing while the chunk loads, exactly like the floating overlays in
   App.tsx (Chatbot/ProductTourHost) that already use the same pattern, and
   the footer fills in a moment later, below whatever the visitor is looking
   at. */
const Footer = lazy(() => import('@/components/Footer').then((m) => ({ default: m.Footer })));

/* AppShell — the single place shell config for every route is decided.

   pages.md §"Shell config for every route": "three decisions, made in
   AppShell, never in the page: control block ..., pre-footer block (B1-B4),
   nav (bottom tabs on mobile, top bar on desktop, always both, never
   per-page)." Before this component existed, ~28 page files each hand
   assembled their own Footer/PreFooter/BottomNav combination — some correct,
   some missing a pre-footer entirely, some duplicating a <Footer/> across
   every loading/error/success branch. AppShell is mounted once, above
   <Routes>, so none of that per-branch duplication is possible any more:
   whichever branch a page returns, the chrome around it is the same.

   Nav (TopBar + Navbar, the desktop bar and the mobile sticky bar + sheet)
   and BottomNav were already mounted once globally in App.tsx before this
   change — that part of "never per-page" already held. What moves here is
   Footer + PreFooter + BottomNavSpacer, which used to live inside every page.

   The auth flow, the admin console, and the paper reader are chromeless —
   no TopBar/Navbar/BottomNav/Footer/PreFooter at all, full-bleed screens with
   their own header. Admin additionally gets its own rail/toolbar shell
   (pages.md §15, not built yet) rather than this consumer AppShell. */

export { useIsChromelessRoute } from '@/lib/chromeless-routes';

export interface ChromeConfig {
  /** Override the pre-footer variant this route would otherwise get from `preFooterFor(pathname)`. Pass `'none'` to render no pre-footer at all (e.g. the reader). */
  preFooter?: PreFooterVariant | 'none';
  /** B2 live counts (teachers/reviews) — only the routes that have real counts to show need to call this. */
  preFooterCounts?: B2Counts;
  /** Extra "Find the best teachers for you" copy the Footer renders under a teacher profile. */
  footerExpandedContent?: string | null;
}

interface ChromeContextValue {
  setChrome: (patch: ChromeConfig | null) => void;
}

const ChromeContext = createContext<ChromeContextValue | null>(null);

/**
 * Lets a page override its pre-footer variant/counts or supply Footer's
 * `expandedContent`, without importing PreFooter/Footer itself. Most routes
 * never call this — AppShell already derives the right B1-B4 variant from the
 * URL via `preFooterFor`. Only Browse and TeacherProfile (live counts) and
 * the reader (no pre-footer) need it.
 */
export function useChromeConfig(config: ChromeConfig | null) {
  const ctx = useContext(ChromeContext);
  // Stringify so a fresh object literal passed on every render doesn't
  // re-trigger the effect (and, in dev/StrictMode, doesn't loop).
  const key = config ? JSON.stringify(config) : null;
  useEffect(() => {
    if (!ctx) return;
    ctx.setChrome(config ?? null);
    return () => ctx.setChrome(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, key]);
}

export function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const chromeless = isChromelessPath(location.pathname);
  // Work screens (the paper checker) keep the top nav only.
  const footerless = isFooterlessPath(location.pathname);
  /* The page's config is stored WITH the path it was set for, and staleness
     is derived rather than reset in an effect.

     The effect version raced the pages it was meant to serve: React runs
     child effects before parent effects, so on a route whose component mounts
     in the same commit as AppShell, the page called setChrome({preFooter:
     'none'}) and this reset immediately wiped it — permanently, since neither
     effect re-runs until the next navigation. Every route survived it by
     accident of being `lazy` (mounting a commit later, after the reset), and
     `/` — the one eager import in App.tsx — did not. That is why Home alone
     rendered the B1 pre-footer it had explicitly opted out of.

     Keying by path keeps the leak protection the reset was written for
     without the ordering dependency. */
  const [chrome, setChromeState] = useState<{ path: string; config: ChromeConfig | null } | null>(null);
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  const setChrome = useCallback((config: ChromeConfig | null) => {
    setChromeState({ path: pathRef.current, config });
  }, []);

  const activeChrome = chrome && chrome.path === location.pathname ? chrome.config : null;

  const ctxValue = useMemo<ChromeContextValue>(() => ({ setChrome }), [setChrome]);

  const variant: PreFooterVariant | 'none' = activeChrome?.preFooter ?? preFooterFor(location.pathname);

  return (
    <ChromeContext.Provider value={ctxValue}>
      {!chromeless && (
        <>
          <TopBar />
          <Navbar />
        </>
      )}

      {children}

      {!chromeless && !footerless && (
        <>
          {variant !== 'none' && <PreFooter variant={variant} counts={activeChrome?.preFooterCounts} />}
          {/* No BottomNavSpacer here. WordmarkBleed already reserves the same
              84px + safe-area INSIDE the footer's dark panel, so a second
              reserve after </footer> only added a band of page ground below
              the panel — the nav pill then floated on bone instead of on the
              footer, which is the white strip under the footer on mobile.
              Reserving it inside is the correct one of the two: it keeps the
              dark fill running to the bottom edge of the page. */}
          <Suspense fallback={null}>
            <Footer expandedContent={activeChrome?.footerExpandedContent} />
          </Suspense>
          <BottomNav />
        </>
      )}
    </ChromeContext.Provider>
  );
}
