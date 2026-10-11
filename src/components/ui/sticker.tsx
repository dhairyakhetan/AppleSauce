import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/* Redesign P8 (components.md §1, design.md §2.5).

   A tilted pill that overhangs the top-right of a block.

   NAME COLLISION — read before editing: index.css already defines a `.sticker`
   class, and it is something else entirely (a white + foreground double ring
   used by the device library). This component deliberately does NOT use that
   class. Reported in the Phase 0 audit; per handoff §7 the old class is not
   renamed.

   Placement rules:
   - top -10/-11px, right 12–18px, rotate ±4–6°, 10.5–11px/800
   - ONE per card, never more than a third of a grid, never on a result row
   - NEVER on a teacher card (design.md §2.5 concentric photo rule is binding:
     nothing overlaps a teacher's face)
   - The parent must not clip: put overflow:hidden on the photo block, not the
     card, or the overhang is cut off (design.md §8)
   - Decorative tilt only — the text inside is real text, and reduced motion
     flattens the rotation (design.md §3) */
const stickerVariants = cva(
  /* No `uppercase`: the handoff sets these in sentence case ("312 tutors",
     "no commission", "Takes 3 minutes"). Forcing caps also broke the drawn
     width, which is what pushed some stickers past their container edge. */
  "pointer-events-none absolute z-10 inline-flex items-center whitespace-nowrap rounded-full px-3 text-[11px] font-extrabold tracking-[0.01em] shadow-border motion-reduce:animate-none",
  {
    variants: {
      tone: {
        dark: "bg-panel text-background",
        brand: "bg-brand text-brand-foreground",
        papers: "bg-brand-blue text-brand-blue-foreground",
        whatsapp: "bg-whatsapp text-whatsapp-text",
        bone: "bg-card text-foreground",
      },
      size: {
        26: "h-[26px]",
        30: "h-[30px]",
        36: "h-9 text-[13px]",
      },
    },
    defaultVariants: { tone: "dark", size: 26 },
  },
);

/* ±3–9° per components.md P8; design.md §2.5 asks for ±4–6°, which a fixed
   union of -6|-3|3|6 could not express. The angle is carried as a CSS custom
   property so any integer in the range works, and `motion-reduce:rotate-0`
   still flattens it — the reduced-motion rule travels with the component
   rather than living in a stylesheet someone has to remember. */
const TILT_MIN = -9;
const TILT_MAX = 9;

export interface StickerProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof stickerVariants> {
  /**
   * Tilt in degrees, -9..9. Alternate the sign across a row so it reads as
   * hand-placed rather than stepped. Values outside the range are clamped.
   */
  tilt?: number;
}

const Sticker = React.forwardRef<HTMLSpanElement, StickerProps>(
  ({ className, tone, size, tilt = -3, children, style, ...props }, ref) => {
    const clamped = Math.max(TILT_MIN, Math.min(TILT_MAX, tilt));
    return (
      <span
        ref={ref}
        className={cn(
          stickerVariants({ tone, size }),
          "-top-[11px] right-4",
          "rotate-[var(--sticker-tilt)] motion-reduce:rotate-0",
          className,
        )}
        style={{ "--sticker-tilt": `${clamped}deg`, ...style } as React.CSSProperties}
        {...props}
      >
        {children}
      </span>
    );
  },
);
Sticker.displayName = "Sticker";

export { Sticker, stickerVariants };
