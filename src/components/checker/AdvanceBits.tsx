import { cn } from '@/lib/utils';
import { PrintedFrame, TypedFrame } from '@/components/checker/Panels';
import type { PaperStripInfo } from '@/lib/checker-card-motion';

/* Small pieces of the "next question at once" flow (checker speed plan,
   12 Oct 2026). Pure presentation: no Supabase, no checker API, so they are
   tested with renderToStaticMarkup. */

/**
 * The cue that the paper changed. It sits at the top of the question card,
 * so it swipes in (or fades in, under reduced motion) together with the card,
 * and it stays for the whole paper. role="status" with aria-live="polite" makes
 * a screen reader say "Next paper: <title>" once, when it appears.
 *
 * `compact` (the default, it is the bento grid's version): one thin line, never a second row, so
 * it takes a fixed 36px from the grid and nothing else moves.
 */
export function PaperStrip({ info, compact = true }: { info: PaperStripInfo; compact?: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="paper-strip"
      className={cn(
        'flex items-center gap-x-3 gap-y-1.5 bg-brand-subtle',
        compact ? 'shrink-0 flex-nowrap overflow-hidden rounded-[18px] px-3 py-1.5' : 'mb-3 flex-wrap rounded-2xl px-4 py-2.5',
      )}
    >
      <span className="sr-only">{info.announcement}</span>
      <span aria-hidden="true" className="shrink-0 text-[12px] font-bold uppercase tracking-[.04em] text-warm-secondary">
        Next paper
      </span>
      <span aria-hidden="true" className={cn('min-w-0 text-[15px] font-bold leading-snug text-foreground', compact ? 'truncate' : 'text-balance')}>
        {info.title}
      </span>
      {info.facts.map((f) => (
        <span
          key={f}
          aria-hidden="true"
          className={cn('rounded-full bg-card px-3 py-0.5 text-[12px] font-semibold text-warm-secondary', compact && 'hidden shrink-0 lg:inline')}
        >
          {f}
        </span>
      ))}
      {info.position ? (
        <span aria-hidden="true" className="ml-auto shrink-0 text-[13px] font-semibold tabular-nums text-warm-secondary">
          {info.position}
        </span>
      ) : null}
    </div>
  );
}

/**
 * A verdict that has not reached the server yet. Calm on purpose: nothing is
 * lost, it is kept on this device and sent again. Shown only once a send has
 * failed; a save that is simply on its way shows nothing.
 *
 * `compact` puts it inside the bento grid's top tile instead of above the card.
 */
export function SaveStatusChip({
  waiting,
  failing,
  onRetry,
  compact = false,
}: {
  waiting: number;
  failing: boolean;
  onRetry: () => void;
  compact?: boolean;
}) {
  if (waiting === 0 || !failing) return null;
  return (
    <div
      role="status"
      data-testid="outbox-chip"
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 bg-brand-subtle font-semibold text-foreground',
        compact ? 'rounded-[12px] px-3 py-1 text-[13px]' : 'mb-3 rounded-2xl px-4 py-2.5 text-[14px]',
      )}
    >
      <span>
        Not saved yet, retrying
        {waiting > 1 ? ` (${waiting} answers)` : ''}
      </span>
      <span className={cn('text-[13px] font-normal text-warm-secondary', compact && 'hidden xl:inline')}>Kept on this device, nothing is lost.</span>
      <button
        type="button"
        onClick={onRetry}
        data-testid="outbox-retry"
        className={cn(
          'tap-44 rounded-full bg-card text-[13px] font-semibold text-foreground transition-transform duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
          compact ? 'px-3 py-0.5' : 'ml-auto px-4 py-1.5',
        )}
      >
        Retry
      </button>
    </div>
  );
}

/**
 * The next question's card while its words are still on their way: the
 * picture is already warm, so it is shown; the words are placeholders. It is
 * never given words that are not the question's own.
 *
 * It has the same two tiles as the real card, in the same grid, so the card
 * settles into it with nothing moving.
 */
export function IncomingCard({ pictureUrl }: { pictureUrl: string | null }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Getting the next question"
      data-testid="incoming-card"
      className="grid h-full min-h-0 grid-cols-1 grid-rows-2 gap-3 md:grid-cols-2 md:grid-rows-1"
    >
      <TypedFrame tile tabbed={false}>
        <div className="flex flex-col gap-3" aria-hidden="true">
          <div className="h-6 w-24 rounded-full bg-muted" />
          <div className="h-5 w-full rounded-[8px] bg-muted" />
          <div className="h-5 w-11/12 rounded-[8px] bg-muted" />
          <div className="h-5 w-3/5 rounded-[8px] bg-muted" />
        </div>
      </TypedFrame>
      <PrintedFrame tile tabbed={false}>
        {pictureUrl ? (
          <img src={pictureUrl} alt="" aria-hidden="true" className="mx-auto block h-auto max-h-full max-w-full min-h-0 shrink object-contain" />
        ) : (
          <div className="h-40 rounded-[8px] bg-muted" aria-hidden="true" />
        )}
      </PrintedFrame>
    </div>
  );
}
