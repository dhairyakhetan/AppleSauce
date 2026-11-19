import * as React from "react";

import { cn } from "@/lib/utils";

/* Redesign P7 (components.md §1, design.md §0.11, §2.1).

   "Missing images are never blank." Every absent photo and every document
   thumbnail gets the diagonal-stripe ground plus the subject's or person's
   initial at very low alpha, sized to the block:
     rail 46px · lead 82px · profile 110px  (design.md §2.1)

   The gradient itself lives in index.css as `.stripe-placeholder` so the value
   stays in one place (tokens.md §7.4). Do not inline the gradient here. */
export interface StripePlaceholderProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Name or title the initial is taken from. */
  name?: string;
  /** Initial size in px — 46 rail, 82 lead, 110 profile. */
  initialSize?: number;
}

function initialOf(name?: string) {
  if (!name) return "?";
  const ch = name.trim().charAt(0);
  return ch ? ch.toUpperCase() : "?";
}

const StripePlaceholder = React.forwardRef<HTMLDivElement, StripePlaceholderProps>(
  ({ className, name, initialSize = 46, style, ...props }, ref) => (
    <div
      ref={ref}
      /* Decorative: the real name is always rendered as text elsewhere on the
         card, so the initial here must not be announced twice. */
      aria-hidden
      className={cn(
        "stripe-placeholder flex h-full w-full items-center justify-center overflow-hidden",
        className,
      )}
      style={style}
      {...props}
    >
      <span
        className="font-display font-black leading-none text-foreground/[0.18] select-none"
        style={{ fontSize: initialSize }}
      >
        {initialOf(name)}
      </span>
    </div>
  ),
);
StripePlaceholder.displayName = "StripePlaceholder";

export { StripePlaceholder };
