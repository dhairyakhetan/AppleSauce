import { useEffect, useRef, useState } from 'react';

/* F3 "Pull to refresh" (Redesign Fun layer.dc.html) — a touch gesture for
   full-page-scroll list routes (Browse, PastPapers), not an inner scrollable
   panel. Tracked on `window`/`document` rather than a wrapped container, so it
   doesn't introduce a second scroll context on pages that already rely on
   normal document scroll (bottom nav clearance, sticky headers, etc. all
   assume that).

   State machine, matching the three pill states in the spec exactly:
     idle       — nothing happening
     pulling    — finger down, dragging from scrollY 0; pill scale/opacity
                  interpolate 0.8→1 / .6→1 with pull distance (`progress`)
     released   — finger lifted past the threshold; one bounce, THEN
     refreshing — the real onRefresh() is in flight
   Lifting before the threshold, or starting a pull anywhere but the very top
   of the page, does nothing — indistinguishable from a normal scroll.
*/

const THRESHOLD = 64; // px of pull distance to arm a refresh
const MAX_PULL = 96; // px — resistance cap, so the pill can't be dragged forever
const RESISTANCE = 0.5; // pull feels like half the finger's actual travel
const RELEASED_HOLD_MS = 260; // one bounce, per the spec, before refreshing shows
// Matches the pull-pulse keyframe's own duration (tailwind.config.ts) exactly,
// so "pulses twice, then the list re-enters" always completes both pulses
// before idle fires, even when the real refetch resolves in a few ms.
const MIN_REFRESHING_MS = 800;

export type PullToRefreshState = 'idle' | 'pulling' | 'released' | 'refreshing';

export function usePullToRefresh(onRefresh: () => Promise<unknown> | void, disabled = false) {
  const [state, setState] = useState<PullToRefreshState>('idle');
  const [pullDistance, setPullDistance] = useState(0);
  const startYRef = useRef<number | null>(null);
  const armedRef = useRef(false);

  /* stateRef/pullDistanceRef are the ONLY source of truth the handlers below
     read from. `setState`/`setPullDistance` exist purely to trigger a
     re-render with whatever the ref already holds — never the other way
     round. A ref that's kept in sync via `ref.current = state` back in the
     render body (the usual pattern) lags one commit behind rapid-fire native
     events: touchmove and touchend can both fire within the same synchronous
     tick (a fast flick, or — how this was actually caught, twice — two
     dispatched TouchEvents fired back to back in one script during testing),
     and React batches touchmove's setState without re-rendering before
     touchend's handler runs. Reading a render-synced ref at that point
     returns the PREVIOUS render's value, so a pull that legitimately crossed
     the threshold could read as under it and silently fail to refresh. Every
     transition below writes the ref first, synchronously, then calls
     setState with that same value — so onTouchEnd is never one commit
     behind onTouchMove regardless of how little real time separates them. */
  const stateRef = useRef<PullToRefreshState>('idle');
  const pullDistanceRef = useRef(0);

  /* onRefresh is held in a ref rather than named in the effect's dep array,
     for the same reason as the refs above: correctness that does not depend on
     the caller getting something subtle right.
     Neither consumer passes a stable identity -- Browse declares handleRetry
     fresh on every render, PastPapers passes an inline arrow -- so the effect
     re-ran constantly, tearing down and re-adding all four window listeners on
     every render of the two heaviest pages in the app. Worst during an active
     pull, where setDistance re-renders on every touchmove: the listeners were
     being replaced mid-gesture, dozens of times a second.
     Fixing it here rather than with useCallback at both call sites means a
     third consumer cannot reintroduce the bug by passing an inline arrow, and
     the listeners still always invoke the latest callback. */
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  function setPhase(next: PullToRefreshState) {
    stateRef.current = next;
    setState(next);
  }
  function setDistance(next: number) {
    pullDistanceRef.current = next;
    setPullDistance(next);
  }

  useEffect(() => {
    if (disabled) return;

    function onTouchStart(e: TouchEvent) {
      // Only a pull from the very top of the page can be a refresh — anywhere
      // else it's an ordinary scroll gesture and must be left alone.
      if (window.scrollY > 0 || stateRef.current !== 'idle') return;
      startYRef.current = e.touches[0].clientY;
      armedRef.current = true;
    }

    function onTouchMove(e: TouchEvent) {
      if (!armedRef.current || startYRef.current === null) return;
      const delta = e.touches[0].clientY - startYRef.current;
      if (delta <= 0) {
        // Finger moved back up (or never moved down) — not a pull.
        armedRef.current = false;
        startYRef.current = null;
        setDistance(0);
        if (stateRef.current === 'pulling') setPhase('idle');
        return;
      }
      // preventDefault only while we're genuinely mid-pull: this is what stops
      // the browser's own native overscroll-refresh (Chrome mobile / an
      // installed PWA) from firing alongside ours, without touching normal
      // downward scroll behaviour anywhere else on the page.
      e.preventDefault();
      setDistance(Math.min(delta * RESISTANCE, MAX_PULL));
      if (stateRef.current !== 'pulling') setPhase('pulling');
    }

    function onTouchEnd() {
      if (!armedRef.current) return;
      armedRef.current = false;
      startYRef.current = null;

      if (stateRef.current === 'pulling' && pullDistanceRef.current >= THRESHOLD) {
        setPhase('released');
        window.setTimeout(() => {
          setPhase('refreshing');
          const startedAt = Date.now();
          Promise.resolve(onRefreshRef.current()).finally(() => {
            const elapsed = Date.now() - startedAt;
            const wait = Math.max(0, MIN_REFRESHING_MS - elapsed);
            window.setTimeout(() => {
              setPhase('idle');
              setDistance(0);
            }, wait);
          });
        }, RELEASED_HOLD_MS);
      } else {
        setPhase('idle');
        setDistance(0);
      }
    }

    // Passive:false is required for preventDefault to have any effect on touchmove.
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  return { state, pullDistance, threshold: THRESHOLD };
}
