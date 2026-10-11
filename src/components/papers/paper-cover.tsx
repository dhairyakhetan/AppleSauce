import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import { getSubjectPalette, paletteFromKey } from "@/lib/subject-palette";
import { IconDisc } from "@/components/ui/icon-disc";

/* Redesign C2 (components.md §2, design.md §2.6).

   A paper drawn as an OBJECT, not a row: subject `tint` fill, a 9–10px
   `solid` spine down the left with a faint inner strip beside it, radius
   `6px 16px 16px 6px`, board eyebrow, subject in display type, paper line,
   and a lock disc when the reader is signed out. The spine is the one large
   surface allowed to use `solid` — it carries no copy (tokens.md §3 scope
   rule / components.md C2 note).

   Sizes: 118×156 mobile, 136–150×206–210 desktop — set via `size`. */
export interface PaperCoverPaper {
  id: string;
  title: string;
  subject: string;
  board: string;
  /** Interpolated straight into the footer line, so a real academic year
   *  ("2022-23") is as valid here as a calendar year. */
  year: number | string;
}

export interface PaperCoverProps extends React.HTMLAttributes<HTMLDivElement> {
  paper: PaperCoverPaper;
  /** Extra facts to print on the cover — class, board, school, whatever the
   *  caller has. Three slots (eyebrow, headline, footer) could not carry
   *  everything a paper is, so these sit between the headline and the footer
   *  as small tinted lines. Empty entries are dropped. */
  meta?: (string | null | undefined)[];
  /** Colour the cover from this key instead of from the subject. For shelves
   *  where every paper shares one subject and colouring by it would make every
   *  cover identical. */
  tintKey?: string;
  /** Show the 26px lock disc — the reader is not signed in. */
  locked?: boolean;
  /** Listed, but not openable yet -- shows a "Coming soon" badge instead of
   *  the lock disc. The cover still links through; BankPaper.tsx is the
   *  real gate and shows the audit notice there. */
  comingSoon?: boolean;
  size?: "mobile" | "desktop";
  href?: string;
}

const SIZE_CLASSES = {
  mobile: "h-[156px] w-[118px]",
  desktop: "h-[206px] w-[136px] lg:h-[210px] lg:w-[150px]",
} as const;

const PaperCover = React.forwardRef<HTMLDivElement, PaperCoverProps>(
  ({ className, paper, meta, tintKey, locked = false, comingSoon = false, size = "mobile", href, ...props }, ref) => {
    const palette = tintKey ? paletteFromKey(tintKey) : getSubjectPalette(paper.subject);
    const metaLines = (meta ?? []).map((m) => (m ?? '').trim()).filter(Boolean);
    const navigate = useNavigate();
    const [leaving, setLeaving] = React.useState(false);

    /* Reveal-on-open: a brief "lift off the shelf" before the route change,
       so the shelf metaphor pays off instead of an instant route jump. Kept
       short (matches `duration-tap`, 150ms) so it reads as acknowledgment,
       not a show — a student clicking to read wants the paper, not a
       performance. `prefers-reduced-motion` skips it entirely: the click
       navigates immediately rather than playing a stripped-down version. */
    const handleActivate = (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        navigate(href!);
        return;
      }
      setLeaving(true);
      window.setTimeout(() => navigate(href!), 150);
    };

    const content = (
      <div
        ref={ref}
        className={cn(
          /* The hover/active transform used to live on this same element —
             the one carrying both `overflow-hidden` and the asymmetric
             border-radius below. A transform and an overflow/radius clip on
             one element is a known WebKit corner-rendering bug (Safari,
             iOS Safari): on press/hover the rounded clip mask can misalign
             for a frame, showing a sliver of the spine's square corner past
             the curve — the "weird clipping on the corners" from the owner's
             mobile QA pass. The transform now lives on the Link/wrapper
             instead, so this element only ever clips a static box. */
          "group relative flex shrink-0 flex-col overflow-hidden pl-4 pr-3.5 pt-3.5",
          SIZE_CLASSES[size],
          className,
        )}
        style={{ backgroundColor: palette.tint, borderRadius: "6px 16px 16px 6px" }}
        {...props}
      >
        {/* Spine: the one large surface allowed a subject `solid` fill. No copy. */}
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[9px] sm:w-[10px]"
          style={{ backgroundColor: palette.solid }}
        />
        {/* Faint inner strip beside the spine. */}
        <span
          aria-hidden
          className="absolute inset-y-0 left-[9px] w-1 sm:left-[10px]"
          style={{ backgroundColor: palette.meta, opacity: 0.18 }}
        />

        {comingSoon ? (
          <span
            aria-hidden="true"
            className="absolute right-2 top-2 z-10 inline-flex min-h-5 items-center rounded-full bg-[#1B1A18]/85 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.04em] text-white"
          >
            Soon
          </span>
        ) : locked ? (
          <IconDisc
            tone="dark"
            size={32}
            /* Literal hex, not bg-panel/85: `panel` is var(--panel-dark) and
               Tailwind emits nothing when asked for an alpha on a var(), so
               this padlock was sitting on whatever the cover art happened to
               be behind it. See the note in sheet.tsx. */
            className="absolute right-2.5 top-2.5 z-10 bg-[#1B1A18]/85"
            label="Sign in to read"
          >
            <Lock size={13} strokeWidth={2.25} aria-hidden="true" />
          </IconDisc>
        ) : null}

        <span
          className="text-label font-bold uppercase tabular-nums"
          style={{ color: palette.meta }}
        >
          {paper.board}
        </span>

        {/* mt-1.5, not mt-1: against the spine's 9-10px width plus the
            increased pl-4 (16px) left inset above, the subject headline used
            to sit almost flush against the eyebrow line — this is the same
            "text getting crammed" the owner flagged, just vertically. */}
        <span
          className="mt-1.5 line-clamp-3 break-words font-display text-card-title font-bold leading-tight"
          style={{ color: palette.text }}
        >
          {paper.subject}
        </span>

        {metaLines.length > 0 && (
          <span className="mt-2 block space-y-[3px] pr-1">
            {metaLines.map((line) => (
              <span
                key={line}
                className="block line-clamp-2 break-words text-[11px] font-semibold leading-[1.35]"
                style={{ color: palette.text, opacity: 0.85 }}
              >
                {line}
              </span>
            ))}
          </span>
        )}

        <span className="mt-auto block line-clamp-2 break-words pb-3.5 pr-1 text-meta font-medium" style={{ color: palette.meta }}>
          {[paper.title, paper.year].filter((v) => v !== null && v !== undefined && String(v).trim() !== "").join(" · ")}
        </span>
      </div>
    );

    if (href) {
      return (
        <Link
          to={href}
          onClick={handleActivate}
          className={cn(
            "inline-flex rounded-[6px_16px_16px_6px] transition-transform duration-tap ease-tap hover:-translate-y-0.5 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none",
            leaving && "-translate-y-2 scale-[0.96] -rotate-1",
          )}
          aria-label={`${paper.subject}: ${paper.title}${comingSoon ? " (coming soon)" : locked ? " (sign in to read)" : ""}`}
        >
          {content}
        </Link>
      );
    }
    return (
      <div className="inline-flex rounded-[6px_16px_16px_6px] transition-transform duration-tap ease-tap hover:-translate-y-0.5 active:scale-[0.97]">
        {content}
      </div>
    );
  },
);
PaperCover.displayName = "PaperCover";

/* C4 ShelfLedge — the surface covers stand on. `#EFE9E1` on bone maps to the
   `warm-band` token; on indigo it's white at 14%. Never a raw hex. */
export interface ShelfLedgeProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: "bone" | "indigo";
}

const ShelfLedge = React.forwardRef<HTMLDivElement, ShelfLedgeProps>(
  ({ className, tone = "bone", children, ...props }, ref) => (
    <div ref={ref} className={cn("relative", className)} {...props}>
      <div className="flex items-end gap-3 overflow-x-auto overflow-y-visible pb-4 pl-1 pr-1 pt-2 scrollbar-hide sm:gap-4">
        {children}
      </div>
      <div
        aria-hidden
        className={cn(
          "h-2 rounded-full",
          tone === "bone" ? "bg-warm-band" : "bg-[var(--on-brand-hairline)]",
        )}
      />
    </div>
  ),
);
ShelfLedge.displayName = "ShelfLedge";

export { PaperCover, ShelfLedge };
