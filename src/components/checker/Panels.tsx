import * as React from 'react';
import { Camera, Gauge, Keyboard, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { stepTile } from '@/lib/checker-bento';
import { AI_SURE_TITLE, aiSureLabel } from '@/lib/checker-kid-reasons';

/* The sides of the verify screen, made impossible to mix up.

   Owner, 11 Oct 2026: "That UI is not clear as to which is the picture." So:
     LEFT   what the computer typed: a plain neutral card, small chip
            "Typed by the computer".
     RIGHT  the printed paper: a strongly framed box, brand coloured border,
            chip "Photo of the printed paper", a paper-like sheet inside.
   On a phone the sides are tabs that always show the same question: Typed and
   Printed in the practice round, Question, Page and Fix on the verify screen.

   `tile` is the bento look of the verify screen (12 Oct 2026): the frame fills
   the cell it is given, with a smaller radius and tighter padding, and the
   caller puts the scrolling part inside it. Without `tile` nothing changes.

   Pure presentation: the practice round uses these too, so nothing here may
   import Supabase or the checker API. */

export type PanelId = 'typed' | 'printed' | 'fix';

/** Concentric corners: outer 20, inner 10 (outer minus the 10px frame). */
const PAPER_RULES: React.CSSProperties = {
  backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0 27px, rgba(27, 26, 24, 0.045) 27px 28px)',
};

/** Bento tile corners: 20 on a phone (30 outside minus 10), 18 from md up (30 minus 12). */
const TILE_RADIUS = 'rounded-[20px] md:rounded-[18px]';

/** The small "Typed by the computer" badge. On the verify screen it sits on the part card itself. */
export function TypedBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[12px] font-semibold text-warm-secondary [@media(max-width:399px)]:px-2">
      {/* The icon is decoration: below 400px it goes so this badge and the "Computer 92% sure" pill share one row. */}
      <Keyboard className="h-3.5 w-3.5 [@media(max-width:399px)]:hidden" aria-hidden="true" />
      Typed by the computer
    </span>
  );
}

/** "Computer 92% sure", next to the Typed badge. Nothing at all when the computer gave no number. Pure presentation. */
export function AiSurePill({ percent }: { percent: number | null | undefined }) {
  const label = aiSureLabel(percent);
  if (!label) return null;
  return (
    <span
      title={AI_SURE_TITLE}
      data-testid="ai-sure-pill"
      className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-[12px] font-semibold tabular-nums text-warm-secondary [@media(max-width:399px)]:px-2"
    >
      <Gauge className="h-3.5 w-3.5 [@media(max-width:399px)]:hidden" aria-hidden="true" />
      {label}
      <span className="sr-only">. {AI_SURE_TITLE}</span>
    </span>
  );
}

export function TypedFrame({
  children,
  className,
  panelClass,
  tile,
  tabbed = true,
  chip = true,
}: {
  children: React.ReactNode;
  className?: string;
  /** Extra classes that decide when it shows (the phone tabs hide it). */
  panelClass?: string;
  /** The bento look: fills its cell, compact header, the caller scrolls the inside. */
  tile?: boolean;
  /** False when no tab points at it (tablet and laptop): it is then a plain region. */
  tabbed?: boolean;
  /** False when the caller puts the "Typed by the computer" badge on its own card (the verify screen). */
  chip?: boolean;
}) {
  return (
    <section
      id="verify-panel-typed"
      role={tabbed ? 'tabpanel' : 'region'}
      aria-labelledby={tabbed ? 'verify-tab-typed' : undefined}
      aria-label={tabbed ? undefined : 'What the computer typed'}
      data-panel="typed"
      className={cn(
        'min-w-0 flex-col border border-warm-hairline bg-card',
        tile ? cn(TILE_RADIUS, 'min-h-0 p-3') : 'rounded-[20px] p-3 sm:p-4',
        panelClass ?? 'flex',
        className,
      )}
    >
      <header className={cn('flex flex-wrap items-center gap-x-2.5 gap-y-1.5', chip ? (tile ? 'mb-2 shrink-0' : 'mb-3') : 'sr-only')}>
        {chip ? <TypedBadge /> : null}
        <h3 className={cn('text-[15px] font-bold text-foreground', tile && 'sr-only')}>What the computer typed</h3>
      </header>
      {children}
    </section>
  );
}

/** Phone only: the tile that holds the fixing tools, beside Question and Page. */
export function FixFrame({
  children,
  className,
  panelClass,
}: {
  children: React.ReactNode;
  className?: string;
  panelClass?: string;
}) {
  return (
    <section
      id="verify-panel-fix"
      role="tabpanel"
      aria-labelledby="verify-tab-fix"
      data-panel="fix"
      className={cn('min-h-0 min-w-0 flex-col border border-warm-hairline bg-card p-3', TILE_RADIUS, panelClass ?? 'flex', className)}
    >
      <header className="mb-2 flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-[12px] font-semibold text-warm-secondary">
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          Fix it
        </span>
        <h3 className="sr-only">Fix what the computer typed</h3>
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
  tile,
  tabbed = true,
  id = 'verify-panel-printed',
  label = 'Photo of the printed paper',
  title = 'The printed paper',
  headerExtra,
  bodyClass,
}: {
  children: React.ReactNode;
  className?: string;
  panelClass?: string;
  tourId?: string;
  /** The bento look: fills its cell, compact header. */
  tile?: boolean;
  /** False when no tab points at it (tablet and laptop): it is then a plain region. */
  tabbed?: boolean;
  /** A second printed tile (the whole page) needs its own id. */
  id?: string;
  /** The chip in the header. */
  label?: string;
  /** The heading (hidden in a tile, the chip says it). */
  title?: string;
  /** Something small on the right of the header, like an Enlarge button. */
  headerExtra?: React.ReactNode;
  /** Classes for the paper sheet inside the frame. */
  bodyClass?: string;
}) {
  return (
    <section
      id={id}
      role={tabbed ? 'tabpanel' : 'region'}
      aria-labelledby={tabbed ? `verify-tab-${id === 'verify-panel-printed' ? 'printed' : 'page'}` : undefined}
      aria-label={tabbed ? undefined : title}
      data-panel="printed"
      className={cn(
        'min-w-0 flex-col border-2 border-brand bg-brand-subtle shadow-card-bone',
        tile ? cn(TILE_RADIUS, 'min-h-0 p-2') : 'rounded-[20px] p-2.5',
        panelClass ?? 'flex',
        className,
      )}
    >
      <header className={cn('flex items-center gap-x-2.5 gap-y-1.5 px-1', tile ? 'mb-1.5 shrink-0 flex-nowrap' : 'mb-2 flex-wrap pt-0.5')}>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1 text-[12px] font-bold text-foreground">
          <Camera className="h-3.5 w-3.5" aria-hidden="true" />
          {label}
        </span>
        <h3 className={cn('text-[15px] font-bold text-foreground', tile && 'sr-only')}>{title}</h3>
        {headerExtra ? <div className="ml-auto flex items-center gap-1.5">{headerExtra}</div> : null}
      </header>
      <div
        data-tour={tourId}
        className={cn(
          'flex min-w-0 flex-col bg-white',
          tile ? 'min-h-0 flex-1 gap-2 rounded-[8px] p-2' : 'gap-2.5 rounded-[10px] p-2 sm:p-2.5',
          bodyClass,
        )}
        style={PAPER_RULES}
      >
        {children}
      </div>
    </section>
  );
}

export interface PanelTabSpec {
  id: PanelId;
  label: string;
  sub: string;
  icon: React.ReactNode;
  /** Classes for the selected look. */
  on: string;
}

const TYPED_PRINTED_TABS: PanelTabSpec[] = [
  { id: 'typed', label: 'Typed', sub: 'by the computer', icon: <Keyboard className="h-5 w-5" aria-hidden="true" />, on: 'bg-panel text-background' },
  { id: 'printed', label: 'Printed', sub: 'the paper photo', icon: <Camera className="h-5 w-5" aria-hidden="true" />, on: 'bg-brand text-foreground' },
];

/** The verify screen on a phone: Question and Page, one tile at a time (swipe or tap). The words, the
 *  tools and the editor are all in the Question tile now, so there is no third tile to hunt for. */
export const VERIFY_TABS: PanelTabSpec[] = [
  { id: 'typed', label: 'Question', sub: 'the words and tools', icon: <Keyboard className="h-5 w-5" aria-hidden="true" />, on: 'bg-panel text-background' },
  { id: 'printed', label: 'Page', sub: 'the paper', icon: <Camera className="h-5 w-5" aria-hidden="true" />, on: 'bg-brand text-foreground' },
];

/** Big tabs for a phone. Hidden from lg up by default, where the panels sit side by side. */
export function PanelTabs({
  value,
  onChange,
  tabs = TYPED_PRINTED_TABS,
  className,
}: {
  value: PanelId;
  onChange: (next: PanelId) => void;
  tabs?: PanelTabSpec[];
  /** Replaces the default "lg:hidden". */
  className?: string;
}) {
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const next = stepTile(
        tabs.map((t) => t.id),
        value,
        e.key === 'ArrowRight' ? 1 : -1,
      );
      onChange(next);
      document.getElementById(`verify-tab-${next}`)?.focus();
    }
  }
  const three = tabs.length > 2;
  return (
    <div
      role="tablist"
      aria-label="Which side to look at"
      data-testid="panel-tabs"
      onKeyDown={onKeyDown}
      // On a short phone (under 700px of height) the tab bar gives the words the room: tighter, and no second line.
      className={cn('relative mb-3 grid gap-1.5 rounded-[20px] bg-muted p-1.5 [@media(max-height:699px)]:mb-2 [@media(max-height:699px)]:p-1', three ? 'grid-cols-3' : 'grid-cols-2', className ?? 'lg:hidden')}
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
              'flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-[14px] px-3 py-1.5 transition-[transform,background-color,color] duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand [@media(max-height:699px)]:min-h-[44px] [@media(max-height:699px)]:py-1',
              three && 'min-h-[48px] px-1.5',
              selected ? t.on : 'bg-transparent text-warm-secondary',
            )}
          >
            <span className="flex items-center gap-1.5 text-[16px] font-bold leading-none">
              {t.icon}
              {t.label}
            </span>
            <span className="text-[12px] leading-none opacity-80 [@media(max-height:699px)]:sr-only">{t.sub}</span>
          </button>
        );
      })}
    </div>
  );
}
