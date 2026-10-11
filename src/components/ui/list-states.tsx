import * as React from "react";

import { cn } from "@/lib/utils";
import { Blob } from "@/components/ui/blob";
import { Button } from "@/components/ui/button";

/* Redesign F1 (components.md §4, design.md §3 "State coverage").

   Every list on every screen ships all five of these. They are one component so
   that a list cannot quietly implement three of them and call it done.

   Copy is verbatim from copy.md §4 — do not rewrite it here. Where a count is
   interpolated the caller must pass a REAL number from the query that would run
   (design.md §0.10); if the count cannot be fetched, use the variant that does
   not name one rather than inventing a figure. */

/* ---------- 1. Loading ---------- */

/* F5 SkeletonCard: shimmer over bg-warm-band, shaped like the card it replaces
   — never a generic grey box (components.md §4). Callers describe the real
   geometry so the skeleton matches what lands. */
export interface SkeletonCardProps {
  /** Height of the media block, e.g. the photo box. 0 for text-only rows. */
  media?: number;
  /** Number of text lines beneath. */
  lines?: number;
  className?: string;
}

function SkeletonCard({ media = 132, lines = 2, className }: SkeletonCardProps) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-2xl bg-card p-4 shadow-border", className)}>
      {media > 0 ? (
        <div
          className="w-full rounded-2xl bg-warm-band motion-safe:animate-shimmer"
          style={{ height: media }}
        />
      ) : null}
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-3 rounded-full bg-warm-band motion-safe:animate-shimmer"
          /* Last line short, so the block reads as text rather than as bars. */
          style={{ width: i === lines - 1 ? "58%" : "100%" }}
        />
      ))}
    </div>
  );
}

export interface ListLoadingProps {
  count?: number;
  media?: number;
  lines?: number;
  className?: string;
}

function ListLoading({ count = 4, media, lines, className }: ListLoadingProps) {
  return (
    <div className={cn("grid gap-4", className)} aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} media={media} lines={lines} />
      ))}
    </div>
  );
}

/* ---------- shared panel shell ---------- */

/* States 3 and 4 share one panel shape (design.md §3). */
function StatePanel({
  tone = "muted",
  children,
  className,
}: {
  tone?: "muted" | "brand-subtle";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-4 rounded-2xl p-6",
        tone === "brand-subtle" ? "bg-brand-subtle" : "bg-muted",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ---------- 2. Empty, no data yet ---------- */

/* "Never advertise emptiness" (design.md §3.2): this state states a generic
   truth instead of "0 results". It takes a line from the caller because the
   right generic line is screen-specific (copy.md §7, §9). */
function ListEmpty({ line, className }: { line: string; className?: string }) {
  return (
    <StatePanel className={className}>
      <p className="text-body text-warm-prose">{line}</p>
    </StatePanel>
  );
}

/* ---------- 3. Empty after filters ---------- */

/* `count` because the line used to say "all five filters" whatever the real
   number was — it read as a stock sentence the moment you had one filter on,
   which is exactly when someone is deciding whether to trust the result. */
function ListOverFiltered({
  onClear,
  count,
  className,
  options,
}: {
  onClear: () => void;
  count?: number;
  className?: string;
  /**
   * "Relax one filter" choices, highest-yield first, per
   * components/EmptyResults.md — each labelled with the real count it would
   * return ("Without Psychology · 12"). Browse computes these against the
   * same records it just queried, so they are measured, not guessed.
   *
   * Optional: callers that cannot compute them still get the headline and
   * the clear-everything button, which is what this component did for
   * every caller before these were wired up.
   */
  options?: { label: string; onClick: () => void }[];
}) {
  const headline =
    count === 1
      ? "Nothing matched that filter."
      : count && count > 1
        ? `Nothing matched all ${count} filters.`
        : "Nothing matched those filters.";
  /* Browse's own fallback for "nothing would relax into results" is a single
     { label: 'Clear all filters' } entry — which is the button already
     rendered below. Dropping it here keeps that from appearing twice. */
  const relaxOptions = (options ?? []).filter(
    (o) => o.label.toLowerCase() !== "clear all filters",
  );
  return (
    <StatePanel tone="brand-subtle" className={className}>
      <Blob mood="meh" size={56} />
      {/* "Most people find someone within 5 km" was a statistic this product
          cannot compute — there is no distance/radius query behind it, which
          Browse.tsx:1650-1654 already says in as many words when it refuses
          the same claim in the h1 sub-line (design.md Section 0 rule 10:
          never a number that cannot be fetched). It also told the reader to
          "loosen the rate or widen the area" as fixed text, naming two
          facets they may never have set. Both gone; the headline already
          says what happened and the button says what to do about it. */}
      <p className="text-body text-foreground">
        <strong className="font-semibold">{headline}</strong>
      </p>
      {/* The relax options come first: dropping one filter keeps the work
          the reader already did, where "Clear filters" throws all of it
          away. That ordering is the whole point of measuring them. */}
      {relaxOptions.length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {relaxOptions.map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={opt.onClick}
              className="flex min-h-11 items-center rounded-full bg-card px-4 text-[14px] font-semibold text-foreground shadow-border transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
      <Button variant={relaxOptions.length > 0 ? 'secondary' : 'primary'} size={44} onClick={onClear}>
        Clear filters
      </Button>
    </StatePanel>
  );
}

/* ---------- 4. Error ---------- */

function ListError({ onRetry, className }: { onRetry: () => void; className?: string }) {
  return (
    /* role="alert" — a failed load must be announced, not just drawn. */
    <StatePanel className={className}>
      <div role="alert" className="flex flex-col items-start gap-4">
        <Blob mood="rough" size={56} />
        <p className="text-body text-foreground">We could not load this just now.</p>
        <Button variant="muted" size={44} onClick={onRetry}>
          Retry
        </Button>
      </div>
    </StatePanel>
  );
}

/* ---------- 5. End of list / truncated ---------- */

/* pages.md §2 section 5: "That's all 214 teachers" + a "Widen your area" TEXT
   LINK. It was a full stop instead — the sentence told you to widen the area
   and then gave you no way to do it, which is the least useful place on the
   page to be told to go and find a control. `onWiden` is optional so callers
   with no area filter applied still get the sentence without a dead link. */
function ListEnd({
  count,
  onWiden,
  className,
}: {
  count: number;
  onWiden?: () => void;
  className?: string;
}) {
  return (
    <p className={cn("py-6 text-center text-meta text-warm-meta", className)}>
      That is all {count} for this search.{" "}
      {onWiden ? (
        <button
          type="button"
          onClick={onWiden}
          className="min-h-11 font-semibold text-brand-blue underline underline-offset-2 transition-colors duration-150 hover:text-brand-blue-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Widen your area
        </button>
      ) : (
        "Widen the area to see more."
      )}
    </p>
  );
}

export {
  SkeletonCard,
  ListLoading,
  ListEmpty,
  ListOverFiltered,
  ListError,
  ListEnd,
  StatePanel,
};
