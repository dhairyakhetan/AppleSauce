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
  '/hod': () => import('@/pages/Hod'),
  '/checker': () => import('@/pages/Checker'),
};

/* The sections of the Admin page, by section key. A section link warms its own
   chunk, so opening it shows the section from memory instead of a spinner. */
const SECTION_CHUNKS: Record<string, () => Promise<unknown>> = {
  positions: () => import('@/pages/admin/positions'),
  verifiers: () => import('@/pages/admin/checkers'),
  hods: () => import('@/pages/admin/checkers'),
  reviewers: () => import('@/pages/admin/checkers'),
  progress: () => import('@/pages/admin/team'),
  applications: () => import('@/pages/admin/approvals'),
  reviews: () => import('@/pages/admin/reviews'),
  listed: () => import('@/pages/admin/teachers'),
  'question-changes': () => import('@/pages/admin/activity'),
  'checker-activity': () => import('@/pages/admin/checker-log'),
  'admin-actions': () => import('@/pages/admin/audit'),
  pipeline: () => import('@/pages/admin/pipeline'),
  feedback: () => import('@/pages/admin/feedback'),
};

const warmed = new Set<string>();

/** Safe to call as often as you like: each path is imported at most once. */
export function prefetchAdminPath(path: string): void {
  const section = /[?&]section=([a-z-]+)/.exec(path)?.[1];
  const load = section ? SECTION_CHUNKS[section] : CHUNKS[path];
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
