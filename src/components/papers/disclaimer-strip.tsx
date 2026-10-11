import { Info } from "lucide-react";

import { cn } from "@/lib/utils";

/* Redesign F4 (components.md §4, design.md §6.5).

   Permanent strip under the reader header — never conditional on sign-in
   state. Revision-use only, copyright with the named school (per-paper data,
   not static copy). Copy verbatim from copy.md §6 "Reader strip".

   S5 draws this on the dark reader ground: padding 11px 16px, white/6% fill,
   1px white/10% bottom hairline, 15px info glyph in --indigo-link-on-dark,
   11.5px/1.5 body at white/66%.
   `tone="bone"` keeps the original light treatment for any light surface. */
export interface DisclaimerStripProps {
  school: string;
  tone?: "bone" | "dark";
}

function DisclaimerStrip({ school, tone = "bone" }: DisclaimerStripProps) {
  const dark = tone === "dark";

  return (
    <div
      className={cn(
        "flex items-start gap-[10px]",
        dark
          ? "border-b border-white/10 bg-white/5 px-4 py-[11px]"
          : "flex-wrap items-center gap-2 rounded-lg bg-muted px-4 py-3",
      )}
    >
      <Info
        size={15}
        strokeWidth={2.2}
        aria-hidden="true"
        className={cn("mt-px flex-none", dark ? "text-indigo-link-on-dark" : "text-muted-foreground")}
      />
      <span
        className={cn(
          "break-words",
          dark ? "text-[12px] leading-[1.5] text-white/60" : "text-body-secondary text-warm-prose",
        )}
      >
        This paper is the property of{" "}
        <span className={cn(dark && "font-semibold text-indigo-link-on-dark")}>{school}</span>. Shikshaq
        claims no ownership over it. It was contributed by a student and is shared solely to assist exam
        preparation. Reading is free, downloading and reposting are not.
      </span>
    </div>
  );
}

export { DisclaimerStrip };
