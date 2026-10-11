/**
 * Shared navigation logic for Navbar and BottomNav.
 *
 * Holds route definitions, `isActive` predicates, and the role-aware
 * account-destination logic that both navs need. Presentation (top bar vs.
 * dark floating pill, Sheet vs. inline dropdown) stays in each component —
 * only the routing/active/role logic lives here.
 */

export const BROWSE_PATH = '/all-tuition-teachers-in-kolkata';
export const PAST_PAPERS_PATH = '/past-papers';
export const DASHBOARD_PATHS = ['/dashboard/student', '/dashboard/guardian', '/dashboard/teacher'] as const;

export type UserRole = 'student' | 'guardian' | 'teacher' | null;

/** Matches any of the ~30 hardcoded subject landing routes ending in this suffix, `/browse` and `/subjects` (handoff SB-005: the subjects index is a teacher-funnel surface), and a teacher's own profile page (phase 36 C-002: "Profiles resolve to Browse"). */
export const isBrowseActive = (p: string) =>
  p === '/browse' || p === '/subjects' || p.endsWith('-tuition-teachers-in-kolkata') || p.startsWith('/tuition-teachers/');

/** `/` plus every route phase 36's C-001 table maps to the Home tab: the
 *  marketing/legal pages and the two teacher-funnel forms that don't have
 *  a tab of their own. `/help` isn't listed directly — it's a same-tick
 *  redirect to `/more`, so by the time BottomNav reads the pathname it's
 *  already `/more`. */
const HOME_ACTIVE_PATHS = ['/', '/about', '/contact', '/more', '/faq', '/join', '/recommend-teacher', '/terms-of-service', '/privacy-policy'];
export const isHomeActive = (p: string) => HOME_ACTIVE_PATHS.includes(p);

/** Handoff SC-005: `/schools` and `/school/:slug` are papers-funnel surfaces, so they activate the same tab as `/past-papers`. */
export const isPapersActive = (p: string) => p.startsWith(PAST_PAPERS_PATH) || p === '/schools' || p.startsWith('/school/');

export const isAboutActive = (p: string) => p === '/about';

/** Subject/class/board filters carried from a filtered Teachers listing
 *  across to the Papers tab, so switching tabs mid-filter lands on the
 *  matching papers instead of an unfiltered list. Same param names both
 *  pages already read (Browse.tsx and PaperResults.tsx). */
const CARRIED_FILTER_PARAMS = ['filter_subjects', 'filter_classes', 'filter_boards'];

/** Destination for the persistent Teachers<->Papers tab link (TopBar,
 *  BottomNav). Off the Teachers listing this is just `PAST_PAPERS_PATH`;
 *  on it, any active subject/class/board filters ride along to
 *  `/past-papers/results`, which already forwards straight into
 *  PaperResults (see PastPapers.tsx's `hasFilters` redirect). */
export function papersHrefFor(pathname: string, search: string): string {
  if (!isBrowseActive(pathname)) return PAST_PAPERS_PATH;

  const incoming = new URLSearchParams(search);
  const params = new URLSearchParams();
  for (const key of CARRIED_FILTER_PARAMS) {
    const value = incoming.get(key);
    if (value) params.set(key, value);
  }

  const qs = params.toString();
  return qs ? `${PAST_PAPERS_PATH}/results?${qs}` : PAST_PAPERS_PATH;
}

/** `/account` is the hub every dashboard/shelf route now redirects into
 *  (`/liked-teachers`, `/my-teachers`, `/dashboard/student`,
 *  `/dashboard/guardian` all `<Navigate>` there) -- checking it directly
 *  is what actually covers all of them; the pre-redirect paths are kept
 *  too in case a nav read happens before the redirect resolves. */
export const isAccountActive = (p: string) =>
  p === '/account' ||
  p === '/auth' ||
  p === '/select-role' ||
  p === '/liked-teachers' ||
  p === '/my-teachers' ||
  (DASHBOARD_PATHS as readonly string[]).includes(p);

/** Role-aware destination for "my dashboard" / account entry points. */
export function getAccountPath(user: unknown, role: UserRole): string {
  if (!user) return '/auth';
  switch (role) {
    case 'student':
      return '/dashboard/student';
    case 'guardian':
      return '/dashboard/guardian';
    case 'teacher':
      return '/dashboard/teacher';
    default:
      return '/select-role';
  }
}

export interface DashboardLinkConfig {
  role: Exclude<UserRole, null>;
  to: string;
  label: string;
}

/** Single source of truth for the role -> dashboard link mapping, used by both signed-in menus. */
export const DASHBOARD_LINKS: DashboardLinkConfig[] = [
  { role: 'student', to: '/dashboard/student', label: 'Student dashboard' },
  { role: 'guardian', to: '/dashboard/guardian', label: 'Guardian dashboard' },
  { role: 'teacher', to: '/dashboard/teacher', label: "Teacher's dashboard" },
];

export function getDashboardLink(role: UserRole): DashboardLinkConfig | undefined {
  return DASHBOARD_LINKS.find((d) => d.role === role);
}
