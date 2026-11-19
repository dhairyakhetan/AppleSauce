import { useLocation } from 'react-router-dom';

/* The chromeless-route predicate lives here rather than in AppShell so that
   layout primitives can ask the question without importing AppShell — which
   imports them back. BentoPanel needs it to decide whether an `edge="top"`
   panel should reserve space for the floating nav pill, and a cycle between
   the two modules is a real runtime hazard, not just a lint complaint. */

/** Routes that render no TopBar/Navbar/BottomNav/Footer/PreFooter at all —
 *  full-bleed screens with their own header. */
const CHROMELESS_ROUTES = ['/auth', '/select-role', '/join/apply', '/teacher-terms-agreement', '/signup-success'];
const CHROMELESS_PREFIXES = ['/admin', '/__sandbox'];

/** `/past-papers/:id` (the reader) — not `/past-papers` or `/past-papers/results`. */
const READER_PATTERN = /^\/past-papers\/(?!results$)[^/]+\/?$/;

/** `/tuition-teachers/:slug/whatsapp-click` — the WhatsApp handoff interstitial (O-012). */
const WHATSAPP_REDIRECT_PATTERN = /^\/tuition-teachers\/[^/]+\/whatsapp-click\/?$/;

export function isChromelessPath(pathname: string): boolean {
  return (
    CHROMELESS_ROUTES.includes(pathname) ||
    CHROMELESS_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) ||
    READER_PATTERN.test(pathname) ||
    WHATSAPP_REDIRECT_PATTERN.test(pathname)
  );
}

/** Work screens that keep the top nav but drop the pre-footer plug, the
 *  site footer and the floating mobile nav. The paper checker (owner,
 *  2026-09-28: "remove the footer and the bottom shikshaq plug from that
 *  page"): its action buttons sit at the bottom, and the floating nav pill
 *  covered them on phones. */
const FOOTERLESS_ROUTES = ['/checker', '/checker/practice', '/hod', '/hod/pipeline', '/teacher-review', '/games', '/games/approve', '/games/play', '/games/team', '/games/chapters'];

export function isFooterlessPath(pathname: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return FOOTERLESS_ROUTES.includes(p);
}

/** The checker's verify screen, `/checker?paper=<id>&verify=1`. */
export function isVerifyScreen(pathname: string, search: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (p !== '/checker') return false;
  const params = new URLSearchParams(search);
  return params.get('verify') === '1' && Boolean(params.get('paper'));
}

/**
 * The verify screen is one focused work screen (owner, 12 Oct 2026: the site
 * header stacked on its top tile was "too crammed"): it shows no site header at
 * all. The other checker pages keep the normal one. Anything that asks "is
 * this route chromeless?" gets the same answer here.
 */
export function isChromelessLocation(pathname: string, search: string): boolean {
  return isChromelessPath(pathname) || isVerifyScreen(pathname, search);
}

export function useIsChromelessRoute() {
  const { pathname, search } = useLocation();
  return isChromelessLocation(pathname, search);
}
