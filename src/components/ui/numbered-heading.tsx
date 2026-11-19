import * as React from "react";

import { cn } from "@/lib/utils";

/* Redesign P6 (components.md §1, design.md §2.7).

   Anatomy, in order:
     line 1 (display)
     [ordinal 01–04]  line 2 (display)
     one support sentence (secondary body)

   The ordinals ARE the page's reading order — if sections move, renumber them.
   They are decorative as far as assistive tech is concerned (the heading text
   carries the meaning), so the ordinal is aria-hidden.

   Sizing: 27px mobile / 46px desktop. `text-section-head` now clamps exactly
   between those two, so the `lg:text-page-title` that used to supply the
   desktop end is gone — with the corrected token it would have capped the
   heading at 40px and made it SMALLER at large widths. */
export interface NumberedHeadingProps extends React.HTMLAttributes<HTMLElement> {
  /** First display line. */
  line1: string;
  /** Ordinal between the lines, e.g. "01". */
  ordinal: string;
  /** Second display line. */
  line2: string;
  /** One supporting sentence beneath. */
  support?: string;
  /** Heading level — never skip levels (design.md §7). `h1` is for a page
   *  whose only h1 this is (handoff SB-002/SC-002: SubjectsPage/SchoolsPage). */
  as?: "h1" | "h2" | "h3";
  onDark?: boolean;
  /**
   * Handoff H-012: inside a BentoPanel, the fluid `text-section-head` clamp
   * reads oversized next to the panel's own 22px padding — 'compact' is the
   * flat 23px/800/-0.04em/leading-1.1 two-line treatment the home stack's
   * numbered sections use instead. Defaults to the original fluid size so
   * pages outside this session's scope (Contact, SubjectsPage, SchoolsPage)
   * are unaffected.
   */
  size?: "default" | "compact";
}

const NumberedHeading = React.forwardRef<HTMLElement, NumberedHeadingProps>(
  (
    { className, line1, ordinal, line2, support, as = "h2", onDark = false, size = "default", ...props },
    ref,
  ) => {
    const Heading = as as React.ElementType;
    return (
      <div className={cn("flex flex-col gap-3", className)} {...props}>
        {/* The ordinal is DECORATIVE and must sit OUTSIDE the heading element.
            It was previously an aria-hidden span inside it, which kept the
            accessible name clean but still polluted textContent — so the h2
            extracted as "Start with the teachers01parents pick", which is what
            a search snippet or any text scrape would read. Absolute positioning
            keeps the drawn layout identical. */}
        <div className="relative">
          <span
            aria-hidden
            className={cn(
              /* Anchored to the BOTTOM of the two-line block, not `top-[1.35em]`.
                 `em` here resolves against the ordinal's own 11.5px font-size,
                 not the heading's, so the old offset was ~15px and dropped the
                 ordinal 9px into line 1 — it drew on top of the first line's
                 letters instead of sitting beside line 2. Line 2 is always the
                 last line, so measuring from the bottom centres it there at any
                 heading size. `pl-8` on line 2 keeps the gutter clear for it. */
              "absolute bottom-[0.47em] left-0 text-label font-bold tracking-[0.07em]",
              onDark ? "text-background/55" : "text-warm-label",
            )}
          >
            {ordinal}
          </span>
          <Heading
            ref={ref}
            className={cn(
              "font-display font-extrabold",
              size === "compact" ? "text-[23px] leading-[1.1] tracking-[-0.04em]" : "text-section-head",
              onDark ? "text-background" : "text-foreground",
            )}
          >
            {/* The literal space between the two lines matters: `block` affects
                layout but contributes no whitespace to textContent, so without
                it the heading extracts as "Start with the teachersparents pick"
                for a search snippet or a screen reader. */}
            <span className="block">{line1}</span>{" "}
            <span className="block pl-8">{line2}</span>
          </Heading>
        </div>
        {support ? (
          <p
            className={cn(
              /* 13.5px/1.55 in the muted tone, per the handoff. This was
                 text-body-secondary (15px) in text-warm-prose (#4A443E),
                 which read as a second heading rather than a support line. */
              "max-w-prose text-meta leading-[1.55]",
              onDark ? "text-background/70" : "text-muted-foreground",
            )}
          >
            {support}
          </p>
        ) : null}
      </div>
    );
  },
);
NumberedHeading.displayName = "NumberedHeading";

export { NumberedHeading };
