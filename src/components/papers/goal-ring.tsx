import * as React from "react";

import { cn } from "@/lib/utils";

/* Redesign P9 (components.md §1).

   SVG progress ring: 24–86px, 4–9px stroke, round caps, rotated −90° so the
   sweep starts at twelve o'clock.

   SCOPE (binding, components.md §7): the weekly paper goal and nothing else.
   "A progress ring for anything except the weekly paper goal" is on the
   must-never-build list — use ProgressSteps (C14) for forms and a plain bar for
   profile completeness.

   Animates ONCE on mount, 500ms, --ease-settle. Never loops: design.md §0.8
   forbids infinite motion. */
export interface GoalRingProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Papers read this week. */
  value: number;
  /** The week's goal. */
  goal: number;
  /** Outer diameter in px (24–86). */
  size?: number;
  /** Stroke width in px (4–9). */
  stroke?: number;
  /** Hide the centre label when the count is stated beside the ring instead. */
  showValue?: boolean;
}

const GoalRing = React.forwardRef<HTMLDivElement, GoalRingProps>(
  ({ className, value, goal, size = 64, stroke = 7, showValue = true, ...props }, ref) => {
    const safeGoal = Math.max(1, goal);
    const pct = Math.min(1, Math.max(0, value / safeGoal));
    const r = (size - stroke) / 2;
    const circumference = 2 * Math.PI * r;

    /* Start fully empty, then run to the real offset on the next frame so the
       transition has something to animate from. Runs once — there is no
       dependency on `pct` beyond the initial paint being correct. */
    const [drawn, setDrawn] = React.useState(false);
    React.useEffect(() => {
      const id = requestAnimationFrame(() => setDrawn(true));
      return () => cancelAnimationFrame(id);
    }, []);

    const offset = drawn ? circumference * (1 - pct) : circumference;

    return (
      <div
        ref={ref}
        className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
        role="img"
        aria-label={`${value} of ${goal} papers read this week`}
        style={{ width: size, height: size }}
        {...props}
      >
        <svg width={size} height={size} className="-rotate-90" aria-hidden>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--warm-band)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            /* Papers are the indigo mode (tokens.md §2). */
            stroke="hsl(var(--brand-blue))"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{
              transition: "stroke-dashoffset var(--duration-entrance) var(--ease-settle)",
            }}
          />
        </svg>
        {showValue ? (
          <span
            aria-hidden
            className="absolute font-display font-extrabold tabular-nums text-foreground"
            style={{ fontSize: Math.max(11, Math.round(size * 0.3)) }}
          >
            {value}
          </span>
        ) : null}
      </div>
    );
  },
);
GoalRing.displayName = "GoalRing";

export { GoalRing };
