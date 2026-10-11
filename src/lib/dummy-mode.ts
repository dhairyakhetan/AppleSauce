/**
 * Dummy mode (owner decision D75): preview a signed-in-only screen without
 * signing in, against an in-memory fake of its API. Test builds only.
 *
 * GATE. Everything hangs off PREVIEW_TOOLS (src/lib/preview-tools.ts), which
 * folds to a literal `false` in a build without VITE_PREVIEW_TOOLS=true. The
 * fakes and fixtures live in src/dummy/ and are only ever reached through
 *
 *     const Dummy = PREVIEW_TOOLS ? lazy(() => import('@/dummy/...')) : null;
 *
 * so in the live build the import is dead code and no chunk is emitted:
 * compiled out, not hidden. Never import src/dummy/ statically from a page.
 *
 * SWITCH. `?dummy=1` on any URL turns it on for the tab (sessionStorage),
 * `?dummy=0` turns it off; the preview toggle has a button for each.
 *
 * ADDING ANOTHER PAGE (e.g. the admin paper-review / paper-edit pages):
 *   1. Give the page one API object type in its lib file, with a real
 *      implementation (see CheckerApi / realCheckerApi in checker-api.ts).
 *   2. Split the page into a default export that picks real or dummy, and a
 *      named component that takes `api` as a prop (see Checker.tsx:
 *      Checker -> CheckerPage).
 *   3. Put the fake in src/dummy/<page>-fake-api.ts and a wrapper component
 *      in src/dummy/<Page>Dummy.tsx, reached only through the lazy import
 *      above. Fixture text must be made up, never copied from a real paper.
 *   4. Add a button to DUMMY_PAGES below so the preview toggle offers it.
 *   5. Re-run the live-shaped build grep in CLAUDE.md with the new file's
 *      identifiers.
 */

import { PREVIEW_TOOLS } from '@/lib/preview-tools';

const KEY = 'shikshaq:dummy-mode';

interface DummyPageEntry {
  path: string;
  label: string;
  /** Planned by the admin rework but not built yet. The preview toggle does not
   *  offer it. The batch that builds the page's dummy deletes this one flag. */
  dormant?: true;
}

const ALL_DUMMY_PAGES: DummyPageEntry[] = [
  { path: '/checker', label: 'Verify papers (dummy)' },
  { path: '/hod', label: 'HOD desk (dummy)' },
  { path: '/teacher-review', label: 'Review teachers (dummy)' },
  { path: '/admin', label: 'Admin: needs you now (dummy)' },
  { path: '/admin/approvals', label: 'Admin: teacher applications (dummy)' },
  { path: '/admin/teachers', label: 'Admin: listed teachers (dummy)' },
  { path: '/admin/reviews', label: 'Admin: reviews (dummy)' },
  { path: '/admin/feedback', label: 'Admin: visitor feedback (dummy)' },
  { path: '/admin/audit', label: 'Admin: admin actions (dummy)' },
  { path: '/admin/papers', label: 'Admin: student uploads (dummy)' },
  { path: '/admin/library', label: 'Admin: library (dummy)' },
  { path: '/admin/admin-queue', label: 'Admin: admin queue (dummy)' },
  { path: '/admin/checkers', label: 'Admin: checkers (dummy)' },
  { path: '/admin/team', label: 'Admin: team (dummy)' },
  { path: '/admin/activity', label: 'Admin: activity (dummy)' },
  { path: '/admin/pipeline', label: 'Admin: pipeline and paper list (dummy)' },
  { path: '/admin/paper-approvals', label: 'Admin: ready to go live (dummy)' },
  { path: '/admin/checker-log', label: 'Admin: checker log (dummy)' },
];

/** Pages that have a dummy mode, for the preview toggle. */
export const DUMMY_PAGES: { path: string; label: string }[] = ALL_DUMMY_PAGES.filter((p) => !p.dormant).map(({ path, label }) => ({ path, label }));

function readParam(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('dummy');
  } catch {
    return null;
  }
}

export function setDummyMode(on: boolean): void {
  if (!PREVIEW_TOOLS) return;
  try {
    if (on) window.sessionStorage.setItem(KEY, '1');
    else window.sessionStorage.removeItem(KEY);
  } catch {
    // Private mode or blocked storage: the URL parameter still works.
  }
}

/** True only in a test build, and only when switched on for this tab. */
export function isDummyMode(): boolean {
  if (!PREVIEW_TOOLS) return false;
  if (typeof window === 'undefined') return false;
  const param = readParam();
  if (param === '1') {
    setDummyMode(true);
    return true;
  }
  if (param === '0') {
    setDummyMode(false);
    return false;
  }
  try {
    return window.sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
