import * as React from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PanelId } from '@/components/checker/Panels';
import { BENTO_MIN_WIDTH, nearestPaneIndex } from '@/lib/checker-bento';
import '@/components/checker/checker-bento.css';

/* Pieces of the verify screen's bento layout (12 Oct 2026).

   Tablet and up (768 and wider) the screen is a grid that fits one viewport:
   the question on the left, the printed paper on the right, the actions in a
   bar underneath. On a phone the same tiles are swipeable (Question | Page |
   Fix) with the actions pinned at the bottom. Only a tile ever scrolls, never
   the page.

   Pure presentation, no data access. */

const BENTO_QUERY = `(min-width: ${BENTO_MIN_WIDTH}px)`;

/** True from 768 wide. Reads matchMedia, the same source the CSS breakpoints use (innerWidth counts the scrollbar). */
export function useBentoWide(): boolean {
  const [wide, setWide] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(BENTO_QUERY).matches : true,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(BENTO_QUERY);
    const onChange = () => setWide(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return wide;
}

/**
 * Where a scroll area should be so that a block (`top` and `height`, measured from the top of the scrolled
 * content) is fully in view with a little air around it. Nothing moves when it already is. A block taller
 * than the area is lined up at its top. Pure, so it is tested without a browser.
 */
export function revealOffset(a: { scrollTop: number; viewHeight: number; top: number; height: number; margin?: number }): number {
  const margin = a.margin ?? 12;
  const bottom = a.top + a.height;
  if (a.height + margin * 2 > a.viewHeight) return Math.max(0, a.top - margin);
  if (a.top - margin < a.scrollTop) return Math.max(0, a.top - margin);
  if (bottom + margin > a.scrollTop + a.viewHeight) return bottom + margin - a.viewHeight;
  return a.scrollTop;
}

/**
 * A scroll area inside a tile, with a soft edge at the foot while there is more
 * below (and a hairline at the top once it has scrolled). It fills the room its
 * parent gives it and never grows past it, so a long question scrolls here and
 * never pushes the action bar off the screen.
 */
export function FadeScroll({
  children,
  className,
  innerClassName,
  white,
  testId = 'tile-scroll',
  revealKey,
  revealSelector,
}: {
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
  /** The tile behind is white paper, not the card fill. */
  white?: boolean;
  testId?: string;
  /** When this changes to a non-empty value, `revealSelector` is scrolled into view (see {@link revealOffset}). */
  revealKey?: string;
  revealSelector?: string;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const inner = useRef<HTMLDivElement | null>(null);
  const [more, setMore] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  // The docked tools row sits at the foot of the area: the soft edge goes above it, not over it.
  const [dockHeight, setDockHeight] = useState(0);

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 4);
    setScrolled(el.scrollTop > 4);
    setDockHeight(el.querySelector<HTMLElement>('[data-testid="tools-dock"]')?.offsetHeight ?? 0);
  }, []);

  useLayoutEffect(() => {
    measure();
  });
  // A long question opens with the part being checked in view (it may sit below a long passage),
  // scrolled only as far as needed so the stem above it stays visible.
  useLayoutEffect(() => {
    if (!revealKey || !revealSelector) return;
    const el = scroller.current;
    const target = el?.querySelector<HTMLElement>(revealSelector);
    if (!el || !target) return;
    // Layout position inside the scrolled content. offsetTop ignores the transform a card has while it
    // slides in (getBoundingClientRect does not), so the target is not mis-measured during the entrance.
    let top = 0;
    let node: HTMLElement | null = target;
    while (node && node !== el) {
      top += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }
    if (node !== el) top = target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
    const dock = el.querySelector<HTMLElement>('[data-testid="tools-dock"]')?.offsetHeight ?? 0;
    el.scrollTop = revealOffset({ scrollTop: el.scrollTop, viewHeight: el.clientHeight, top, height: target.offsetHeight + dock });
    measure();
    // Only when the key changes: later renders (typing, opening Fix it) must not move the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealKey]);
  useEffect(() => {
    const el = scroller.current;
    const body = inner.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    if (body) ro.observe(body);
    return () => ro.disconnect();
  }, [measure]);

  return (
    <div className={cn('relative min-h-0 flex-1', className)} data-testid={testId} data-more={more ? 'true' : 'false'} data-scrolled={scrolled ? 'true' : 'false'}>
      <div ref={scroller} onScroll={measure} className="checker-tile-scroll relative h-full overflow-y-auto">
        <div ref={inner} className={innerClassName}>
          {children}
        </div>
      </div>
      <div
        aria-hidden="true"
        style={dockHeight ? { bottom: dockHeight } : undefined}
        data-testid="scroll-cue"
        className={cn(
          'checker-fade pointer-events-none absolute inset-x-0 bottom-0 h-8 transition-opacity duration-150',
          white && 'checker-fade-white',
          more ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div
        aria-hidden="true"
        className={cn('pointer-events-none absolute inset-x-0 top-0 h-px bg-warm-hairline transition-opacity duration-150', scrolled ? 'opacity-100' : 'opacity-0')}
      />
    </div>
  );
}

/** A tile that is not one of the framed sides: the flags, the paper strip. */
export function BentoTile({ children, className, ...rest }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section
      {...rest}
      className={cn('min-w-0 rounded-[20px] border border-warm-hairline bg-card md:rounded-[18px]', className)}
    >
      {children}
    </section>
  );
}

/**
 * The picture, full screen. Tap the picture to switch between fitting the
 * screen and the full width of the picture (then it scrolls), Escape or the
 * close button closes. Rendered into the body so no tile clips it.
 */
export function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const [full, setFull] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  if (openerRef.current === null && typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
    openerRef.current = document.activeElement;
  }
  useEffect(() => {
    closeRef.current?.focus();
    const opener = openerRef.current;
    return () => {
      if (opener && opener.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Tab') {
        // The close button is the only thing to reach.
        e.preventDefault();
        closeRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      data-testid="image-lightbox"
      className="fixed inset-0 z-[60] flex flex-col bg-black/80 p-3 animate-in fade-in-0 duration-150"
      onClick={onClose}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 pb-2">
        <p className="min-w-0 truncate text-[13px] font-semibold text-white">{full ? 'Tap the picture to fit the screen' : 'Tap the picture for its full width'}</p>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close the picture"
          className="tap-44 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-foreground transition-transform duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <div className={cn('min-h-0 flex-1 rounded-[18px] bg-white p-2', full ? 'overflow-auto' : 'flex items-center justify-center overflow-hidden')} onClick={(e) => e.stopPropagation()}>
        <img
          src={src}
          alt={alt}
          draggable={false}
          onClick={() => setFull((v) => !v)}
          className={cn(full ? 'h-auto w-full max-w-none cursor-zoom-out' : 'max-h-full max-w-full cursor-zoom-in object-contain')}
        />
      </div>
    </div>,
    document.body,
  );
}

/**
 * Phone: the tiles side by side in a row you swipe through, one per screen.
 * The tab bar above is the same state, so tapping a tab scrolls here and
 * swiping here moves the tab. The selected tile is set the moment this mounts
 * (no scroll), so when the next question swipes in, the same tile is showing.
 */
export function TilePager({
  value,
  onChange,
  order,
  panes,
  reducedMotion,
}: {
  value: PanelId;
  onChange: (next: PanelId) => void;
  order: PanelId[];
  panes: Partial<Record<PanelId, React.ReactNode>>;
  reducedMotion: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  // The tile the pager itself last reported, so the effect below does not scroll back to it.
  const reported = useRef<PanelId>(value);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const programmaticUntil = useRef(0);

  const indexOf = (id: PanelId) => Math.max(0, order.indexOf(id));
  // Where a tile starts inside the row (the tiles have a gap between them).
  const paneLeft = (el: HTMLElement, i: number) => (el.children[i] as HTMLElement | undefined)?.offsetLeft ?? i * el.clientWidth;

  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = paneLeft(el, indexOf(value));
    // Only on mount: later changes go through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reported.current === value) return;
    reported.current = value;
    const left = paneLeft(el, indexOf(value));
    if (Math.abs(el.scrollLeft - left) < 2) return;
    programmaticUntil.current = Date.now() + (reducedMotion ? 80 : 500);
    el.scrollTo({ left, behavior: reducedMotion ? 'auto' : 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reducedMotion]);

  // A turned phone changes the width: keep the selected tile in view.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      el.scrollLeft = paneLeft(el, indexOf(reported.current));
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  function onScroll() {
    if (Date.now() < programmaticUntil.current) return;
    if (settleTimer.current) clearTimeout(settleTimer.current);
    // Decide once the swipe has stopped, not on every pixel of it.
    settleTimer.current = setTimeout(() => {
      const el = ref.current;
      if (!el || el.clientWidth === 0) return;
      const next = order[nearestPaneIndex(Array.from(el.children, (c) => (c as HTMLElement).offsetLeft), el.scrollLeft)];
      if (next && next !== reported.current) {
        reported.current = next;
        onChange(next);
      }
    }, 90);
  }

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      data-testid="tile-pager"
      className="checker-pager relative flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden"
    >
      {order.map((id) => {
        const selected = id === value;
        return (
          <div
            key={id}
            data-pane={id}
            data-selected={selected ? 'true' : 'false'}
            // A tile that is off screen cannot be tabbed into or tapped.
            {...(selected ? {} : ({ inert: '' } as Record<string, string>))}
            className="checker-pane flex h-full min-h-0 w-full shrink-0 grow-0 basis-full flex-col"
          >
            {panes[id]}
          </div>
        );
      })}
    </div>
  );
}
