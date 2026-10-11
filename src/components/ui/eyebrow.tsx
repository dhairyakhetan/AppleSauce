import * as React from "react";

import { cn } from "@/lib/utils";

/* Redesign P5 (components.md §1).

   components.md lists this as "inline", but it appears above nearly every slab,
   section and card in the redesign, so it lives here as one component rather
   than as a copy-pasted class string that drifts.

   Note: tokens.md §1 calls the colour class `text-warm-quaternary`; the real
   class in tailwind.config.ts is `text-warm-label` (same var, --text-quaternary,
   same #A39A90). Reported in the Phase 0 audit; not renamed, per handoff §7.

   Tracking is .07em — text-label's own tracking is .04em, so it is set here. */
export interface EyebrowProps extends React.HTMLAttributes<HTMLElement> {
  /** On a near-black or saturated slab, switch to white at 55%. */
  onDark?: boolean;
  as?: "span" | "p" | "div";
}

const Eyebrow = React.forwardRef<HTMLElement, EyebrowProps>(
  ({ className, onDark = false, as = "span", children, ...props }, ref) => {
    const Comp = as as React.ElementType;
    return (
      <Comp
        ref={ref}
        className={cn(
          "text-label font-bold uppercase tracking-[0.07em] whitespace-nowrap",
          onDark ? "text-background/55" : "text-warm-label",
          className,
        )}
        {...props}
      >
        {children}
      </Comp>
    );
  },
);
Eyebrow.displayName = "Eyebrow";

export { Eyebrow };
