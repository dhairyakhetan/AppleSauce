import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { getSubjectPalette } from "@/lib/subject-palette";

/* Redesign P2 (components.md §1, design.md §2.4).

   One pill, four surfaces. A chip NEVER tilts — that is the sticker's job (P8),
   and mixing the two makes filter rows look accidental.

   Sizing: 44px wherever the chip is the primary control (design.md §7 floor);
   34px is allowed only for read-only badges that are not tap targets. */
const chipVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      tone: {
        /* Handoff S-006 — the legal tones, nothing invented per page.
           `dark` = the old `solid` (bg-panel is the same fill; renamed to
           match the spec's table). `on-dark`/`on-brand`/`on-papers` are the
           "a chip sitting on a saturated panel" family — `on-dark` replaces
           the old `dark` (bg-white/10), which meant exactly that. */
        facet: "bg-muted text-foreground hover:bg-accent",
        "facet-on": "bg-brand-subtle text-brand-deep",
        "facet-on-papers": "bg-brand-blue-subtle text-brand-blue-deep",
        dark: "bg-panel text-background",
        subject: "",
        "on-brand": "bg-card text-foreground",
        "on-papers": "bg-white/15 text-white",
        "on-dark": "bg-white/10 text-warm-muted hover:bg-white/20",
      },
      size: {
        /* Handoff S-005: three legal sizes and nothing else. 34/40 removed —
           every former 40px interactive chip is now 44, every purely
           decorative one is 38. */
        26: "h-[26px] px-[10px] text-[12px] font-bold",
        38: "h-[38px] px-3.5 text-[13px] font-semibold",
        /* The default: meets the 44px floor. */
        44: "h-11 px-[18px] text-body-secondary",
      },
    },
    defaultVariants: { tone: "facet", size: 44 },
  },
);

export interface ChipProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "color">,
    VariantProps<typeof chipVariants> {
  /** Leading icon. Decorative — it is aria-hidden and never the only label. */
  icon?: React.ReactNode;
  /** Trailing count badge, e.g. the number of results behind a facet. */
  count?: number;
  /**
   * Subject name. When set with tone="subject" the fill and text come from
   * getSubjectPalette() — the one sanctioned inline-style colour source
   * (design.md §0.1). Never hand-author a subject colour.
   */
  subject?: string;
  /** Render as a static element rather than a button (read-only badges). */
  asChild?: boolean;
}

const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(
  (
    { className, tone, size, icon, count, subject, children, asChild, style, ...props },
    ref,
  ) => {
    const palette = tone === "subject" && subject ? getSubjectPalette(subject) : undefined;

    const content = (
      <>
        {icon ? (
          <span aria-hidden className="inline-flex shrink-0 [&_svg]:size-4">
            {icon}
          </span>
        ) : null}
        <span className="truncate">{children}</span>
        {count !== undefined ? (
          <span
            className="ml-1 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-black/10 px-1 text-label tabular-nums"
            /* The count is meaningful, so it stays real text — not a ::after. */
          >
            {count}
          </span>
        ) : null}
      </>
    );

    const merged = {
      ...(palette ? { backgroundColor: palette.tint, color: palette.text } : null),
      ...style,
    };

    if (asChild) {
      return (
        <span
          className={cn(chipVariants({ tone, size }), className)}
          style={merged}
          /* Static badge: no ref, no button semantics. */
        >
          {content}
        </span>
      );
    }

    return (
      <button
        ref={ref}
        type="button"
        /* No active:scale. micro-03-buttons-fields.png specifies the filter
           chip's motion as "background and text crossfade 150ms; no scale, no
           tilt", and says why: "the count is the feedback, so the chip itself
           only changes colour". A chip that also scaled was doing two things
           where the sheet asks for one, and duplicating feedback the result
           count above it already gives. The colour transition on the base class
           is the press response. */
        className={cn(chipVariants({ tone, size }), "tap-44", className)}
        style={merged}
        {...props}
      >
        {content}
      </button>
    );
  },
);
Chip.displayName = "Chip";

export { Chip, chipVariants };
