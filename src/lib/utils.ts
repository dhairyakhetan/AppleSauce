import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Bug fix: tailwind-merge's default config only knows Tailwind's stock
 * fontSize scale (text-xs/sm/base/...). It doesn't know this project's
 * custom fontSize keys (tailwind.config.ts `theme.extend.fontSize`), so a
 * class like `text-body-secondary` falls through to twMerge's `text-color`
 * group instead of `font-size` — which makes it "conflict" with a real
 * color class like `text-background`/`text-foreground`/`text-brand-deep`
 * on the same element, silently dropping whichever one came first in the
 * class string (observed: every Chip at size=44 lost its tone's text
 * color entirely, e.g. the desktop filter rail's solid/black-selected
 * pills rendered with invisible near-black-on-black text). Registering
 * these as `font-size` classes keeps them in their own group so they no
 * longer clobber a real text-color utility.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display-hero",
            "page-title",
            "section-head",
            "subsection",
            "card-title",
            "card-title-lg",
            "lede",
            "body",
            "body-secondary",
            "meta",
            "label",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
