import * as React from "react";

import { cn } from "@/lib/utils";

/* Redesign P10 — the blob family (mockup F6a, "Redesign Feedback modal.dc.html").

   An ARCH: flat bottom, domed top. Not a circle, not a squircle. Two dots and
   one mouth, and that is the whole vocabulary — no emoji, no gradients, no eyes
   that follow.

   Each mood owns a FIXED colour from F6a. They are deliberately not
   subject-tinted: the mood is the meaning, and re-colouring it per subject would
   make "rough" read as a subject rather than as an error.

   Where each one is used (F6a, verbatim):
     rough  error states, a failed send, a paper that will not load
     meh    zero results after filters — the "nothing matched" empty state
     fine   neutral empty states: no saved teachers yet, no papers read yet
     good   confirmation and progress — weekly goal met, profile approved
     great  the moment after messaging a teacher, and feedback sent

   `great` is drawn as a CIRCLE in F6a rather than an arch — it is the one
   celebratory face and the shape change is the point. */

export type BlobMood = "rough" | "meh" | "fine" | "good" | "great";

/* Fills are literal in the mockup and have no token equivalent (they are not
   brand, subject or facet colours). They live here as named constants rather
   than being scattered as inline hex through the screens — this file is the one
   place the blob palette is defined. */
const BODY: Record<BlobMood, string> = {
  rough: "#D14545",
  meh: "#EFA063",
  fine: "#9B4FC4",
  good: "#3FAFA8",
  great: "#FF8000",
};

/* Mouth paths in a 100x100 box. Only the curve changes between moods; keeping
   one body and one pair of dots is what makes them read as a family. */
const MOUTH: Record<BlobMood, string> = {
  rough: "M36 68 L64 68",
  meh: "M36 68 L64 68",
  fine: "M37 63 Q50 76 63 63",
  good: "M34 61 Q50 79 66 61",
  great: "M34 60 Q50 80 66 60",
};

/* rough and meh share a flat mouth in F6a; rough is distinguished by its red
   body and slightly narrower arch, not by the mouth. */
const LABELS: Record<BlobMood, string> = {
  rough: "Rough",
  meh: "Meh",
  fine: "Fine",
  good: "Good",
  great: "Great",
};

export interface BlobProps extends React.HTMLAttributes<HTMLSpanElement> {
  mood: BlobMood;
  /** Pixel size of the square. */
  size?: number;
  /**
   * Accessible name. Blobs are usually decorative because the copy beside them
   * says the same thing; pass this only when the blob is the sole carrier.
   */
  label?: string;
}

const Blob = React.forwardRef<HTMLSpanElement, BlobProps>(
  ({ className, mood, size = 64, label, ...props }, ref) => {
    const fill = BODY[mood];
    const isCircle = mood === "great";

    return (
      <span
        ref={ref}
        className={cn("inline-flex shrink-0", className)}
        {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
        {...props}
      >
        <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
          {isCircle ? (
            <circle cx="50" cy="50" r="42" fill={fill} />
          ) : (
            /* Arch: square-ish base, fully domed top. */
            <path d="M8 92 L8 46 A42 42 0 0 1 92 46 L92 92 Z" fill={fill} />
          )}
          <circle cx="37" cy="45" r="5.5" fill="#1F1F1F" />
          <circle cx="63" cy="45" r="5.5" fill="#1F1F1F" />
          <path
            d={MOUTH[mood]}
            stroke="#1F1F1F"
            strokeWidth="7"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      </span>
    );
  },
);
Blob.displayName = "Blob";

export { Blob, LABELS as BLOB_LABELS, BODY as BLOB_COLORS };
