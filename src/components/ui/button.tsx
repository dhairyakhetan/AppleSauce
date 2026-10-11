import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/* Redesign P1 (handoff components.md §1).
   The redesign adds six named variants — primary / indigo / whatsapp / muted /
   dark / ghost — and a 40/44/46/52/54px size ramp. The stock shadcn variants
   (default, destructive, outline, secondary, link) and sizes are KEPT: ~29 files
   still call them, and the handoff's rule is "design wins, keep functionality".
   New work should use the redesign variants; the shadcn ones are legacy.

   Heights come from components.md verbatim. 46/52/54 have no step on the spacing
   scale (44 = h-11, 48 = h-12), so they are arbitrary px. design.md §0.2 bans
   arbitrary *spacing* (`p-5`, `gap-7`, `[13px]` padding) — control height is a
   component dimension the spec fixes, not page rhythm. */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium ring-offset-background transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /* ---- redesign variants (components.md P1) ----

           micro-06-non-negotiables rule 2: "One motion per action. A press
           scales OR a colour changes OR a pill pops — never all three." These
           variants were doing a colour change AND a lift AND a shadow swap on a
           single hover, on the most-used control on the site. The lift is the
           handoff's signature hover and stays; the shadow swap is the one that
           goes, since it is the least legible of the three and the only one
           doing nothing the lift does not already imply. */
        primary:
          "rounded-full bg-brand text-brand-foreground shadow-border hover:bg-brand-hover hover:-translate-y-0.5 motion-reduce:hover:translate-y-0",
        indigo:
          "rounded-full bg-brand-blue text-brand-blue-foreground shadow-border hover:bg-brand-blue-hover hover:-translate-y-0.5 motion-reduce:hover:translate-y-0",
        /* Rule 4: the WhatsApp green is #25D366 on #0B3D1F and appears nowhere
           else in the product. Do not add a second green. */
        whatsapp:
          "rounded-full bg-whatsapp text-whatsapp-text shadow-border hover:-translate-y-0.5 motion-reduce:hover:translate-y-0",
        muted:
          "rounded-full bg-muted text-warm-prose hover:bg-accent hover:-translate-y-0.5 motion-reduce:hover:translate-y-0",
        dark: "rounded-full bg-panel text-background hover:-translate-y-0.5 motion-reduce:hover:translate-y-0",

        /* ---- stock shadcn variants (legacy, still in use) ---- */
        default: "rounded-md bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "rounded-md hover:bg-accent hover:text-accent-foreground",
        link: "rounded-md text-primary underline-offset-4 hover:underline",
      },
      size: {
        /* Handoff S-007: sizes are heights from a closed set — 44, 46, 48,
           52, 54, 58. The old "40" step is removed; every former 40px
           button is now 44 (the floor). */
        44: "h-11 px-6 text-body-secondary",
        46: "h-[46px] px-6 text-body-secondary",
        48: "h-12 px-6 text-body-secondary",
        52: "h-[52px] px-8 text-body",
        54: "h-[54px] px-8 text-body",
        58: "h-[58px] px-8 text-body",

        /* stock shadcn sizes (legacy) */
        default: "h-10 px-4 py-2 text-sm",
        sm: "h-9 px-3 text-sm",
        lg: "h-11 px-8 text-sm",
        icon: "h-10 w-10 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      /* Handoff S-007: the size scale is a closed set of heights and "the old
         40 step is removed; every former 40px button is now 44 (the floor)".
         The legacy shadcn sizes below are still reachable by name for the
         primitives that were never redesigned, but the DEFAULT must not be one
         of them — `default` is h-10, so every <Button> written without a size
         rendered at 40px, under C-013's floor and outside S-007's set. */
      size: 44,
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Disable the scale-on-press feedback when motion would be distracting. */
  static?: boolean;
  /**
   * Busy state (components.md P1): the label is swapped for three dots while the
   * button keeps its measured width, so the row never reflows mid-submit.
   */
  busy?: boolean;
}

// Tactile press feedback. CRAFT.md §2 fixes press at scale(0.96) sitewide.
// Disabled buttons already have pointer-events-none, so :active can't fire on them.
/* motion-reduce:active:scale-100 — button.tsx was the one component still
   animating without a reduced-motion escape. TeacherCard, Index, PastPapers
   and expandable-tabs all carry the guard already, so a reader who asked the
   OS for less motion got a still page with jumping buttons on it. */
const tapScale = "active:scale-[0.96] motion-reduce:active:scale-100";

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      static: isStatic = false,
      busy = false,
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    const innerRef = React.useRef<HTMLButtonElement | null>(null);
    const [lockedWidth, setLockedWidth] = React.useState<number>();

    /* Measure before the label is swapped, so the dots inherit the label's width
       instead of collapsing the button. Released when busy clears. */
    React.useLayoutEffect(() => {
      if (busy) {
        if (innerRef.current && lockedWidth === undefined) {
          setLockedWidth(innerRef.current.getBoundingClientRect().width);
        }
      } else if (lockedWidth !== undefined) {
        setLockedWidth(undefined);
      }
    }, [busy, lockedWidth]);

    /* asChild renders someone else's element (a Link, usually) — Slot requires a
       single child, so the busy treatment does not apply there. */
    if (asChild) {
      return (
        <Comp
          className={cn(buttonVariants({ variant, size }), !isStatic && tapScale, className)}
          ref={ref}
          disabled={disabled}
          {...props}
        >
          {children}
        </Comp>
      );
    }

    return (
      <button
        ref={(node) => {
          innerRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        className={cn(buttonVariants({ variant, size }), !isStatic && tapScale, className)}
        style={lockedWidth !== undefined ? { width: lockedWidth } : undefined}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        {...props}
      >
        {busy ? (
          <>
            <span className="sr-only">Working…</span>
            <span aria-hidden className="inline-flex items-center gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1 w-1 rounded-full bg-current opacity-70 motion-safe:animate-shimmer"
                  style={{ animationDelay: `${i * 120}ms` }}
                />
              ))}
            </span>
          </>
        ) : (
          children
        )}
      </button>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
