import { cn } from "@/lib/utils";

/* Redesign C14 (components.md §2) — the teacher-listing form's step indicator.

   A segmented bar, one segment per step, filled brand orange as steps complete.
   NEVER a percentage, NEVER a number-in-a-circle stepper (components.md §7). */

export interface ProgressStepsProps {
  /** Total number of steps. */
  steps: number;
  /** Zero-based index of the current step. */
  current: number;
  /** Step label, read by screen readers and shown as the visible "Step N of M" line. */
  label: string;
  className?: string;
  /** `light` (default) reads on the page background. `dark` reads white-on-panel, for use inside the 72px dark header shell (pages.md §13). */
  tone?: "light" | "dark";
  /**
   * Render the caption as `label` verbatim instead of `Step N of M · {label}`.
   * The "Step N of M" framing is right for a wizard (Join); a non-wizard use
   * like a profile-completeness bar (TeacherDashboard) already composes its
   * own "X of Y done" into `label`, and the default caption would have
   * doubled it up ("Step 3 of 11 · 3 of 11 done"). `aria-label` is already
   * just `label` either way, so this only changes the visible text.
   */
  hideStepPrefix?: boolean;
  /**
   * Handoff JA-002: the apply wizard's header row is back-disc + bar + a
   * "Step N of M" label all on one line, not the bar-then-caption stack
   * below. Suppresses the caption `<p>` so the caller can compose that
   * label itself, positioned in the row. Other callers (e.g. the dashboard
   * completeness bar) are unaffected — this defaults to false.
   */
  hideCaption?: boolean;
}

function ProgressSteps({ steps, current, label, className, tone = "light", hideStepPrefix = false, hideCaption = false }: ProgressStepsProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        role="progressbar"
        aria-valuenow={current + 1}
        aria-valuemin={1}
        aria-valuemax={steps}
        aria-label={label}
        className="flex gap-1.5"
      >
        {Array.from({ length: steps }).map((_, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={cn(
              "h-[5px] flex-1 rounded-full transition-colors duration-150",
              i <= current ? "bg-brand" : tone === "dark" ? "bg-white/[0.18]" : "bg-warm-hairline",
            )}
          />
        ))}
      </div>
      {hideCaption ? null : (
        <p className={cn("text-meta font-semibold", tone === "dark" ? "text-background/70" : "text-warm-meta")}>
          {hideStepPrefix ? label : `Step ${current + 1} of ${steps} · ${label}`}
        </p>
      )}
    </div>
  );
}

export { ProgressSteps };
