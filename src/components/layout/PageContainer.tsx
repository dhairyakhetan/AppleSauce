import * as React from "react";

import { cn } from "@/lib/utils";
import { useIsChromelessRoute } from "@/lib/chromeless-routes";

/* Redesign S3 + S4 (components.md §3, design.md §1).

   PageContainer is the one horizontal measure for the whole product. Every
   route body goes through it so gutters cannot drift screen to screen:
     mobile 12px · sm 24px · lg 32px, capped at max-w-6xl.
   Was 16px on mobile — owner review: on a real phone width that read as
   wasted margin rather than breathing room, more than the sm/lg gutters
   ever did. */
export interface PageContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  as?: "div" | "main" | "section" | "footer";
}

const PageContainer = React.forwardRef<HTMLDivElement, PageContainerProps>(
  ({ className, as = "div", ...props }, ref) => {
    const Comp = as as React.ElementType;
    return (
      <Comp
        ref={ref}
        className={cn("mx-auto w-full max-w-6xl px-3 sm:px-6 lg:px-8", className)}
        {...props}
      />
    );
  },
);
PageContainer.displayName = "PageContainer";

/* S4 Slab — a rounded saturated block, inset by the gutter.

   FOUR FILLS ONLY (components.md S4): brand orange, brand indigo, muted warm,
   near-black. Never a subject `solid` — that colour is reserved for icon tiles,
   badges and paper spines (tokens.md §3 scope rule).

   The coloured glow is allowed only on the two saturated fills. */
const SLAB_FILLS = {
  brand: "bg-brand text-brand-foreground shadow-glow-brand",
  papers: "bg-brand-blue text-brand-blue-foreground shadow-glow-brand-blue",
  muted: "bg-muted text-foreground",
  dark: "bg-panel text-background",
} as const;

export interface SlabProps extends React.HTMLAttributes<HTMLDivElement> {
  fill?: keyof typeof SLAB_FILLS;
  /** Drop the glow where the slab sits against another saturated surface. */
  flat?: boolean;
}

const Slab = React.forwardRef<HTMLDivElement, SlabProps>(
  ({ className, fill = "muted", flat = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-4xl",
        SLAB_FILLS[fill],
        flat && "shadow-none",
        className,
      )}
      {...props}
    />
  ),
);
Slab.displayName = "Slab";

/* The control block from design.md §1 — the near-black (or mode-coloured) top
   of every route, square at the top and 32px-rounded at the bottom.

   Mode: teachers routes are near-black, papers routes indigo, the teacher
   dashboard orange. */
const CONTROL_FILLS = {
  dark: "bg-panel text-background",
  papers: "bg-brand-blue text-brand-blue-foreground",
  teacher: "bg-brand text-brand-foreground",
} as const;

export interface ControlBlockProps extends React.HTMLAttributes<HTMLElement> {
  mode?: keyof typeof CONTROL_FILLS;
  /**
   * Override the inner PageContainer's padding. Defaults to the original
   * uniform `py-8` every other consumer (Index's hero, Auth, Account, the
   * dashboards, …) still gets unchanged.
   *
   * Browse passes a bottom-only override here (interface-details /
   * make-interfaces-feel-better: concentric corners, innerRadius =
   * outerRadius - padding). The block's bottom corners round at 32px
   * (rounded-b-4xl); with the default `py-8` the search field nested inside
   * — itself a spec'd `rounded-2xl` (16px) — sat 32px above that curve while
   * only 16px in from the sides, an asymmetric gap that made its 16px corner
   * read as arbitrarily smaller than the 32px one wrapping it rather than as
   * the same curve continuing inward. Matching the bottom gap to
   * PageContainer's own responsive side gutter (16/24/32px) reproduces
   * `32 - 16 = 16` exactly at the mobile width this was flagged on, so the
   * search field's rounded-2xl corner nests cleanly into the block's.
   */
  contentClassName?: string;
}

const ControlBlock = React.forwardRef<HTMLElement, ControlBlockProps>(
  ({ className, mode = "dark", contentClassName, children, ...props }, ref) => (
    /* A <div>, not a <header>. TopBar and Navbar are already top-level
       <header> elements, and this block sits outside <main> too — so making it
       a third one gave the page three `banner` landmarks, where ARIA allows
       exactly one. The h1 it contains still carries the document structure. */
    <div
      ref={ref as React.Ref<HTMLDivElement>}
      className={cn("rounded-b-4xl", CONTROL_FILLS[mode], className)}
      {...props}
    >
      <PageContainer className={contentClassName ?? "py-8"}>{children}</PageContainer>
    </div>
  ),
);
ControlBlock.displayName = "ControlBlock";

/* Reserves the space the floating bottom-nav pill occupies, so the last real
   element on a page is never sitting under it. design.md §1 / components.md S1
   call for 130px on mobile; the nav is lg:hidden, so the reserve is too. */
function BottomNavSpacer() {
  /* 84px, not 130. The bottom nav measures 60px tall and floats 12px off the
     bottom edge, so the real clearance needed is 72px plus the safe-area
     inset. 130px was a guess, and every page that rendered this ALSO carried
     `pb-20` on <main>, reserving 210px in total for a 72px nav — which is the
     bulk of the dead space that appeared above the footer. */
  return (
    <div aria-hidden className="lg:hidden h-[calc(84px+env(safe-area-inset-bottom))]" />
  );
}

/* Reserves the space the floating top-nav pill occupies, now that both
   TopBar (desktop) and Navbar (mobile) are `fixed` rather than `sticky` —
   taking them out of flow means the page's first real element would render
   underneath the pill without this. Mirrors BottomNavSpacer's approach.

   Two breakpoint-specific divs, not one responsive height, because the two
   bars are different heights: Navbar's mobile pill is h-14 (56px), TopBar's
   desktop pill is h-[60px] (Handoff D-004, was 72px). Both sit top-3 (12px)
   off the viewport edge; the spacer adds a further 12px gap before page
   content starts. */
function TopNavSpacer() {
  return (
    <>
      <div aria-hidden className="lg:hidden h-[calc(56px+12px+12px)]" />
      <div aria-hidden className="hidden lg:block h-[calc(60px+12px+12px)]" />
    </>
  );
}

/* Owner correction: stacked panels touch with zero gap between them, but
   each keeps its own full rounding — the bento-grid vibe is rounded cards
   packed edge to edge, with the shared background showing through as a
   small notch at each corner where two rounded corners meet, not a column
   of square-cornered blocks fused into one shape. bg-background stays on
   the wrapper itself (still the one owner of that fill, panels don't each
   need it). */
export function BentoStack({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col gap-0 bg-background', className)}
      {...props}
    />
  );
}

/* Handoff T-005 — every section on every redesigned screen is one of these.
   Separation between panels comes from fill alone (no ring, no shadow); see
   00-shared-components.md's binding rule. */
const PANEL_FILLS = {
  card: 'bg-card',
  muted: 'bg-muted',
  brandTint: 'bg-brand-subtle',
  papersTint: 'bg-brand-blue-subtle',
  mint: 'bg-mint',
  brand: 'bg-brand',
  papers: 'bg-brand-blue',
  dark: 'bg-panel text-background',
} as const;

export interface BentoPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  fill?: keyof typeof PANEL_FILLS;
  /** 'top' = first panel, reserves clearance so its content starts below the
      floating nav pill instead of underneath it. Purely a spacing concern —
      every panel keeps full rounding on all four corners regardless of
      `edge`. */
  edge?: 'top' | 'bottom';
}

/* The floating nav pill sits at `top-3` and is 56px tall on mobile, 60px at
   lg — so it occupies 12..68 / 12..72. `edge="top"` means "first panel, meets
   the nav", and it can only *meet* the nav if the panel's fill starts at y=0
   and runs underneath it.

   That used to be prevented by AppShell rendering a TopNavSpacer above the
   content, which pushed the first panel down to y=80 and left a band of bare
   page ground framing the pill. On a bone page it merely looked like dead
   space; on Past papers, whose pill is styled to sit ON the indigo hero, it
   left a translucent-white pill floating on bone with an inverted white logo
   — invisible.

   The reserve now lives inside the panel instead, so the fill reaches the top
   of the viewport and the pill overlays it. Chromeless routes render no nav,
   so they get no reserve. */
function NavReserve() {
  return (
    <>
      <div aria-hidden className="lg:hidden h-[68px]" />
      <div aria-hidden className="hidden lg:block h-[72px]" />
    </>
  );
}

export const BentoPanel = React.forwardRef<HTMLDivElement, BentoPanelProps>(
  ({ fill = 'card', edge, className, children, ...props }, ref) => {
    const chromeless = useIsChromelessRoute();
    return (
      <div
        ref={ref}
        data-bento-panel=""
        className={cn(
          'rounded-bento px-5 py-5 lg:px-8 lg:py-8',
          PANEL_FILLS[fill],
          className,
        )}
        {...props}
      >
        {edge === 'top' && !chromeless ? <NavReserve /> : null}
        {children}
      </div>
    );
  },
);
BentoPanel.displayName = 'BentoPanel';

export { PageContainer, Slab, ControlBlock, BottomNavSpacer, TopNavSpacer, SLAB_FILLS };
