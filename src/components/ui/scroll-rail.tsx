import * as React from "react";

import { cn } from "@/lib/utils";

/* A horizontal scroller that never shows a native scrollbar.
 *
 * Why this exists: several rails across the site (filter chips, sort pills,
 * subject facets, board tabs, review cards) were plain `overflow-x-auto`, so
 * Windows and Linux painted a grey scrollbar track *inside* the UI — a piece of
 * OS chrome sitting in the middle of a designed surface. Hiding it alone is not
 * enough, though: the scrollbar was the only thing telling you the row could
 * scroll at all. So this replaces it with an affordance that belongs to the
 * design instead of the OS:
 *
 *   - a soft fade at whichever edge has content beyond it, and only there. Fade
 *     on the right means "more this way"; both edges means you are mid-row;
 *     neither means the row fits and there is nothing to discover.
 *   - a one-time nudge on first appearance, so the hint is visible before the
 *     user touches anything. It runs once per mount and never loops — a rail
 *     that keeps twitching is noise, not information.
 *
 * The fades are `pointer-events-none` gradients from the surface colour, so
 * they read as the content dissolving rather than as a control. Pass the colour
 * the rail sits on via `fadeFrom` when it is not the page background, otherwise
 * the fade blends to the wrong colour and looks like a smudge.
 *
 * Concentric radius: when a rail is inset inside a rounded container, its own
 * radius must be the parent's radius minus the gap between them (code.md C1's
 * concentric rule, the same maths as the teacher-card photo). Pass `radius`
 * rather than guessing a nice-looking number.
 */

export interface ScrollRailProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Tailwind colour the edge fades blend to. Defaults to the page background. */
  fadeFrom?: string;
  /** Border radius in px. Set this to (parent radius − inset) when nested. */
  radius?: number;
  /** Suppresses the first-run nudge — use when the rail is offscreen on load. */
  noNudge?: boolean;
  /**
   * Layout for the ROW OF ITEMS (e.g. "flex items-center gap-2"). It lands on
   * the content element, not the scroll container — putting flex on the
   * scroller would do nothing, because the nudge wrapper sits between them.
   */
  className?: string;
  /** Layout for the rail ITSELF within its parent (e.g. "flex-1"). */
  railClassName?: string;
  children: React.ReactNode;
}

export function ScrollRail({
  fadeFrom = "from-background",
  radius,
  noNudge = false,
  className,
  railClassName,
  children,
  ...props
}: ScrollRailProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [atStart, setAtStart] = React.useState(true);
  const [atEnd, setAtEnd] = React.useState(true);
  const [nudge, setNudge] = React.useState(false);

  /* One measurement function for scroll, resize and content change, so the
     fades cannot disagree with reality after a filter changes the chip count. */
  const measure = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    // 1px of slack: fractional layout widths otherwise leave a fade stuck on.
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft >= max - 1);
  }, []);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Children too: a chip appearing changes scrollWidth without resizing the rail.
    Array.from(el.children).forEach((child) => ro.observe(child));
    return () => ro.disconnect();
  }, [measure, children]);

  React.useEffect(() => {
    if (noNudge) return;
    const el = ref.current;
    if (!el) return;
    if (el.scrollWidth - el.clientWidth < 24) return; // nothing to reveal
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const t = window.setTimeout(() => setNudge(true), 400);
    const done = window.setTimeout(() => setNudge(false), 1400);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(done);
    };
  }, [noNudge]);

  return (
    <div className={cn("relative min-w-0", railClassName)} style={radius ? { borderRadius: radius } : undefined}>
      <div
        ref={ref}
        onScroll={measure}
        className="scrollbar-hide min-w-0 overflow-x-auto overflow-y-visible"
        style={radius ? { borderRadius: radius } : undefined}
        {...props}
      >
        <div className={cn("w-max", className, nudge && "animate-rail-nudge motion-reduce:animate-none")}>
          {children}
        </div>
      </div>

      {/* Edge fades. aria-hidden and pointer-events-none: they are a hint about
          the content, never something to click, and a screen reader gets the
          same information from the scroll container itself. */}
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r to-transparent transition-opacity duration-200",
          fadeFrom,
          atStart ? "opacity-0" : "opacity-100",
        )}
        style={radius ? { borderTopLeftRadius: radius, borderBottomLeftRadius: radius } : undefined}
      />
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l to-transparent transition-opacity duration-200",
          fadeFrom,
          atEnd ? "opacity-0" : "opacity-100",
        )}
        style={radius ? { borderTopRightRadius: radius, borderBottomRightRadius: radius } : undefined}
      />
    </div>
  );
}

export default ScrollRail;
