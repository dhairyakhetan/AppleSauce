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
const FOOTERLESS_ROUTES = ['/checker', '/checker/practice', '/hod', '/teacher-review'];

export function isFooterlessPath(pathname: string): boolean {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return FOOTERLESS_ROUTES.includes(p);
}

export function useIsChromelessRoute() {
  const { pathname } = useLocation();
  return isChromelessPath(pathname);
}
