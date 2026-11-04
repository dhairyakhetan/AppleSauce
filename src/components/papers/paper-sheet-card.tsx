import * as React from "react";
import { Link, useNavigate } from "react-router-dom";
import { Download, Lock, Check } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { getSubjectPalette } from "@/lib/subject-palette";
import { IconDisc } from "@/components/ui/icon-disc";
import { paperSourceName } from "@/lib/school-display";
import { isComingSoon } from "@/lib/readable-papers";

/* Redesign C3 (components.md §2).

   The grid variant of a paper: stacked sheet edges behind the card, a folded
   corner, ruled lines standing in for body text, a dashed divider above the
   action row, and Read + download discs. */
export interface PaperSheetCardPaper {
  id: string;
  title: string;
  school: string;
  subject: string;
  class: string;
  board: string;
  exam_type: string;
  year: number;
  file_url: string | null;
  /** Bank papers only -- absent/false for the `papers` table, which has no
   *  audit concept. True: still opens (BankPaper.tsx is the real gate), but
   *  this card says so up front rather than looking like any other paper. */
  needsReview?: boolean;
}

export interface PaperSheetCardProps {
  paper: PaperSheetCardPaper;
  locked?: boolean;
  className?: string;
}

function PaperSheetCard({ paper, locked = false, className }: PaperSheetCardProps) {
  const palette = getSubjectPalette(paper.subject);
  const navigate = useNavigate();
  const href = `/past-papers/${paper.id}`;
  const [leaving, setLeaving] = React.useState(false);
  const [justDownloaded, setJustDownloaded] = React.useState(false);
  const comingSoon = isComingSoon(paper);
  /* 0 is how an undated bank paper arrives (see PastPapers / PaperResults).
     It is not a year, so it is not printed. */
  const year = Number.isFinite(paper.year) && paper.year > 0 ? paper.year : null;
  const source = paperSourceName(paper.school);

  /* Reveal-on-open, matching PaperCover: a brief lift before the route
     change fires, short enough (150ms, `duration-tap`) to read as
     acknowledgment rather than a delay. Reduced-motion skips straight to
     navigate. Still navigates when comingSoon -- BankPaper.tsx is the real
     gate and shows the audit notice there, so this never has to duplicate
     that message in a second place. */
  const openPaper = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      navigate(href);
      return;
    }
    setLeaving(true);
    window.setTimeout(() => navigate(href), 150);
  };

  /* Download micro-interaction: icon swap on click. Shows checkmark briefly
     (700ms) then reverts. The download/new-tab still happens; this is purely
     visual feedback. Respects prefers-reduced-motion by skipping the animation
     but still showing the icon swap. */
  const handleDownloadClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.stopPropagation();
    setJustDownloaded(true);
    window.setTimeout(() => setJustDownloaded(false), 700);
  };

  return (
    <div className={cn("relative", className)}>
      {/* Stacked sheet edges behind the card. */}
      <span
        aria-hidden
        className="absolute inset-x-2 -bottom-2 top-2 rounded-2xl"
        style={{ backgroundColor: palette.meta, opacity: 0.12 }}
      />
      <span
        aria-hidden
        className="absolute inset-x-1 -bottom-1 top-1 rounded-2xl"
        style={{ backgroundColor: palette.meta, opacity: 0.2 }}
      />

      {/* A plain div (not <a>) so the download anchor in the footer can be a
          real nested link — two nested <a> elements are invalid HTML. The
          whole card is a click target for pointer users (openPaper), but it is
          deliberately NOT a keyboard stop or a role="link": it holds two real
          links (Read, Download), and a link around links gives screen readers
          nested interactive controls and keyboard users a duplicate tab stop.
          Its old Enter/Space handler also swallowed those keys on the nested
          Download anchor and opened the paper instead. The Read link is the
          keyboard and screen-reader path to the same place. */}
      <div
        onClick={openPaper}
        /* Handoff PR-003/S-014: radius -> 22px (unambiguous — the rest of
           PR-003's card-interior description (badge/title/footer resizing,
           a "Paper © {school}" footer replacing this card's Read/Download
           actions) isn't applied: it would remove the only way to open or
           download a paper from this card, which crosses from restyling
           into removing working functionality. Flagged, not guessed. */
        className={cn(
          "relative flex h-full cursor-pointer flex-col overflow-hidden rounded-[24px] p-4 text-left transition-transform duration-150 ease-out hover:-translate-y-0.5 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none sm:p-6",
          leaving && "-translate-y-2 scale-[0.96] -rotate-1",
        )}
        style={{ backgroundColor: palette.tint }}
      >
        {/* Folded corner. */}
        <span
          aria-hidden
          className="absolute right-0 top-0 h-6 w-6"
          style={{
            background: `linear-gradient(135deg, transparent 50%, ${palette.meta}33 50%)`,
          }}
        />

        <span className="mb-2 flex flex-wrap items-center gap-2 pr-6">
          <span
            className="inline-flex min-h-6 items-center rounded-full px-3 py-1 text-label font-bold uppercase tabular-nums"
            style={{ backgroundColor: palette.solid, color: palette.badgeText }}
          >
            {paper.board}
          </span>
          <span
            className="inline-flex min-h-6 items-center rounded-full px-3 py-1 text-label font-bold uppercase tabular-nums"
            style={{ backgroundColor: palette.tint, color: palette.text, boxShadow: `inset 0 0 0 1px ${palette.meta}` }}
          >
            Class {paper.class}
          </span>
          {year !== null && (
            <span
              className="inline-flex min-h-6 items-center rounded-full px-3 py-1 text-label font-bold uppercase tabular-nums"
              style={{ backgroundColor: palette.tint, color: palette.text, boxShadow: `inset 0 0 0 1px ${palette.meta}` }}
              aria-label={`Year ${year}`}
            >
              {year}
            </span>
          )}
          {comingSoon ? (
            <span
              className="ml-auto inline-flex min-h-6 items-center rounded-full bg-panel px-3 py-1 text-label font-bold uppercase text-white"
            >
              Coming soon
            </span>
          ) : locked ? (
            <IconDisc tone="dark" size={32} className="ml-auto" label="Sign in to read">
              <Lock size={13} strokeWidth={2.25} aria-hidden="true" />
            </IconDisc>
          ) : null}
        </span>

        <span className="block break-words text-card-title-lg font-bold" style={{ color: palette.text }}>
          {paper.title}
        </span>
        {source !== null && (
          <span className="mt-1 block break-words text-meta font-medium" style={{ color: palette.meta }}>
            {source}
          </span>
        )}

        {/* Ruled lines standing in for body text. */}
        <span className="mt-3 flex flex-col gap-1.5" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="block h-px"
              style={{ backgroundColor: palette.meta, opacity: 0.25, width: i === 2 ? "60%" : "100%" }}
            />
          ))}
        </span>

        {/* Dashed action divider. */}
        <span
          className="mt-auto flex items-center justify-between gap-3 pt-4"
          style={{ borderTop: `1.5px dashed ${palette.meta}55` }}
        >
          <Link
            to={href}
            onClick={(e) => e.stopPropagation()}
            /* 32px painted, 44px hit box. C-013 spells out this exact remedy —
               keep the painted disc/pill size, widen the target with
               `before:-inset-*` — rather than growing the pill and breaking
               the card's action row. 32 + 2×6 = 44. */
            className="relative inline-flex min-h-8 items-center rounded-full px-4 text-label font-bold uppercase before:absolute before:-inset-[6px] before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            style={{ backgroundColor: palette.solid, color: palette.badgeText }}
          >
            {comingSoon ? "Coming soon" : locked ? "Sign in to read" : "Read"}
          </Link>
          {!locked && !comingSoon && paper.file_url ? (
            <a
              href={paper.file_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleDownloadClick}
              aria-label="Download"
              /* Same C-013 treatment: 36px painted disc, 36 + 2×4 = 44 hit box.
                 Press feedback via scale transform, matching the card's
                 active:scale-[0.97]. */
              className="relative shrink-0 transition-transform duration-tap ease-tap active:scale-[0.97] rounded-full before:absolute before:-inset-[4px] before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none"
            >
              <IconDisc as="span" tone="muted" size={36} shape="circle">
                <div className="transition-opacity duration-tap ease-tap motion-reduce:transition-none">
                  {justDownloaded ? (
                    <Check size={16} strokeWidth={2} aria-hidden="true" />
                  ) : (
                    <Download size={16} strokeWidth={2} aria-hidden="true" />
                  )}
                </div>
              </IconDisc>
            </a>
          ) : null}
        </span>
      </div>
    </div>
  );
}

export { PaperSheetCard };
