import { isMeteredConnection } from '@/lib/net-conditions';

/* Warm an admin page's chunk when the pointer, focus or a touch reaches its
   nav link, so the click opens it from memory instead of a spinner.

   route-prefetch.ts does this for the public pages, but its table has no admin
   paths (and is not part of the admin rework), so the admin keeps its own
   small table here. These are dynamic imports of the very modules App.tsx
   lazy-loads, so the browser fetches each chunk once. A missing entry costs
   nothing but the warm-up. Nothing is fetched on a metered connection. */

const CHUNKS: Record<string, () => Promise<unknown>> = {
  '/admin': () => import('@/pages/admin/index'),
  '/admin/paper-approvals': () => import('@/pages/admin/paper-approvals'),
  '/admin/admin-queue': () => import('@/pages/admin/admin-queue'),
  '/admin/papers': () => import('@/pages/admin/papers'),
  '/admin/library': () => import('@/pages/admin/library'),
  '/admin/checkers': () => import('@/pages/admin/checkers'),
  '/admin/team': () => import('@/pages/admin/team'),
  '/admin/approvals': () => import('@/pages/admin/approvals'),
  '/admin/reviews': () => import('@/pages/admin/reviews'),
  '/admin/teachers': () => import('@/pages/admin/teachers'),
  '/admin/activity': () => import('@/pages/admin/activity'),
  '/admin/checker-log': () => import('@/pages/admin/checker-log'),
  '/admin/audit': () => import('@/pages/admin/audit'),
  '/admin/pipeline': () => import('@/pages/admin/pipeline'),
  '/admin/feedback': () => import('@/pages/admin/feedback'),
  '/hod': () => import('@/pages/Hod'),
  '/checker': () => import('@/pages/Checker'),
};

const warmed = new Set<string>();

/** Safe to call as often as you like: each path is imported at most once. */
export function prefetchAdminPath(path: string): void {
  const load = CHUNKS[path];
  if (!load || warmed.has(path) || isMeteredConnection()) return;
  warmed.add(path);
  void load().catch(() => {
    warmed.delete(path);
  });
}

/** Spread onto a nav link: warms on pointer, keyboard focus and touch. */
export function adminPrefetchProps(path: string) {
  const warm = () => prefetchAdminPath(path);
  return { onPointerEnter: warm, onFocus: warm, onTouchStart: warm };
}
