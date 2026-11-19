import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, CircleCheck, CircleDot, ClipboardCheck, Globe, Hourglass, TriangleAlert, type LucideIcon } from 'lucide-react';
import {
  STAGES,
  STAGE_ORDER,
  buildTimeline,
  hasUndatedSteps,
  shortDate,
  type AttentionItem,
  type PaperMoments,
  type PaperStage,
  type TimelineStep,
} from '@/lib/paper-status';
import { cn } from '@/lib/utils';

/* One look for "what stage is this paper at", used on the HOD desk lists, a checker's My papers cards and the
   admin publish screen. A stage is never shown by colour alone: it always has an icon and its words, and the
   words are the ones in src/lib/paper-status.ts (the only place they are written).

   The label is one fixed shape (icon, then words). A paper that goes from "Checked, waiting to go live" to "Live"
   changes the words and the colour but nothing about where the label sits, so later stages can be added or
   re-worded without moving the layout around them. */

const ICON: Record<PaperStage, LucideIcon> = {
  not_ready: TriangleAlert,
  ready: CircleCheck,
  checking: ClipboardCheck,
  waiting: Hourglass,
  live: Globe,
};

/** Tint and text colour per stage, all from the site's own tokens (each pair reads at 4.5:1 or better). */
const TONE: Record<PaperStage, string> = {
  not_ready: 'bg-destructive/10 text-destructive',
  ready: 'bg-brand-blue-subtle text-brand-blue-deep',
  checking: 'bg-brand-subtle text-brand-deep',
  waiting: 'bg-[hsl(var(--mosaic-purple-bg))] text-[hsl(var(--mosaic-purple-text))]',
  live: 'bg-mint text-success-subtle-text',
};

/** The label on a paper: an icon and the stage in words. */
export function PaperStatusPill({ stage, label, className }: { stage: PaperStage; label?: string; className?: string }) {
  const Icon = ICON[stage];
  const meta = STAGES[stage];
  return (
    <span
      data-testid="paper-status"
      data-stage={stage}
      title={meta.hint}
      className={cn('inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold leading-tight', TONE[stage], className)}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{label ?? meta.label}</span>
      <span className="sr-only">. {meta.hint}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ the strip of counts */

export type StageCounts = Partial<Record<PaperStage, number | null>>;

/**
 * The strip at the top of the HOD desk: how many papers are at each stage. Tapping one filters the list to that
 * stage; tapping the one already chosen clears the filter. A count that could not load shows "?" and still works.
 */
export function StageStrip({
  counts,
  capped,
  active,
  onPick,
}: {
  counts: StageCounts;
  /** A stage whose list was cut short shows "200+" instead of "200". */
  capped?: Partial<Record<PaperStage, boolean>>;
  active: PaperStage | null;
  onPick: (stage: PaperStage | null) => void;
}) {
  return (
    <div role="group" aria-label="Papers by stage" className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="stage-strip">
      {STAGE_ORDER.map((stage) => {
        const Icon = ICON[stage];
        const n = counts[stage];
        const on = active === stage;
        return (
          <button
            key={stage}
            type="button"
            aria-pressed={on}
            title={STAGES[stage].hint}
            data-stage={stage}
            onClick={() => onPick(on ? null : stage)}
            className={cn(
              'flex min-h-[64px] flex-col items-start justify-center gap-0.5 rounded-2xl px-3 py-2 text-left transition-transform duration-150 active:scale-press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
              TONE[stage],
              on ? 'ring-2 ring-foreground' : '',
            )}
          >
            <span className="flex items-center gap-1.5">
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="text-[20px] font-bold leading-none tabular-nums" data-testid="stage-count">
                {n == null ? '?' : capped?.[stage] ? `${n}+` : n}
              </span>
            </span>
            <span className="text-[12px] font-bold leading-tight">{STAGES[stage].short}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ needs attention */

/**
 * The papers that are stuck, each with its reason in plain words. Shows nothing when none are. A long list is cut
 * at `max` and says how many more there are, so the group stays a glance and not a page.
 */
export function AttentionGroup({ id, items, max = 6 }: { id: string; items: AttentionItem[]; max?: number }) {
  if (items.length === 0) return null;
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  return (
    <section aria-labelledby={id} className="rounded-[18px] bg-brand-subtle p-3 shadow-card" data-testid="attention-group">
      <h2 id={id} className="mb-2 flex items-center gap-2 text-[16px] font-bold text-foreground">
        <TriangleAlert className="h-4 w-4 shrink-0 text-brand-deep" aria-hidden />
        Needs attention
        <span className="text-[12px] font-normal text-warm-secondary">{items.length === 1 ? '1 paper' : `${items.length} papers`}</span>
      </h2>
      <ul className="space-y-2">
        {shown.map((it) => (
          <li key={it.key} className="rounded-2xl bg-card p-3" data-testid="attention-item">
            <div className="flex flex-wrap items-center gap-2">
              <PaperStatusPill stage={it.stage} />
              <span className="min-w-0 text-[14px] font-semibold text-foreground">{it.label}</span>
            </div>
            <p className="mt-1 text-[13px] text-foreground" data-testid="attention-reason">
              {it.reason}
            </p>
          </li>
        ))}
      </ul>
      {rest > 0 ? (
        <p className="mt-2 text-[12px] text-warm-secondary" data-testid="attention-more">
          and {rest} more below
        </p>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ the timeline inside a paper */

/** The key moments of one paper as a list of steps with dates. A step done without a recorded date says so. */
export function PaperTimeline({ steps, className }: { steps: TimelineStep[]; className?: string }) {
  return (
    <div className={className} data-testid="paper-timeline">
      <ol aria-label="Key moments of this paper" className="space-y-1.5">
        {steps.map((s) => (
          <li key={s.key} data-step={s.key} data-state={s.state} aria-current={s.state === 'current' ? 'step' : undefined} className="flex items-center gap-2 text-[13px]">
            {s.state === 'done' ? (
              <Check className="h-4 w-4 shrink-0 text-success-subtle-text" aria-hidden />
            ) : s.state === 'current' ? (
              <CircleDot className="h-4 w-4 shrink-0 text-brand-deep" aria-hidden />
            ) : (
              <span className="inline-block h-4 w-4 shrink-0 rounded-full border-2 border-warm-hairline-strong" aria-hidden />
            )}
            <span className={cn(s.state === 'later' ? 'text-warm-meta' : 'font-semibold text-foreground', s.state === 'current' && 'text-brand-deep')}>{s.label}</span>
            <span className="ml-auto tabular-nums text-warm-secondary">{shortDate(s.at)}</span>
            <span className="sr-only">{s.state === 'done' ? (s.at ? `: done ${shortDate(s.at)}` : ': done') : s.state === 'current' ? ': this is where it is now' : ': not yet'}</span>
          </li>
        ))}
      </ol>
      {hasUndatedSteps(steps) ? <p className="mt-2 text-[12px] text-warm-meta">A tick without a date means it happened but the date was not kept.</p> : null}
    </div>
  );
}

/**
 * "Where this paper has been": closed until opened, and the dates are only fetched then, so a list of 200 papers
 * asks for nothing. If the dates cannot be fetched (the server function is not there yet, or the connection
 * dropped), the timeline is built from what the row already knows, so the steps and the current stage still show.
 */
export function PaperTimelineDisclosure({
  queryKey,
  load,
  fallback,
  stage,
  className,
}: {
  queryKey: readonly unknown[];
  load: () => Promise<PaperMoments | null>;
  /** The dates the row already carries, for example when it was given out. */
  fallback: PaperMoments;
  stage: PaperStage;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey, queryFn: load, enabled: open, staleTime: 60_000, retry: false });
  const merged: PaperMoments = { ...fallback };
  if (q.data) for (const k of Object.keys(q.data) as (keyof PaperMoments)[]) merged[k] = q.data[k] ?? fallback[k];
  return (
    <details className={cn('group', className)} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} data-testid="timeline-disclosure">
      <summary className="tap-44 inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-full bg-card px-3 text-[13px] font-semibold text-warm-secondary marker:hidden hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
        Where this paper has been
      </summary>
      <div className="mt-2 rounded-2xl bg-card p-3">
        {open && q.isFetching && !q.data ? <p className="mb-2 text-[12px] text-warm-meta">Loading the dates...</p> : null}
        <PaperTimeline steps={buildTimeline(merged, stage)} />
      </div>
    </details>
  );
}
