import * as SheetPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";
import { ACTION_FOOTER, SCRIM, SHEET_MOTION, SHEET_SURFACE } from "@/lib/overlay-styles";

const Sheet = SheetPrimitive.Root;

const SheetTrigger = SheetPrimitive.Trigger;

const SheetClose = SheetPrimitive.Close;

const SheetPortal = SheetPrimitive.Portal;

const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    /* Handoff O-001/rule 2: the one overlay spec for every sheet and dialog
       in the product -- a 45% near-black scrim, no blur by default. A blur
       costs a repaint on every scroll frame behind it and hides the context
       the sheet is about, so a surface that wants one opts in through
       `overlayClassName` rather than changing this for everything.
       The literal #1B1A18 (SCRIM, src/lib/overlay-styles.ts), NOT bg-panel/45:
       `panel` is var(--panel-dark), a raw hex Tailwind cannot compute an alpha
       from, so that class silently emitted nothing and every sheet and dialog
       opened over an undimmed page (measured, 2026). A literal hex takes the
       modifier fine. Tactile pass, stage 3: it fades in 200ms with the shared
       strong ease-out (it was 500ms), in step with the sheet it sits behind. */
    className={cn(SCRIM, className)}
    {...props}
    ref={ref}
  />
));
SheetOverlay.displayName = SheetPrimitive.Overlay.displayName;

const sheetVariants = cva(
  /* Tactile pass, stage 3. A sheet is the overlay surface with the modal shadow;
     the shadow's ring is its edge, so there is no border. It slides from its own
     side: up in 320ms and down in 200ms from the bottom, 240 / 200 from a side,
     solid the whole way (no fade). Motion lives in src/index.css ("Overlay
     motion"), and a reader who asked for less motion gets a crossfade.
     Handoff O-001 rule 6 (nothing springs or scales) still holds. */
  "fixed z-50 gap-4 p-6",
  {
    variants: {
      side: {
        top: `inset-x-0 top-0 ${SHEET_SURFACE} ${SHEET_MOTION.top}`,
        /* Handoff O-001 rule 1: every bottom sheet is rounded-t-[30px]
           bg-card, no border (the site keeps its 30px, not the skill's 14px).
           The filter sheet (O-002) is the one exception, and opts out via its
           own className override. Content padding and the grab handle are NOT
           baked in here: several callers (gate-sheet.tsx, etc.) already draw
           their own per S-012 and would double up -- see SheetGrabHandle below
           for new callers, and each existing caller's own comment for why it
           self-draws. */
        bottom: `inset-x-0 bottom-0 rounded-t-[30px] ${SHEET_SURFACE} ${SHEET_MOTION.bottom}`,
        left: `inset-y-0 left-0 h-full w-3/4 sm:max-w-sm ${SHEET_SURFACE} ${SHEET_MOTION.left}`,
        right: `inset-y-0 right-0 h-full w-3/4 sm:max-w-sm ${SHEET_SURFACE} ${SHEET_MOTION.right}`,
      },
    },
    defaultVariants: {
      side: "right",
    },
  },
);

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  /**
   * Extra classes for the scrim behind this one sheet.
   *
   * Exists so a single surface can frost its backdrop without changing the
   * overlay for every sheet and dialog in the product. O-001 rule 2 sets one
   * scrim spec deliberately, and a blur repaints the page behind it on every
   * scroll frame, so this is opt-in per sheet rather than a new default.
   */
  overlayClassName?: string;
  /**
   * Hides the Radix close `X` visually while keeping it focusable and
   * labelled (O-001) — for sheets that draw their own close control (e.g.
   * the filter sheet's 44px disc), so there's never a second, competing
   * close affordance.
   */
  hideCloseButton?: boolean;
}

const SheetContent = React.forwardRef<React.ElementRef<typeof SheetPrimitive.Content>, SheetContentProps>(
  ({ side = "right", className, overlayClassName, children, hideCloseButton, ...props }, ref) => (
    <SheetPortal>
      <SheetOverlay className={overlayClassName} />
      <SheetPrimitive.Content ref={ref} className={cn(sheetVariants({ side }), className)} {...props}>
        {children}
        {/* Not rendered at all when the caller supplies its own close control.
            This was `sr-only`, which clips the button but leaves it in the tab
            order: Browse's Filters sheet passes hideCloseButton and draws its
            own "Close filters", so a keyboard user hit an invisible second stop
            sitting on top of the visible one, and the accessibility tree
            announced both "Close filters" and "Close". Clipping is not
            removing. */}
        {!hideCloseButton && (
        <SheetPrimitive.Close
          className={cn(
            /* Concentric radius: every `side="bottom"` sheet (the only
               variant with a rounded corner at all — left/right/top are
               square) renders rounded-t-[30px], and this button sits at a
               fixed 16px inset in that top-right corner — 30 - 16 = 14px,
               not the generic rounded-md (10px) this had been hardcoded
               to regardless of what radius the sheet actually rendered
               at. left/right/top sheets have no rounded corner here to
               match, so the value is a no-op for them either way. */
            "absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-[14px] opacity-70 ring-offset-background before:absolute before:-inset-0.5 before:content-[''] transition-[opacity,transform] duration-150 active:scale-press-small data-[state=open]:bg-secondary hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none",
          )}
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  ),
);
SheetContent.displayName = SheetPrimitive.Content.displayName;

/** Handoff O-001 rule 1: the 36x4 rounded-full bg-muted grab handle every
 *  bottom sheet gets, centred at pt-3. Not auto-rendered by SheetContent —
 *  several existing callers already draw their own inline per S-012, and
 *  auto-injecting one here would double them up — so new sheets render
 *  this explicitly as their first child instead. */
function SheetGrabHandle() {
  return <div aria-hidden className="mx-auto mb-4 h-1 w-9 flex-none rounded-full bg-muted" />;
}

const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-2 text-center sm:text-left", className)} {...props} />
);
SheetHeader.displayName = "SheetHeader";

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn(ACTION_FOOTER, className)} {...props} />
);
SheetFooter.displayName = "SheetFooter";

const SheetTitle = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title ref={ref} className={cn("text-lg font-semibold text-foreground", className)} {...props} />
));
SheetTitle.displayName = SheetPrimitive.Title.displayName;

const SheetDescription = React.forwardRef<
  React.ElementRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
SheetDescription.displayName = SheetPrimitive.Description.displayName;

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetGrabHandle,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
  SheetTrigger,
};
