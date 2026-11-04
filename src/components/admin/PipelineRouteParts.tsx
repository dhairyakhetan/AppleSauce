import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTweenedNumber } from '@/hooks/useTweenedNumber';
import { fmt, laneMotion, unitWord, updatedWords, type RouteStop, type StopLook, type TrustView } from '@/lib/pipeline-route';
import type { ProcessedState } from '@/lib/paper-registry';

/* The small pieces of the papers route (PipelineRoute.tsx lays them out).

   Everything that moves is aria-hidden and also off under reduced motion:
   the lanes, the parcels, the dashed elbow, the number count. The numbers and
   the words stay. */

/** A count that tweens to its new value. While it counts, the final number is laid invisibly in the same cell so the width never changes: no layout shift. */
export function AnimatedNumber({ value, animate, className }: { value: number; animate: boolean; className?: string }) {
  const { value: shown, tweening } = useTweenedNumber(value, animate);
  if (!tweening) {
    return (
      <span className={cn('tabular-nums', className)} data-value={value}>
        {fmt(value)}
      </span>
    );
  }
  return (
    <span className={cn('inline-grid tabular-nums', className)} data-value={value}>
      <span className="col-start-1 row-start-1 opacity-0">{fmt(value)}</span>
      <span className="col-start-1 row-start-1" aria-hidden>
        {fmt(shown)}
      </span>
    </span>
  );
}

/** "This screen read the numbers 12 seconds ago": when this browser last read the numbers. It says nothing about how fresh the data is (that is "The desk last sent numbers").Ticks once a second on its own so the rest of the route does not re-render. `now` is for tests. */
export function UpdatedAgo({ updatedAt, now }: { updatedAt: number | null; now?: number }) {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (now !== undefined) return;
    const id = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [now]);
  if (updatedAt === null) return <span>Reading the numbers</span>;
  return <span>This screen read the numbers {updatedWords((now ?? tick) - updatedAt)}</span>;
}

/** The small live dot. Green and pinging while reads succeed, amber and still when the last one failed. */
export function LiveDot({ failed, animate }: { failed: boolean; animate: boolean }) {
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden data-live-dot={failed ? 'stale' : 'live'}>
      {!failed && animate ? (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60 motion-reduce:hidden" />
      ) : null}
      <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', failed ? 'bg-amber-500' : 'bg-emerald-500')} />
    </span>
  );
}

/** One lane between two stops: a line, a quiet arrow, and parcels travelling along it. A lane with nothing flowing is still and faint. Top to bottom on a phone, left to right from lg. */
export function Lane({
  count,
  max,
  look,
  animate,
  className,
}: {
  count: number;
  max: number;
  look: StopLook;
  animate: boolean;
  className?: string;
}) {
  const m = laneMotion(count, max);
  const dots = animate ? m.dots : 0;
  return (
    <span
      aria-hidden
      data-lane
      data-dots={dots}
      className={cn(
        'pointer-events-none relative mx-auto block h-8 w-6 [--lane-len:2rem] lg:absolute lg:-left-9 lg:top-1/2 lg:mx-0 lg:h-6 lg:w-9 lg:-translate-y-1/2 lg:[--lane-len:2.25rem]',
        className,
      )}
      style={{ '--route-dur': `${m.seconds || 5}s` } as CSSProperties}
    >
      <span
        className={cn(
          'absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 rounded-full bg-warm-hairline-strong lg:left-0 lg:top-1/2 lg:h-0.5 lg:w-full lg:-translate-y-1/2 lg:translate-x-0',
          m.dots === 0 && 'opacity-50',
        )}
      />
      <ChevronDown className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-warm-meta lg:hidden" />
      <ChevronRight className="absolute left-1/2 top-1/2 hidden h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-warm-meta lg:block" />
      {Array.from({ length: dots }, (_, i) => (
        <span
          key={i}
          className={cn(
            'absolute left-1/2 top-0 -ml-1 h-2 w-2 rounded-full motion-reduce:hidden lg:left-0 lg:top-1/2 lg:-mt-1 lg:ml-0',
            'animate-route-dot-y lg:animate-route-dot-x',
            look.bar,
          )}
          style={{ animationDelay: `${(-(i * m.seconds) / m.dots).toFixed(2)}s` }}
        />
      ))}
    </span>
  );
}

/** The dashed elbow that carries the route from the end of the top row (the fourth column) back to the start of the bottom row. Wide screens only; on a phone the route is one column. */
export function Elbow({ animate, seconds }: { animate: boolean; seconds: number }) {
  return (
    <>
      <svg
        aria-hidden
        data-elbow
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute bottom-full left-1/2 hidden h-12 lg:block"
        style={{ width: 'calc(300% + 6.75rem)', '--route-dur': `${seconds || 5}s` } as CSSProperties}
      >
        <path
          d="M100 0 V50 H0 V100"
          fill="none"
          strokeWidth="2"
          strokeDasharray="6 6"
          vectorEffect="non-scaling-stroke"
          className={cn('stroke-warm-hairline-strong', animate && 'animate-route-dash motion-reduce:animate-none')}
        />
      </svg>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute -top-5 left-1/2 hidden h-4 w-4 -translate-x-1/2 text-warm-meta lg:block"
      />
    </>
  );
}

/** How many papers have how many questions left, as four small bars. */
export function BandBars({ bands, tone }: { bands: NonNullable<RouteStop['bands']>; tone: string }) {
  const total = bands.reduce((n, b) => n + b.count, 0);
  return (
    <div className="mt-3">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-warm-label">Questions left on each paper</p>
      <ul className="mt-1.5 space-y-1.5" aria-label="Papers by how many questions are left on them">
        {bands.map((b) => (
          <li key={b.key} data-band={b.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2 gap-y-1">
            <span className="text-[13px] text-warm-secondary">{b.label}</span>
            <span className="text-[13px] font-bold tabular-nums text-foreground">
              {fmt(b.count)} <span className="font-normal text-warm-secondary">{b.count === 1 ? 'paper' : 'papers'}</span>
            </span>
            <span className="col-span-2 block h-1.5 overflow-hidden rounded-full bg-card" aria-hidden>
              <span
                className={cn('block h-full origin-left rounded-full transition-transform duration-500 motion-reduce:transition-none', tone)}
                style={{ transform: `scaleX(${total > 0 ? b.count / total : 0})` }}
              />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const STRETCH =
  'after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none';

/** Labelled figures under a stop's headline: the other numbers the owner asked for at that stop. */
export function Figures({ figures }: { figures: NonNullable<RouteStop['figures']> }) {
  if (figures.length === 0) return null;
  return (
    <ul className="mt-3 space-y-1.5" aria-label="More numbers for this stop">
      {figures.map((f) => (
        <li key={f.label} className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 text-[13px] text-warm-secondary">
            {f.label}
            {f.note ? <span className="block text-[12px] text-warm-meta">{f.note}</span> : null}
          </span>
          <span className="shrink-0 text-right text-[14px] font-bold tabular-nums text-foreground">{f.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** A few labelled values side by side (papers, pictures, size). Each column is a small tile; a long value wraps inside its own tile, never into the next. */
export function SideBySide({ items }: { items: NonNullable<RouteStop['sideBySide']> }) {
  if (items.length === 0) return null;
  return (
    <dl
      aria-label="The queue in three numbers"
      data-side-by-side
      className="mt-3 grid gap-2"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map((f) => (
        <div key={f.label} className="min-w-0 rounded-xl bg-card px-2 py-2">
          <dt className="text-[12px] text-warm-secondary">{f.label}</dt>
          <dd className="whitespace-nowrap text-[15px] font-bold tabular-nums text-foreground">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** AI trust: one counter, X of 100 checks, and where each confidence level stands. Its link sits above the card's stretched link. */
export function TrustBox({ trust }: { trust: TrustView }) {
  return (
    <section aria-label="AI trust" className="mt-3 rounded-xl bg-card p-3" data-trust>
      <p className="text-[13px] font-bold text-foreground">{trust.headline}</p>
      <div
        role="progressbar"
        aria-label="AI trust checks done"
        aria-valuemin={0}
        aria-valuemax={trust.threshold}
        aria-valuenow={trust.done}
        className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full origin-left rounded-full bg-orange-400 transition-transform duration-500 motion-reduce:transition-none"
          style={{ transform: `scaleX(${trust.percent / 100})` }}
        />
      </div>
      <p className="mt-1.5 text-pretty text-[13px] leading-[1.5] text-warm-secondary">{trust.meaning}</p>
      {trust.levels.length > 0 ? (
        <ul className="mt-2 space-y-1.5" aria-label="Where each confidence level stands">
          {trust.levels.map((l) => (
            <li key={l.key} className="text-[12px] leading-snug">
              <span className="block text-warm-secondary">{l.label}</span>
              <span className={cn('block font-semibold', l.trusted ? 'text-[#24603D]' : 'text-warm-prose')}>{l.state}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <Link
        to={trust.href}
        className="relative z-10 mt-2 inline-flex min-h-10 items-center gap-1 text-[13px] font-semibold text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {trust.hrefLabel}
        <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </section>
  );
}

/** One stop: a numbered badge, a title, the live count, one line of meaning. If the stop leads somewhere, its title is the link and the whole card is the target (40px or more). A count that did not arrive reads "?", never 0. */
export function StopCard({
  stop,
  animate,
  onShowRegistry,
}: {
  stop: RouteStop;
  animate: boolean;
  /** Kept for callers. Every stop number is the same size now (24px/800, the stat-number style). */
  compact?: boolean;
  onShowRegistry: (states: ProcessedState[]) => void;
}) {
  const { action } = stop;
  const titleClass = cn('text-left', action && STRETCH);
  const headingClass = 'min-w-0 text-pretty text-[14px] font-bold leading-snug text-foreground';
  const title = stop.title;
  // The name a screen reader hears: the title, then what the link does. Kept in
  // aria-label so the visible text is only the title.
  const readAs = action ? `${title}: ${action.label.charAt(0).toLowerCase()}${action.label.slice(1)}` : title;
  const titleNode = !action ? (
    title
  ) : action.kind === 'link' ? (
    <Link to={action.href} className={titleClass} aria-label={readAs}>
      {title}
    </Link>
  ) : (
    <button type="button" onClick={() => onShowRegistry(action.states)} className={titleClass} aria-label={readAs}>
      {title}
    </button>
  );

  return (
    <div
      className={cn(
        'relative flex h-full min-w-0 flex-col rounded-2xl bg-muted p-4',
        action &&
          'transition-[transform,box-shadow] duration-150 hover:-translate-y-px hover:shadow-md active:scale-[0.99] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0',
      )}
    >
      <div className="flex items-start justify-between gap-3 lg:flex-col lg:justify-start lg:gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {stop.step !== null ? (
            <span
              className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold tabular-nums', stop.look.pill)}
              aria-hidden
            >
              {stop.step}
            </span>
          ) : (
            <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', stop.look.bar)} aria-hidden />
          )}
          {stop.track === 'main' ? (
            <h3 className={headingClass}>{titleNode}</h3>
          ) : (
            <h4 className={headingClass}>{titleNode}</h4>
          )}
        </div>
        <p className="shrink-0 whitespace-nowrap text-right lg:text-left">
          {stop.count === null ? (
            <>
              <span className="text-2xl font-extrabold leading-none text-foreground" data-unknown>
                ?
              </span>
              <span className="ml-1.5 text-[13px] text-warm-secondary">not sent yet</span>
            </>
          ) : (
            <>
              <AnimatedNumber value={stop.count} animate={animate} className="text-2xl font-extrabold leading-none text-foreground" />
              <span className="ml-1.5 text-[13px] text-warm-secondary">{unitWord(stop.unit, stop.count)}</span>
            </>
          )}
        </p>
      </div>
      <p className="mt-2 text-pretty text-[13px] leading-[1.5] text-warm-secondary">{stop.meaning}</p>
      {stop.facts.length > 0 ? (
        <ul className="mt-2 space-y-0.5">
          {stop.facts.map((f) => (
            <li key={f} className="text-[13px] tabular-nums text-warm-prose">
              {f}
            </li>
          ))}
        </ul>
      ) : null}
      {stop.sideBySide ? <SideBySide items={stop.sideBySide} /> : null}
      {stop.figures ? <Figures figures={stop.figures} /> : null}
      {stop.trust ? <TrustBox trust={stop.trust} /> : null}
      {stop.bands ? <BandBars bands={stop.bands} tone={stop.look.bar} /> : null}
      {action ? (
        <span aria-hidden className="mt-auto flex items-center gap-1 pt-3 text-[13px] font-semibold text-warm-secondary">
          {action.kind === 'link' ? 'Open page' : 'Show in the list'}
          <ArrowRight className="h-4 w-4" />
        </span>
      ) : null}
    </div>
  );
}
