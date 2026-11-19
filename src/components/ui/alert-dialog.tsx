import * as React from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";

import { cn } from "@/lib/utils";
import { ACTION_FOOTER, MODAL_SURFACE, SCRIM } from "@/lib/overlay-styles";

const AlertDialog = AlertDialogPrimitive.Root;

const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

const AlertDialogPortal = AlertDialogPrimitive.Portal;

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    /* Handoff O-013: a flat tint, no blur, the same one every sheet and dialog uses
       (SCRIM, src/lib/overlay-styles.ts). It is the literal #1B1A18 at 45%, NOT
       bg-panel/45: `panel` is var(--panel-dark), a raw hex, and Tailwind cannot
       compute an alpha from it, so that class emitted nothing and the destructive
       confirmations ("delete this review?") opened over an undimmed page. */
    className={cn(SCRIM, className)}
    {...props}
    ref={ref}
  />
));
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName;

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(({ className, ...props }, ref) => (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <AlertDialogPrimitive.Content
      ref={ref}
      /* Handoff O-013: rounded-[24px] bg-card p-6, no border. Tactile pass, stage 3: the
         edge is the shared modal shadow (a ring and a crisp drop, no 44px blur), and it
         arrives in 240ms with a 16px rise and leaves in 200ms. */
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-sm translate-x-[-50%] translate-y-[-50%] gap-4 rounded-[24px] p-6",
        MODAL_SURFACE,
        className,
      )}
      {...props}
    />
  </AlertDialogPortal>
));
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName;

const AlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col text-left", className)} {...props} />
);
AlertDialogHeader.displayName = "AlertDialogHeader";

const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("mt-5", ACTION_FOOTER, className)} {...props} />
);
AlertDialogFooter.displayName = "AlertDialogFooter";

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    className={cn("text-[19px] font-extrabold tracking-[-0.03em] text-foreground", className)}
    {...props}
  />
));
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName;

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn("mt-2 text-[14px] leading-[1.6] text-warm-prose", className)}
    {...props}
  />
));
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName;

/* Handoff O-013: this dialog exists only for irreversible confirmations
   (its own name is "Alert dialog — destructive confirmations"; a reversible
   action gets a toast with Undo instead, per O-010) — so its action button
   is tinted #F9E2E2/#8C2A2A by default, never solid red, never a generic
   primary fill. A caller with a genuine non-destructive use for this shell
   (there is exactly one: TeacherDashboard's pause/resume) overrides via
   className rather than this primitive growing a variant prop for a single
   consumer. */
const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Action
    ref={ref}
    className={cn(
      "inline-flex h-12 w-full items-center justify-center rounded-full bg-[#F9E2E2] text-[15px] font-bold text-[#8C2A2A] shadow-button transition-[transform,box-shadow] duration-150 sm:w-auto sm:flex-1 hover:-translate-y-0.5 active:scale-press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName;

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn(
      "inline-flex h-12 w-full items-center justify-center rounded-full bg-muted text-[15px] font-bold text-foreground shadow-button transition-[transform,box-shadow] duration-150 sm:w-auto sm:flex-1 hover:-translate-y-0.5 active:scale-press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName;

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
