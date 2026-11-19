import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * Sitewide scroll behaviour on navigation. Replaces the old ScrollToTop,
 * which only ever did the PUSH half of this (window.scrollTo(0, 0) on every
 * pathname change) and had no notion of "the reader was here before."
 *
 * The rules (asked for explicitly, not inferred):
 *   - PUSH/REPLACE to a different page: start at the top. If the URL carries
 *     a #hash, scroll to that element instead.
 *   - POP (back/forward): restore the scroll position that history entry
 *     had, waiting for async content to arrive first so restoring doesn't
 *     land short because the page was still tall enough for the old offset.
 *   - Same pathname, only the search string changed (Browse's `?filter_...`
 *     chips push/replace a new query on the same page): keep the position
 *     exactly where it is. That is not "the reader went somewhere", it's a
 *     filter changing what the list they're already looking at contains.
 *
 * One instance, mounted once inside the router (same spot ScrollToTop used
 * to sit) -- multiple instances would each try to own scrollRestoration and
 * the scroll listener, racing each other for no reason.
 */
export function ScrollManager() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const prevLocationRef = useRef(location);
  const restoreCancelRef = useRef<{ cancelled: boolean } | null>(null);

  // Take restoration away from the browser so ours is the only thing acting.
  // Chrome/Firefox otherwise restore on their own timing -- immediately, on
  // whatever the page's height happens to be that instant -- which is
  // exactly the "landed at the wrong spot because the page was still short"
  // failure this component exists to avoid.
  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      const previous = window.history.scrollRestoration;
      window.history.scrollRestoration = 'manual';
      return () => {
        window.history.scrollRestoration = previous;
      };
    }
  }, []);

  // Continuously persist THIS location's scroll position, keyed by history
  // entry (location.key is unique per entry, unlike pathname+search which
  // repeats across visits to the same URL). Read back on a future POP to
  // that exact entry.
  //
  // useLayoutEffect, and no save in the cleanup: by the time a passive
  // cleanup ran, the NEXT page had already committed, the document had shrunk
  // to its loading state and the browser had clamped scrollY -- so the
  // "final position" saved for the page being left was ~0, and so was any
  // scroll event the clamp fired while the old listener was still attached.
  // Back to Browse then restored to the top. Swapping listeners in the layout
  // phase detaches the old key before that clamp can be recorded against it;
  // the scroll events already recorded the real position.
  useLayoutEffect(() => {
    const key = location.key;
    const onScroll = () => saveScroll(key, window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('beforeunload', onScroll);
    // Also on every click, in the capture phase: that runs before the
    // router's own <Link> handler navigates, so the position is exact even
    // if no scroll event has fired since the last scroll (scroll events are
    // frame-throttled and don't fire at all in a tab that isn't rendering).
    document.addEventListener('click', onScroll, true);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('beforeunload', onScroll);
      document.removeEventListener('click', onScroll, true);
    };
  }, [location.key]);

  useEffect(() => {
    const prev = prevLocationRef.current;
    prevLocationRef.current = location;

    if (restoreCancelRef.current) restoreCancelRef.current.cancelled = true;

    // Same page, only the query string moved (filter chips, sort, search
    // overlay committing a term to the URL...): the reader didn't go
    // anywhere, so don't move them. This applies whichever of PUSH/REPLACE
    // produced it -- Browse uses both for different controls -- but never to
    // POP, where the destination is a specific, possibly differently-
    // scrolled history entry that deserves its own restoration below.
    const sameRouteSearchOnly =
      navigationType !== 'POP' &&
      prev.pathname === location.pathname &&
      prev.search !== location.search;
    if (sameRouteSearchOnly) return;

    if (location.hash) {
      const id = decodeURIComponent(location.hash.slice(1));
      // One frame so the destination page has painted before we look for
      // the target element.
      const raf = requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView({ block: 'start' });
      });
      return () => cancelAnimationFrame(raf);
    }

    if (navigationType === 'POP') {
      const target = readScroll(location.key);
      if (!target) {
        window.scrollTo(0, 0);
        return;
      }
      restoreCancelRef.current = restoreTo(target);
      return () => {
        if (restoreCancelRef.current) restoreCancelRef.current.cancelled = true;
      };
    }

    // PUSH or REPLACE to a genuinely different page.
    window.scrollTo(0, 0);
  }, [location, navigationType]);

  return null;
}

const STORAGE_KEY = 'shikshaq_scroll_positions';
const MAX_ENTRIES = 50;
const RESTORE_TIMEOUT_MS = 1500;
const RESTORE_POLL_MS = 100;
const SMOOTH_CHECK_MS = 700;

function readStore(): Record<string, number> {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function saveScroll(key: string, y: number): void {
  try {
    const store = readStore();
    store[key] = y;
    // Bound the store -- a long session visits far more history entries than
    // are worth remembering, and sessionStorage has a size limit. Object key
    // order is insertion order, so this drops the oldest entries first.
    const keys = Object.keys(store);
    if (keys.length > MAX_ENTRIES) {
      for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete store[k];
    }
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Private mode or blocked storage: the position just won't survive.
    // Fails closed to "start at top" elsewhere, never throws.
  }
}

function readScroll(key: string): number | undefined {
  const value = readStore()[key];
  return typeof value === 'number' && value > 0 ? value : undefined;
}

/**
 * Restores to `target`, waiting for the page to grow tall enough first.
 *
 * Lists load async, so a POP that fires the instant the new page mounts
 * would often find a page shorter than the old scroll offset and clamp to
 * whatever the bottom happens to be -- the wrong spot, corrected only once
 * more content streams in (if it ever does). Polling for a page tall enough
 * to actually hold `target`, up to RESTORE_TIMEOUT_MS, avoids that.
 *
 * Smooth once the page has settled (tall enough and its height unchanged for
 * one poll), with a check SMOOTH_CHECK_MS later that jumps directly if the
 * smooth scroll was cancelled; an instant jump if RESTORE_TIMEOUT_MS passes
 * first (best effort rather than never resolving). Any wheel, touch or key
 * input from the reader cancels the whole restore.
 */
function restoreTo(target: number): { cancelled: boolean } {
  const state = { cancelled: false };
  const start = Date.now();
  let lastHeight = -1;

  /* The reader taking over always wins: never yank them back mid-scroll. */
  const onUserInput = () => { state.cancelled = true; };
  const INPUTS = ['wheel', 'touchstart', 'keydown'] as const;
  INPUTS.forEach((t) => window.addEventListener?.(t, onUserInput, { passive: true, once: true }));
  const stopListening = () => INPUTS.forEach((t) => window.removeEventListener?.(t, onUserInput));

  const tryRestore = () => {
    if (state.cancelled) return stopListening();
    const height = document.documentElement.scrollHeight;
    const tall = height - window.innerHeight >= target;
    /* "Settled", not merely "tall": a loading skeleton is often already tall
       enough, and the real content swapping in a moment later cancelled the
       smooth scroll mid-flight (measured: back to Browse started a smooth
       scroll on the 7,100px skeleton, the list replaced it at ~400ms, and the
       page stayed at 0). Waiting for one unchanged poll avoids starting on
       the skeleton. */
    const settled = tall && height === lastHeight;
    lastHeight = height;
    if (Date.now() - start > RESTORE_TIMEOUT_MS) {
      window.scrollTo(0, target);
      return stopListening();
    }
    if (!settled) {
      setTimeout(tryRestore, RESTORE_POLL_MS);
      return;
    }
    window.scrollTo({ top: target, left: 0, behavior: 'smooth' });
    /* Belt and braces: if a late layout change still cancelled the smooth
       scroll, land there directly rather than leave the reader at the top. */
    setTimeout(() => {
      stopListening();
      if (state.cancelled) return;
      if (Math.abs(window.scrollY - target) > 50) window.scrollTo(0, target);
    }, SMOOTH_CHECK_MS);
  };

  tryRestore();
  return state;
}

/* Exported for the pure-logic tests -- the storage/timeout maths deserves to
   be pinned independently of mounting a real router and a real DOM. */
export {
  readStore as __readStore,
  saveScroll as __saveScroll,
  readScroll as __readScroll,
  restoreTo as __restoreTo,
  STORAGE_KEY as __STORAGE_KEY,
  MAX_ENTRIES as __MAX_ENTRIES,
  RESTORE_TIMEOUT_MS as __RESTORE_TIMEOUT_MS,
};
