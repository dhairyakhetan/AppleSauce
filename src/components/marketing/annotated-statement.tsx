import * as React from "react";

import { cn } from "@/lib/utils";

/* Handoff AB-002/CT-002 (About Contact Help 404 Redesign.dc.html).

   A quiet display statement — regular weight, one word picked out with a
   HighlightSpan — with exactly two tilted annotation pills anchored to its
   corners. Used on About and Contact so the two pages read as a pair.
   Replaces the previous "giant black statement on a faint grid ground with
   3-4 pills" treatment entirely (that ground and weight belonged to the old
   hero; this component now lives inside a plain bone BentoPanel).

   IMPORTANT: the pills are NOT hand-placed at fixed pixel offsets computed for
   one specific string. They are laid out on a 2-column x 3-row grid overlay
   that spans the whole statement block; each pill is assigned a corner/edge
   cell (top-left, top-right, mid-left, mid-right, bottom-left, bottom-right)
   and positioned within that cell via `place-self`. That means the anchoring
   is relative to the block's own box, not to where a particular character of
   a particular string happens to fall — so it keeps clear of the statement
   text whether the copy is two words or six, and whether it wraps to two
   lines or four. Callers should still pick anchors that make sense for their
   copy (see About/Contact usage), but the component itself never assumes a
   fixed string length. */

export type AnnotatedPillAnchor =
  | "top-left"
  | "top-right"
  | "mid-left"
  | "mid-right"
  | "bottom-left"
  | "bottom-right";

export type AnnotatedPillTone = "dark" | "bone" | "whatsapp" | "indigo" | "brand";

const PILL_TONE_CLASS: Record<AnnotatedPillTone, string> = {
  dark: "bg-panel text-background shadow-border",
  bone: "bg-card text-foreground shadow-border",
  whatsapp: "bg-whatsapp text-whatsapp-text shadow-border",
  indigo: "bg-brand-blue-subtle text-brand-blue-deep shadow-border",
  brand: "bg-brand text-brand-foreground shadow-border",
};

const PILL_DOT_CLASS: Record<AnnotatedPillTone, string> = {
  dark: "bg-brand",
  bone: "bg-whatsapp",
  whatsapp: "",
  indigo: "bg-brand-blue",
  brand: "bg-background",
};

const ANCHOR_CELL: Record<AnnotatedPillAnchor, string> = {
  "top-left": "col-start-1 row-start-1 justify-self-start self-start",
  "top-right": "col-start-2 row-start-1 justify-self-end self-start",
  "mid-left": "col-start-1 row-start-2 justify-self-start self-center",
  "mid-right": "col-start-2 row-start-2 justify-self-end self-center",
  "bottom-left": "col-start-1 row-start-3 justify-self-start self-end",
  "bottom-right": "col-start-2 row-start-3 justify-self-end self-end",
};

export type AnnotatedHighlightTone = "pill-brand" | "block-dark" | "block-brand";

const HIGHLIGHT_BG_CLASS: Record<AnnotatedHighlightTone, string> = {
  "pill-brand": "-inset-x-2 rounded-full bg-brand-subtle",
  "block-dark": "-inset-x-1.5 rounded-[10px] bg-panel",
  "block-brand": "-inset-x-2 rounded-lg bg-brand",
};

const HIGHLIGHT_TEXT_CLASS: Record<AnnotatedHighlightTone, string> = {
  "pill-brand": "",
  "block-dark": "text-background",
  "block-brand": "text-brand-foreground",
};

/** The one bold word/phrase inside an otherwise regular-weight statement — a
 *  pill highlight (About's "line"), a dark block (Contact's "We reply."), or
 *  a tilted solid-brand block (Join's "Keep every rupee.").
 *  `weight` defaults to 900 (About/Contact); Join's spec calls for 800.
 *  `tilt` rotates just the background layer, not the text.
 *
 *  Handoff D-007: the tilt is set via the `--annotated-tilt` custom property
 *  (inline style, since `tilt` is an arbitrary caller-supplied number, not
 *  one of a fixed set Tailwind can see at build time) and applied by the
 *  `.annotated-highlight-tilt` utility in index.css, which zeroes the
 *  rotation at `lg` — a class-based override can beat this because the
 *  rotation itself is no longer set via the `style` attribute, which no
 *  stylesheet class could otherwise outrank. */
function AnnotatedHighlight({
  tone,
  weight = 900,
  tilt,
  children,
}: {
  tone: AnnotatedHighlightTone;
  weight?: 800 | 900;
  tilt?: number;
  children: React.ReactNode;
}) {
  return (
    <span className={cn("relative inline-block", weight === 800 ? "font-extrabold" : "font-black")}>
      <span
        aria-hidden
        className={cn("absolute top-[2px] bottom-[2px]", HIGHLIGHT_BG_CLASS[tone], tilt ? "annotated-highlight-tilt" : undefined)}
        style={tilt ? ({ "--annotated-tilt": `${tilt}deg` } as React.CSSProperties) : undefined}
      />
      <span className={cn("relative", HIGHLIGHT_TEXT_CLASS[tone])}>{children}</span>
    </span>
  );
}

const TILT_CLASS: Record<number, string> = {
  [-9]: "-rotate-[9deg]",
  [-8]: "-rotate-[8deg]",
  [-6]: "-rotate-6",
  [-5]: "-rotate-[5deg]",
  [-4]: "-rotate-4",
  [-3]: "-rotate-3",
  3: "rotate-3",
  4: "rotate-4",
  5: "rotate-[5deg]",
  6: "rotate-6",
  7: "rotate-[7deg]",
  8: "rotate-[8deg]",
  9: "rotate-[9deg]",
};

export interface AnnotatedPill {
  label: React.ReactNode;
  anchor: AnnotatedPillAnchor;
  tone?: AnnotatedPillTone;
  tilt?: number;
  icon?: React.ReactNode;
  /** Show the small leading colour dot (mockup's status dot). Default true. */
  dot?: boolean;
}

export interface AnnotatedStatementProps extends React.HTMLAttributes<HTMLDivElement> {
  /** The statement itself, composed with an <AnnotatedHighlight> span for the one weight-900 word/phrase. */
  statement: React.ReactNode;
  pills: AnnotatedPill[];
  align?: "left" | "center";
  /**
   * Heading level for the statement. This IS the page title on About and
   * Contact, so it defaults to h1 — rendering it as a plain div left both
   * routes with no h1 at all (design.md §7 requires exactly one, and it is the
   * primary on-page SEO signal). Pass "div" only where a real h1 exists above.
   */
  as?: "h1" | "h2" | "div";
  /**
   * Handoff AB-002/CT-002: About and Contact use different sizes/line-heights
   * for the same regular-weight statement (38px/1.04 vs 36px/1.05) — passed
   * here rather than hardcoded so the one shared component can serve both.
   */
  statementClassName?: string;
}

const AnnotatedStatement = React.forwardRef<HTMLDivElement, AnnotatedStatementProps>(
  ({ className, statement, pills, align = "left", as = "h1", statementClassName, ...props }, ref) => {
    const Statement = as as React.ElementType;
    // The pill overlay below is a 3-row grid spanning this wrapper's full box
    // (see ANCHOR_CELL) — a top/bottom-anchored pill needs real empty space
    // in that row, or it lands on top of the statement's own first/last
    // line. Padding on the wrapper (not the Statement text) creates that
    // clearance without moving the overlay, which anchors to the padding
    // edge regardless of how much padding exists.
    const hasTopPill = pills.some((p) => p.anchor.startsWith("top"));
    const hasBottomPill = pills.some((p) => p.anchor.startsWith("bottom"));
    return (
      <div
        ref={ref}
        className={cn("relative isolate overflow-visible", hasTopPill && "pt-7", hasBottomPill && "pb-12", className)}
        {...props}
      >
        <Statement
          className={cn(
            "font-display font-normal text-foreground text-balance",
            statementClassName,
            align === "center" ? "text-center" : "text-left",
          )}
        >
          {statement}
        </Statement>

        {/* Pill overlay — a 2x3 grid spanning the statement's own box, per-anchor
            placement rather than fixed px tied to string length (see file header). */}
        <div
          aria-hidden={pills.every((p) => typeof p.label === "string")}
          className="pointer-events-none absolute inset-0 grid grid-cols-2 grid-rows-3"
        >
          {pills.map((pill, i) => {
            const tone = pill.tone ?? "dark";
            const tilt = pill.tilt ?? (i % 2 === 0 ? -4 : 4);
            return (
              <span
                key={i}
                className={cn(
                  "pointer-events-auto inline-flex h-[34px] items-center gap-[6px] whitespace-nowrap rounded-full px-[14px] text-[13px] font-extrabold motion-reduce:rotate-0 lg:rotate-0",
                  PILL_TONE_CLASS[tone],
                  ANCHOR_CELL[pill.anchor],
                  TILT_CLASS[tilt] ?? "",
                )}
              >
                {pill.dot !== false && !pill.icon ? (
                  <span className={cn("h-[6px] w-[6px] shrink-0 rounded-full", PILL_DOT_CLASS[tone])} />
                ) : null}
                {pill.icon}
                {pill.label}
              </span>
            );
          })}
        </div>
      </div>
    );
  },
);
AnnotatedStatement.displayName = "AnnotatedStatement";

export { AnnotatedStatement, AnnotatedHighlight };
