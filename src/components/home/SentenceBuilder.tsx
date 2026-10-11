import * as React from "react";
import { Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/* Redesign C8 (components.md §2, design.md §2.2).

   "I need a [Maths] teacher for [Class 10] in [Lalpur]" — the sentence IS the
   search form. Lives in the footer on every page.

   Two modes:
     teachers  I need a [subject] teacher for [class] near [area]
     papers    Show me [board] [class] papers in [subject] from [school]

   Rules that matter:
   - The CTA states a LIVE count, orange in teacher mode, indigo in papers mode.
     The count is a real number from the query that would run; when the caller
     cannot supply one, the CTA drops the clause rather than showing a zero
     (design.md §0.10).
   - Filled chips alternate ±1.5° rotation so the line reads as handwritten;
     reduced motion flattens them.
   - Chips never wrap inside themselves (design.md §2.4). */

export interface SentenceSlot {
  key: string;
  /** Placeholder shown when the slot is empty, e.g. "subject". */
  placeholder: string;
  value?: string;
  options: string[];
}

export interface SentenceBuilderProps {
  mode: "teachers" | "papers";
  slots: SentenceSlot[];
  onChange: (key: string, value: string) => void;
  onSubmit: () => void;
  /** Real result count. Omit entirely if it cannot be fetched. */
  count?: number;
  className?: string;
}

/* The literal words between the slots, per design.md §2.2. */
const FRAMES: Record<SentenceBuilderProps["mode"], string[]> = {
  /* leading, then one connector after each slot */
  teachers: ["I need a", "teacher for", "near", ""],
  papers: ["Show me", "", "papers in", "from", ""],
};

function SlotChip({
  slot,
  index,
  onPick,
}: {
  slot: SentenceSlot;
  index: number;
  onPick: (value: string) => void;
}) {
  const filled = Boolean(slot.value);
  /* Alternating tilt — decorative only. */
  const tilt = index % 2 === 0 ? "-rotate-[1.5deg]" : "rotate-[1.5deg]";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-xl px-3 align-middle transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background focus-visible:ring-offset-2 focus-visible:ring-offset-panel active:scale-[0.97]",
            "backdrop-blur-md backdrop-saturate-150 shadow-[0_1px_0_0_rgba(255,255,255,0.25)_inset,0_8px_20px_-8px_rgba(0,0,0,0.5)]",
            filled
              ? "bg-white/[0.16] text-background ring-1 ring-inset ring-white/30 hover:bg-white/[0.22]"
              : "bg-white/[0.08] text-background ring-1 ring-inset ring-white/20 hover:bg-white/[0.12]",
            tilt,
            /* D-007: tilt flattens at `lg` (34-desktop.md, explicitly calls
               out the sentence-builder slot chips, H-023) — a ±1.5deg
               "handwritten" tilt on a 340px pill reads as charm, the same
               tilt on a desktop-width row reads as a broken line. Reduced
               motion (separate, pre-existing rule) still flattens at every
               width via motion-reduce:rotate-0 below. */
            "motion-reduce:rotate-0 lg:rotate-0",
          )}
          aria-label={filled ? `${slot.placeholder}: ${slot.value}` : `Choose ${slot.placeholder}`}
        >
          {filled ? (
            slot.value
          ) : (
            <>
              <Plus aria-hidden className="size-4" />
              {slot.placeholder}
            </>
          )}
        </button>
      </PopoverTrigger>
      {/* Handoff O-009: same popover shell as O-008 (rounded-[24px] bg-card,
          own shadow), but plain rows, not the field-picker's larger row —
          this opens over the dome, so it must carry its own bg-card/shadow
          rather than inheriting the dome's fill. */}
      <PopoverContent align="start" sideOffset={8} className="max-h-72 w-56 overflow-y-auto p-2">
        <ul
          className="flex flex-col gap-0.5"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            const items = Array.from(e.currentTarget.querySelectorAll('button'));
            const i = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = e.key === 'ArrowDown' ? Math.min(i + 1, items.length - 1) : Math.max(i - 1, 0);
            items[next === -1 ? 0 : next]?.focus();
          }}
        >
          {slot.options.map((opt) => (
            <li key={opt}>
              <button
                type="button"
                onClick={() => onPick(opt)}
                className={cn(
                  "flex min-h-[48px] w-full items-center rounded-[12px] px-3 text-left text-[15px] font-semibold text-foreground transition-colors duration-150 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  slot.value === opt && "bg-brand-subtle text-brand-deep",
                )}
              >
                {opt}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function SentenceBuilder({
  mode,
  slots,
  onChange,
  onSubmit,
  count,
  className,
}: SentenceBuilderProps) {
  const frame = FRAMES[mode];

  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-3 font-display text-[26px] font-black leading-tight text-background lg:text-page-title">
        {frame[0] ? <span>{frame[0]}</span> : null}
        {slots.map((slot, i) => (
          <React.Fragment key={slot.key}>
            <SlotChip slot={slot} index={i} onPick={(v) => onChange(slot.key, v)} />
            {frame[i + 1] ? <span>{frame[i + 1]}</span> : null}
          </React.Fragment>
        ))}
      </p>

      <div>
        <Button
          variant={mode === "teachers" ? "primary" : "indigo"}
          size={52}
          onClick={onSubmit}
        >
          {count === undefined
            ? mode === "teachers"
              ? "Find them"
              : "Find papers"
            : `Show ${count} ${mode === "teachers" ? "teachers" : "papers"}`}
        </Button>
      </div>
    </div>
  );
}

export { SentenceBuilder };
