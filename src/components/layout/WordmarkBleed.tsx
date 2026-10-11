import * as React from "react";

import { cn } from "@/lib/utils";
import { Sticker } from "@/components/ui/sticker";

/* Redesign C12 (components.md §2).

   The oversized `shikshaq` wordmark that the footer's bottom edge clips, with
   one to three stickers sitting on it.

   Two constraints that are easy to get wrong:
   1. It must sit ABOVE the reserved bottom-nav strip on mobile — the nav pill
      floats at inset-x-3 bottom-3, so the wordmark cannot run to the very
      bottom or the pill lands on top of it.
   2. The clip belongs to this block, not to the footer, so the stickers can
      overhang the wordmark without the footer's own overflow cutting them off.

   Archivo at 125% width is the widest axis setting the variable font carries
   (index.html loads wdth 62..125), so this is the token max, not a magic
   number. */
export interface WordmarkBleedProps {
  /**
   * Sticker labels. Real counts only — a count that could not be fetched is
   * dropped by the caller, never rendered as a placeholder (design.md §0.10).
   */
  stickers?: string[];
  className?: string;
}

function WordmarkBleed({ stickers = [], className }: WordmarkBleedProps) {
  /* Alternate the tilt so the row reads as hand-placed rather than stepped. */
  /* Handoff tilts: -8 / 6 / -5. Sticker's tilt prop carries the angle as a CSS
     custom property precisely so any integer in the ±3–9 range works. */
  const tilts = [-8, 6, -5];
  const STICKER_TONES = ["brand", "whatsapp", "papers"] as const;

  /* The floating nav pill sits at `inset-x-3 bottom-3` and is 60px tall, so it
     occupies the bottom ~72px of the viewport plus the safe-area inset. The
     page's BottomNavSpacer reserves room INSIDE <main>, which is above the
     footer — nothing reserves space below it. Measured at 390px the wordmark
     ran 8px under the pill, so the clearance is reserved here instead.
     lg:pb-0 because the pill is lg:hidden. */
  return (
    <div className={cn("pb-[calc(84px+env(safe-area-inset-bottom))] lg:pb-0", className)}>
      {/* The stickers are positioned against the wordmark, not against the
          wordmark PLUS the nav reserve. Anchored to the outer box, `top-1/2`
          measured half of (glyph + 84px), which dropped them into the
          reserved strip the floating nav pill occupies — so all three sat
          behind it. */}
      <div className="relative">
        {/* The wordmark itself is decorative — the site name is already a real
            heading and link elsewhere in the footer, so this must not be read
            out a second time. */}
        {/* container-type: inline-size so the wordmark is sized as a fraction
            of THIS box rather than of the viewport. At 22vw the word measured
            454px inside a 375px container on a 390px phone — 78px of the "q"
            sheared off by overflow-hidden, so the footer signed off mid-word.
            "shikshaq" at these axis settings is 5.28em wide, so 18.6cqw lands
            it just inside the box at every width; the 14rem cap is unchanged,
            so desktop still resolves to the cap. */}
        <div aria-hidden className="overflow-hidden [container-type:inline-size]">
          <span
            /* Solid bone (#F9F5F1), not 10% alpha. The handoff draws this
               wordmark as the footer's largest element; at text-background/10 it
               was all but invisible against the near-black slab, which is why the
               whole footer read as unfinished. Tracking and line-height are the
               handoff's too — -0.06em and 1, not the 0.78 that was crushing it. */
            /* The class carries a vw fallback; the inline cqw below overrides it
               wherever container queries exist. If they do not, the browser
               drops the invalid inline font-size and this applies instead —
               without it the wordmark would collapse to an inherited 16px.
               18.6cqw of a container that is ~96% of the viewport is ~17.9vw,
               so the two agree closely. */
            className="block select-none whitespace-nowrap font-display font-black leading-[1] tracking-[-0.06em] text-background text-[clamp(3.5rem,17.5vw,14rem)]"
            style={{
              fontStretch: "125%",
              fontSize: "min(18.6cqw, 14rem)",
              /* Clipped by the container's bottom edge: the descender sits below
                 the box on purpose. Kept shallow (not the full glyph depth) so
                 the page's true end doesn't read as an abrupt cut-off. */
              marginBottom: "-0.08em",
            }}
          >
            shikshaq
          </span>
        </div>

        {stickers.length > 0 ? (
          <div className="pointer-events-none absolute inset-x-0 top-1/2 flex flex-wrap items-center justify-center gap-4">
            {stickers.slice(0, 3).map((label, i) => (
              /* Sticker's own classes (`absolute -top-[11px] right-4`) are
                 meant for overhanging a card corner. Here there's no card to
                 overhang — the stickers are meant to flow in this flex row —
                 so `absolute` positions every one of them at the same spot
                 relative to its own zero-size wrapper span, collapsing all
                 three on top of each other regardless of gap-4 on the parent.
                 Overriding to `static` (via cn/tailwind-merge, so it actually
                 replaces "absolute" rather than just adding a class) makes
                 each Sticker a normal flex child again, so gap-4 spaces them
                 for real. top/right no longer apply once position is static,
                 but reset them too so nothing lingers as dead weight. */
              <Sticker
                key={label}
                tone={STICKER_TONES[i]}
                tilt={tilts[i]}
                size={26}
                className="static top-auto right-auto"
              >
                {label}
              </Sticker>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export { WordmarkBleed };
