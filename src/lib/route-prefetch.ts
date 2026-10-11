/* Fetch a route's JavaScript before the click, not after it.

   Every page in this app is a lazy chunk, so the first visit to a route pays
   for downloading and parsing it while the reader stares at a spinner —
   measured at ~190ms of the ~630ms it took to open Browse from Home. The
   pointer arrives at a link a good few hundred milliseconds before the click
   does, which is enough time to have the chunk already in memory.

   Deliberately modest about it:
   - only same-origin, in-app hrefs
   - each route imported at most once (the browser caches the module anyway,
     but this avoids the repeated promise churn on a link the pointer crosses
     several times)
   - nothing prefetches on a slow or metered connection, where speculative
     downloads cost the reader real money
   - `pointerenter` and `touchstart`, so it covers mouse and touch alike */

type Importer = () => Promise<unknown>;
/** Warms the FIRST query a route's chunk will run, not just the chunk itself
 *  (P1-6) — see warmBrowseTeachersList/warmPastPapersBank below. Fire-and-
 *  forget: never throws, never awaited by the caller. */
type DataWarmer = () => void;

/* Paths are matched longest-first, so '/past-papers/results' wins over
   '/past-papers'. Keep in step with the lazy imports in App.tsx — a missing
   entry costs nothing but the prefetch. */
const ROUTES: [string, Importer, DataWarmer?][] = [
  ['/all-tuition-teachers-in-kolkata', () => import('@/pages/Browse'), () => warmBrowseTeachersList()],
  ['/past-papers/results', () => import('@/pages/PaperResults')],
  ['/past-papers', () => import('@/pages/PastPapers'), () => warmPastPapersBank()],
  ['/submit-a-paper', () => import('@/pages/SubmitPaper')],
  ['/tuition-teachers/', () => import('@/pages/TeacherProfile')],
  ['/recommend-teacher', () => import('@/pages/RecommendTeacher')],
  ['/auth', () => import('@/pages/Auth')],
  ['/about', () => import('@/pages/About')],
  ['/help', () => import('@/pages/Help')],
  ['/contact', () => import('@/pages/Contact')],
  ['/join', () => import('@/pages/Join')],
  ['/faq', () => import('@/pages/FAQ')],
  /* Added — every one of these is a real, commonly-hovered nav/footer/card
     destination that was silently missing from this table (a missing entry
     costs nothing but the prefetch, so nothing broke; it just meant these
     routes never got the warm-chunk treatment the rest of the app has had
     since this file was written). */
  ['/account', () => import('@/pages/Account')],
  ['/dashboard/teacher', () => import('@/pages/TeacherDashboard')],
  ['/subjects', () => import('@/pages/SubjectsPage')],
  ['/schools', () => import('@/pages/SchoolsPage')],
  ['/school/', () => import('@/pages/SchoolPage')],
  ['/blog/', () => import('@/pages/BlogPost')],
  ['/blog', () => import('@/pages/Blog')],
  ['/select-role', () => import('@/pages/SelectRole')],
  ['/teacher-terms-agreement', () => import('@/pages/TeacherTermsAgreement')],
  ['/signup-success', () => import('@/pages/SignUpSuccess')],
];

/* The ~30 subject and 5 board landing pages (`/maths-tuition-teachers-in-
   kolkata`, `/icse-tuition-teachers-in-kolkata`, ...) all share one suffix
   but no common prefix, so they can't join the table above without listing
   every slug — duplicating App.tsx's route list a second time, which is
   exactly the staleness risk this file's own top comment warns about ("keep
   in step with the lazy imports"). A suffix rule needs only the 5 board
   slugs (subject is the default), so it stays correct as subjects are added
   without ever being touched again. */
const BOARD_SLUGS = new Set([
  'cbse-ncert', 'icse', 'igcse', 'international-board', 'state-board',
]);

function subjectOrBoardImport(pathname: string): [string, Importer] | null {
  const m = /^\/([a-z-]+)-tuition-teachers-in-kolkata\/?$/.exec(pathname);
  if (!m || m[1] === 'all') return null; // '/all-...' is Browse, already in ROUTES
  return BOARD_SLUGS.has(m[1])
    ? ['board-page', () => import('@/pages/BoardPage')]
    : ['subject-page', () => import('@/pages/SubjectPage')];
}

import { isSafeRedirect } from '@/lib/safe-redirect';
import { isMeteredConnection } from '@/lib/net-conditions';
import { pageAllTeachers } from '@/lib/teachers';
import { getCache, setCache, CACHE_TTL, getTeachersListCacheKey } from '@/utils/cache';
import { loadPaperIndex } from '@/lib/question-bank';

/* Same shape Browse.tsx's own unfiltered fetch uses (selectCols, page size,
   page cap, cache key) — matched deliberately so a warm arrives in the exact
   cache slot Browse.tsx's own `getCache(getTeachersListCacheKey(limit))` call
   reads on mount. Only the unfiltered default list is worth warming here: a
   hover carries no filter state, so that's the query the vast majority of
   Browse visits actually run first. */
const BROWSE_SELECT_COLS = 'id, name, slug, image_url, bio, location, is_featured, subjects(name, slug)';
const BROWSE_PAGE_SIZE = 500;
const BROWSE_MAX_PAGES = 6;
let browseWarmAttempted = false;

/** Fire-and-forget: pre-populates the localStorage cache Browse.tsx's own
 *  unfiltered fetch reads on mount, so a warm hover means Browse opens
 *  straight from cache instead of waiting on the same network round trip
 *  its chunk import already started warming in parallel. */
function warmBrowseTeachersList(): void {
  if (browseWarmAttempted) return;
  browseWarmAttempted = true;
  const limit = BROWSE_PAGE_SIZE * BROWSE_MAX_PAGES;
  const cacheKey = getTeachersListCacheKey(limit);
  if (getCache(cacheKey)) return; // already warm from an earlier visit this session
  pageAllTeachers({ selectCols: BROWSE_SELECT_COLS, pageSize: BROWSE_PAGE_SIZE, maxPages: BROWSE_MAX_PAGES })
    .then((paged) => {
      if (paged.failed) return;
      setCache(cacheKey, { rows: paged.rows, truncated: paged.truncated }, CACHE_TTL.TEACHERS_LIST);
    })
    .catch(() => { browseWarmAttempted = false; }); // let a later hover retry
}

/** loadPaperIndex() memoises its own result module-wide (question-bank.ts),
 *  independent of whatever react-query key a caller uses — so warming it here
 *  means PastPapers.tsx's own `bankQuery` (queryKey ['past-papers','bank'])
 *  gets the already-resolved promise instead of starting the fetch itself.
 *  This is the heaviest of PastPapers' four queries (the whole bank index),
 *  and the only one safe to duplicate here without re-implementing the
 *  landing query's own Promise.all of five Supabase calls a second time in a
 *  file this far from where they're defined. */
function warmPastPapersBank(): void {
  void loadPaperIndex().catch(() => {});
}

const done = new Set<string>();

/** Warms the chunk behind a pathname. Safe to call as often as you like. */
export function prefetchRoute(pathname: string): void {
  if (isMeteredConnection()) return;
  const staticMatch = ROUTES
    .filter(([prefix]) => pathname === prefix || pathname.startsWith(prefix))
    .sort((a, b) => b[0].length - a[0].length)[0];
  const match = staticMatch ?? subjectOrBoardImport(pathname);
  if (!match) return;
  const [key, load, warmData] = match;
  if (done.has(key)) return;
  done.add(key);
  void load().catch(() => { done.delete(key); });
  warmData?.();
}

/** One delegated listener for the whole app; returns its own cleanup. */
export function installRoutePrefetch(): () => void {
  if (typeof window === 'undefined') return () => {};

  const onIntent = (e: Event) => {
    const el = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!el) return;
    const href = el.getAttribute('href');
    /* Same parser-backed check the auth redirects use. Not exploitable here
       today -- prefetchRoute maps a path to a lazy import rather than fetching
       an arbitrary origin -- but teacher bios render sanitised HTML that can
       contain anchors, so this listener does see attacker-influenced hrefs and
       should not rely on the mapping staying harmless. */
    if (!isSafeRedirect(href)) return;
    if (el.target && el.target !== '_self') return;
    prefetchRoute(href.split('?')[0].split('#')[0]);
  };

  window.addEventListener('pointerenter', onIntent, { capture: true, passive: true });
  window.addEventListener('touchstart', onIntent, { capture: true, passive: true });
  return () => {
    window.removeEventListener('pointerenter', onIntent, { capture: true });
    window.removeEventListener('touchstart', onIntent, { capture: true });
  };
}
