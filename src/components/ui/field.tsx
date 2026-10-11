import * as React from "react";

import { cn } from "@/lib/utils";
import { Eyebrow } from "@/components/ui/eyebrow";

/* Redesign P4 (components.md §1).

   Anatomy, top to bottom: uppercase label → control → error line.
   - 56px single-line, 112–132px multiline
   - radius 15px, shadow-border (never border + shadow stacked, design.md §0.5)
   - focus: ring-2 brand plus a brand hairline
   - NO floating labels. The label sits above and stays there.
   - Errors appear on BLUR only, never while typing, and read as one plain
     sentence (design.md §3 "Feedback"). Never a bare red border.

   This is a wrapper: it owns the label/error/ids and renders whatever control
   you give it, so <input>, <textarea> and <select> all share one appearance. */

const controlBase =
  "w-full rounded-[16px] bg-card px-4 text-[16px] text-foreground shadow-border outline-none transition-shadow duration-150 placeholder:text-warm-label focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50";

export interface FieldProps {
  label: string;
  /** Rendered under the control on blur. One plain-language sentence. */
  error?: string;
  /** Quiet helper line, shown only when there is no error. */
  hint?: string;
  /** Marks the control required and appends a visible cue to the label. */
  required?: boolean;
  className?: string;
  children: (controlProps: {
    id: string;
    className: string;
    "aria-invalid": boolean | undefined;
    "aria-describedby": string | undefined;
    required: boolean | undefined;
  }) => React.ReactNode;
}

function Field({ label, error, hint, required, className, children }: FieldProps) {
  const id = React.useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Eyebrow as="span">
        <label htmlFor={id}>
          {label}
          {required ? <span className="text-facet-destructive"> *</span> : null}
        </label>
      </Eyebrow>

      {children({
        id,
        className: cn(
          controlBase,
          "h-14",
          error && "ring-2 ring-facet-destructive",
        ),
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
        required: required || undefined,
      })}

      {error ? (
        /* role="alert" so the message is announced when it appears on blur. */
        <p id={errorId} role="alert" className="text-meta text-facet-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-meta text-warm-meta">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Single-line input, 56px. */
const FieldInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(controlBase, "h-14", className)} {...props} />
));
FieldInput.displayName = "FieldInput";

/** Multiline, 112–132px per components.md P4. */
const FieldTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(controlBase, "min-h-[112px] max-h-[132px] py-4 leading-relaxed", className)}
    {...props}
  />
));
FieldTextarea.displayName = "FieldTextarea";

/** Single-line select, 56px — same shell as FieldInput so a chosen value and a
 *  typed value look identical in a form. `appearance-none` plus the caret drawn
 *  as a background image, because the platform caret ignores the field's own
 *  type scale and colour. */
const FieldSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    /* className last would look natural, but it isn't here: `Field` (the
       wrapper every FieldSelect actually gets used through) already builds
       its own controlProps.className from controlBase — which sets px-4,
       i.e. a 16px right padding — and that whole string arrives here AS
       `className`. Putting it last let twMerge treat it as this element's
       final word on padding-right, silently overriding pr-12 back down to
       16px: barely more than the chevron's own 18px+20px offset, so long
       option text ran right under the arrow instead of stopping short of
       it. This project's own arrow-clearance classes go last instead, so
       they always win regardless of what a wrapper's className carries in. */
    className={cn(
      controlBase,
      className,
      "h-14 appearance-none bg-[length:20px] bg-[right_18px_center] bg-no-repeat pr-12",
    )}
    style={{
      backgroundImage:
        "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236B6257' stroke-width='2.25' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
    }}
    {...props}
  />
));
FieldSelect.displayName = "FieldSelect";

/**
 * Convenience hook for the blur-only error rule: keeps the message hidden until
 * the control has been blurred at least once, so typing is never interrupted.
 */
function useBlurValidation(value: string, validate: (v: string) => string | undefined) {
  const [touched, setTouched] = React.useState(false);
  const message = validate(value);
  return {
    error: touched ? message : undefined,
    onBlur: () => setTouched(true),
    /* Clear the touched flag when the field becomes valid again, so a corrected
       field stops shouting before the next blur. */
    reset: () => setTouched(false),
    isValid: !message,
  };
}

export { Field, FieldInput, FieldSelect, FieldTextarea, useBlurValidation, controlBase };
