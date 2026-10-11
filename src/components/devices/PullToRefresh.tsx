import { useEffect, useRef, useState } from 'react';

import logoImage from '@/assets/shikshaq-logo.svg';
import { usePullToRefresh, type PullToRefreshState } from '@/hooks/use-pull-to-refresh';

/* F3 "Pull to refresh" (Redesign Fun layer.dc.html, exports/fun-03.png).
   Literal spec per state — bg / opacity / scale / logo filter:
     Pulling    #F0EAE2  .6   .8→1 (interpolated with distance)  none
     Release    #FF8000  1    1                                   invert-to-white
     Refreshing #1B1A18  1    1    (pulses twice)                 invert-to-white

   "Release" in the spec names the MOMENT of lifting past the threshold — one
   held frame with a bounce — immediately followed by "Refreshing" while the
   real onRefresh() is in flight. That's the `released` → `refreshing` state
   pair below. Reduced motion keeps the colour states (they carry meaning —
   which state you're in) but drops the bounce/pulse keyframes, matching the
   site's existing motion-reduce convention elsewhere. */

const STATE_STYLES: Record<Exclude<PullToRefreshState, 'idle'>, { bg: string; filter: string }> = {
  pulling: { bg: 'var(--warm-muted)', filter: 'none' },
  released: { bg: 'hsl(var(--brand))', filter: 'brightness(0) invert(1)' },
  refreshing: { bg: 'var(--panel-dark)', filter: 'brightness(0) invert(1)' },
};

export interface PullToRefreshProps {
  onRefresh: () => Promise<unknown> | void;
  disabled?: boolean;
  children: React.ReactNode;
}

export function PullToRefresh({ onRefresh, disabled, children }: PullToRefreshProps) {
  const { state, pullDistance, threshold } = usePullToRefresh(onRefresh, disabled);

  // The list itself gets a brief re-entry animation once a refresh completes
  // ("then the list re-enters" per the spec) — retriggered by bumping a key.
  const [listKey, setListKey] = useState(0);
  const prevState = useRef<PullToRefreshState>('idle');
  useEffect(() => {
    if (prevState.current === 'refreshing' && state === 'idle') {
      setListKey((k) => k + 1);
    }
    prevState.current = state;
  }, [state]);

  const showPill = state !== 'idle';
  const progress = Math.min(pullDistance / threshold, 1);
  // Pulling: interpolate 0.8 -> 1 with distance, per spec. Released/Refreshing
  // hold at the spec's fixed values instead of the live drag progress.
  const scale = state === 'pulling' ? 0.8 + progress * 0.2 : 1;
  const opacity = state === 'pulling' ? 0.6 + progress * 0.4 : 1;
  const style = state === 'idle' ? STATE_STYLES.pulling : STATE_STYLES[state];

  return (
    <div className="relative">
      {/* aria-hidden: this is a redundant visual echo of an action already
          available without it (scroll-to-top + a manual refresh elsewhere, or
          simply revisiting the route) — a screen reader user loses nothing by
          not hearing about a gesture indicator mid-scroll. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center overflow-hidden motion-reduce:transition-none"
        style={{
          height: showPill ? 72 : 0,
          transition: state === 'idle' ? 'height 200ms ease-out' : 'none',
        }}
      >
        <div className="flex h-full items-center">
          <span
            className={
              'flex h-11 items-center justify-center rounded-full px-3 transition-[background-color] duration-150 ' +
              (state === 'released' ? 'animate-pull-bounce motion-reduce:animate-none' : '') +
              (state === 'refreshing' ? ' animate-pull-pulse motion-reduce:animate-none' : '')
            }
            style={{ backgroundColor: style.bg, opacity, transform: `scale(${scale})` }}
          >
            <img
              src={logoImage}
              alt=""
              className="block h-7 w-auto"
              style={{ filter: style.filter }}
            />
          </span>
        </div>
      </div>

      <div
        key={listKey}
        style={{
          transform: state === 'pulling' || state === 'released' ? `translateY(${showPill ? 56 : 0}px)` : undefined,
          transition: state === 'idle' ? 'transform 200ms ease-out' : undefined,
        }}
        className={listKey > 0 ? 'animate-fade-slide-up motion-reduce:animate-none' : undefined}
      >
        {children}
      </div>
    </div>
  );
}

export default PullToRefresh;
