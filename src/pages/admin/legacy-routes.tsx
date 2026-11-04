import { Navigate, useLocation } from 'react-router-dom';
import { ADMIN_PAGES, type AdminPageKey } from '@/lib/admin-hints';

/* Every old admin address still works. Before the rework each page had its own
   address; now the Admin page has four tabs and the paper pages moved to the HOD
   desk, so an old address (a bookmark, a link in an email, the footer) sends the
   visitor to where that page lives now. The question mark part of the old address
   is kept, so ?dummy=1 and a filter such as ?status=approved carry over.

   The table is written out here and the routes in App.tsx are written out one
   per line, so a test can read both and check that none is missing. */

/** Old address -> the page whose new home ADMIN_PAGES says. */
export const LEGACY_ADMIN_PATHS: Record<string, AdminPageKey> = {
  '/admin/approvals': 'applications',
  '/admin/applications': 'applications',
  '/admin/reviews': 'reviews',
  '/admin/recommendations': 'reviews',
  '/admin/comments': 'reviews',
  '/admin/upvotes': 'reviews',
  '/admin/teachers': 'teachers',
  '/admin/checkers': 'checkers',
  '/admin/team': 'team',
  '/admin/activity': 'activity',
  '/admin/checker-log': 'checker-log',
  '/admin/audit': 'audit',
  '/admin/pipeline': 'pipeline',
  '/admin/feedback': 'feedback',
  // Papers moved to the HOD desk.
  '/admin/papers': 'submissions',
  '/admin/library': 'library',
  '/admin/paper-review': 'library',
  '/admin/admin-queue': 'admin-queue',
  '/admin/paper-approvals': 'ready',
  '/admin/uploads': 'submissions',
  '/admin/queue': 'admin-queue',
  '/admin/needs-you': 'admin-queue',
};

/** Where an old address goes now, as a path plus query. Pure. */
export function legacyAdminTarget(pathname: string, search: string): string | null {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  const page = LEGACY_ADMIN_PATHS[clean];
  if (!page) return null;
  const [base, ownQuery = ''] = ADMIN_PAGES[page].path.split('?');
  const out = new URLSearchParams(ownQuery);
  const old = new URLSearchParams(search);

  // The old Verifiers page had a second view for HODs and teacher reviewers.
  if (page === 'checkers' && old.get('view') === 'hods') {
    out.set('section', 'hods');
    old.delete('view');
  }
  // The old Reviews page switched between its three lists with ?tab=; that word
  // now belongs to the Admin page's own tabs.
  if (page === 'reviews' && ['reviews', 'recommendations', 'upvotes'].includes(old.get('tab') ?? '')) {
    out.set('source', old.get('tab') as string);
    old.delete('tab');
  }
  // Whatever else came with the old address (?status=approved, ?dummy=1) is carried over,
  // but never over the tab, section or filter chosen above.
  old.forEach((value, key) => {
    if (!out.has(key)) out.set(key, value);
  });
  const query = out.toString();
  return query ? `${base}?${query}` : base;
}

/** Route element for an old address. */
export function LegacyAdminRedirect() {
  const { pathname, search, hash } = useLocation();
  const target = legacyAdminTarget(pathname, search) ?? '/admin';
  return <Navigate to={`${target}${hash}`} replace />;
}
