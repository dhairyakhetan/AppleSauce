import * as React from 'react';
import { Camera, Keyboard } from 'lucide-react';
import { cn } from '@/lib/utils';

/* The two sides of the verify screen, made impossible to mix up.

   Owner, 11 Oct 2026: "That UI is not clear as to which is the picture." So:
     LEFT   what the computer typed: a plain neutral card, small chip
            "Typed by the computer".
     RIGHT  the printed paper: a strongly framed box, brand coloured border,
            chip "Photo of the printed paper", a paper-like sheet inside.
   On a phone the two are tabs ("Typed" / "Printed") that always show the same
   question.

   Pure presentation: the practice round uses these too, so nothing here may
   import Supabase or the checker API. */

export type PanelId = 'typed' | 'printed';

/** Concentric corners: outer 20, inner 10 (outer minus the 10px frame). */
const PAPER_RULES: React.CSSProperties = {
  backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0 27px, rgba(27, 26, 24, 0.045) 27px 28px)',
};

export function TypedFrame({
  children,
  className,
  panelClass,
}: {
  children: React.ReactNode;
  className?: string;
  /** Extra classes that decide when it shows (the phone tabs hide it). */
  panelClass?: string;
}) {
  return (
    <section
      id="verify-panel-typed"
      role="tabpanel"
      aria-labelledby="verify-tab-typed"
      data-panel="typed"
      className={cn('min-w-0 flex-col rounded-[20px] border border-warm-hairline bg-card p-3 sm:p-4', panelClass ?? 'flex', className)}
    >
      <header className="mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-[12px] font-semibold text-warm-secondary">
          <Keyboard className="h-3.5 w-3.5" aria-hidden="true" />
          Typed by the computer
        </span>
        <h3 className="text-[15px] font-bold text-foreground">What the computer typed</h3>
      </header>
      {children}
    </section>
  );
}

export function PrintedFrame({
  children,
  className,
  panelClass,
  tourId,
}: {
  children: React.ReactNode;
  className?: string;
  panelClass?: string;
  tourId?: string;
}) {
  return (
    <section
      id="verify-panel-printed"
      role="tabpanel"
      aria-labelledby="verify-tab-printed"
      data-panel="printed"
      className={cn(
        'min-w-0 flex-col rounded-[20px] border-2 border-brand bg-brand-subtle p-2.5 shadow-card-bone',
        panelClass ?? 'flex',
        className,
      )}
    >
      <header className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 px-1 pt-0.5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1 text-[12px] font-bold text-foreground">
          <Camera className="h-3.5 w-3.5" aria-hidden="true" />
          Photo of the printed paper
        </span>
        <h3 className="text-[15px] font-bold text-foreground">The printed paper</h3>
      </header>
      <div data-tour={tourId} className="flex min-w-0 flex-col gap-2.5 rounded-[10px] bg-white p-2 sm:p-2.5" style={PAPER_RULES}>
        {children}
      </div>
    </section>
  );
}

/** Two big tabs for a phone. Hidden from lg up, where both panels sit side by side. */
export function PanelTabs({ value, onChange }: { value: PanelId; onChange: (next: PanelId) => void }) {
  const tabs: { id: PanelId; label: string; sub: string; icon: React.ReactNode; on: string }[] = [
    { id: 'typed', label: 'Typed', sub: 'by the computer', icon: <Keyboard className="h-5 w-5" aria-hidden="true" />, on: 'bg-panel text-background' },
    { id: 'printed', label: 'Printed', sub: 'the paper photo', icon: <Camera className="h-5 w-5" aria-hidden="true" />, on: 'bg-brand text-foreground' },
  ];
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const next: PanelId = value === 'typed' ? 'printed' : 'typed';
      onChange(next);
      document.getElementById(`verify-tab-${next}`)?.focus();
    }
  }
  return (
    <div
      role="tablist"
      aria-label="Which side to look at"
      data-testid="panel-tabs"
      onKeyDown={onKeyDown}
      className="mb-3 grid grid-cols-2 gap-1.5 rounded-[20px] bg-muted p-1.5 lg:hidden"
    >
      {tabs.map((t) => {
        const selected = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`verify-tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`verify-panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              'flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-[14px] px-3 py-1.5 transition-[transform,background-color,color] duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
              selected ? t.on : 'bg-transparent text-warm-secondary',
            )}
          >
            <span className="flex items-center gap-1.5 text-[16px] font-bold leading-none">
              {t.icon}
              {t.label}
            </span>
            <span className="text-[12px] leading-none opacity-80">{t.sub}</span>
          </button>
        );
      })}
    </div>
  );
}
