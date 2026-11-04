import { RefreshCw } from 'lucide-react';
import { BentoPanel } from '@/components/layout/PageContainer';
import { AdminPanelHeader } from '@/pages/admin/AdminTable';
import { AdminEmpty, AdminError, AdminLoading } from '@/components/admin/AdminState';
import { AnimatedNumber, Elbow, Lane, LiveDot, StopCard, UpdatedAgo } from '@/components/admin/PipelineRouteParts';
import { usePipelineRoute, type PipelineRouteState } from '@/hooks/usePipelineRoute';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import type { ProcessedState } from '@/lib/paper-registry';
import {
  buildMainStops,
  buildSideStops,
  buildSiding,
  COMPUTER_LABEL,
  dataAsOf,
  fmt,
  laneMotion,
  maxFlow,
  questionsProgress,
  type Audience,
  type PipelineRoute as Route,
  type PipelineRouteApi,
  type RouteStop,
  type StopId,
} from '@/lib/pipeline-route';
import { cn } from '@/lib/utils';

/* The papers route: the hero of the pipeline overview, for admins (the System
   tab of /admin) and HODs (/hod/pipeline).

   Owner, 11 October 2026: "a fresh pipeline picture ... like a route, like a
   logistics route with flowcharts and animations ... completely continuously
   updated." Owner, 12 October: "one pipeline overview page ... how many PDFs are
   there in total right now on my computer, and label my computer as Kanishk's
   computer."

   Seven stops joined by lanes, top to bottom on a phone, rows of four and three
   from lg. A siding for the kept-back earlier-library papers hangs above the first
   stop and never joins the counts. Three smaller piles sit under the route.
   The whole thing is also a real ordered list with the numbers as text; the
   lanes, parcels and the number count are aria-hidden decoration.

   Two times are shown and never mixed up: "This screen read the numbers 12 seconds
   ago" is when this browser read the page, "The desk last sent numbers ..." is when
   the desk last sent numbers.

   PipelineRouteView is pure (props in, markup out) so it is tested by
   rendering it; PipelineRoute connects it to the 20-second refresh. */

/* The same outer padding as every other BentoPanel (20px, 32px from lg), so the
   route's content edge lines up with the desk panels and the page header. The
   2px and 14px here are what the 18px inset of AdminPanelHeader and the route
   rows add back: 2 + 18 = 20, and 14 + 18 = 32 from lg. */
const PANEL = 'px-0.5 py-5 lg:px-3.5 lg:py-8';

/* The in-screen text action (Refresh). The same words as the "Show in the list"
   and "Open page" links on the stop cards: 40px tall, 13px semibold, warm grey. */
const TEXT_ACTION =
  'inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-warm-secondary transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60';

/** Where each stop sits from lg: row 1 the siding, rows 2 and 3 the route. */
const PLACE: Partial<Record<StopId, string>> = {
  leftOut: 'lg:col-start-1 lg:row-start-1',
  computer: 'lg:col-start-1 lg:row-start-2',
  read: 'lg:col-start-2 lg:row-start-2',
  pictures: 'lg:col-start-3 lg:row-start-2',
  students: 'lg:col-start-4 lg:row-start-2',
  needsYou: 'lg:col-start-1 lg:row-start-3',
  ready: 'lg:col-start-2 lg:row-start-3',
  live: 'lg:col-start-3 lg:row-start-3',
};

export interface PipelineRouteViewProps {
  route: Route | null;
  status: PipelineRouteState['status'];
  refreshFailed: boolean;
  refreshing?: boolean;
  /** When this browser last read the numbers (ms since 1970). */
  updatedAt: number | null;
  /** Fixed "now" for tests; the live page ticks on its own. */
  now?: number;
  reducedMotion: boolean;
  /** Admins see every link; HODs only the ones they can open. Defaults to admin. */
  audience?: Audience;
  onRetry: () => void;
  onRefresh: () => void;
  onShowRegistry: (states: ProcessedState[]) => void;
}

function ProgressStrip({ route, animate }: { route: Route; animate: boolean }) {
  const p = questionsProgress(route);
  return (
    <section aria-label="Questions cleared" className="mx-[18px] mt-6 rounded-2xl bg-muted p-4" data-progress>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[14px] font-bold text-foreground">
          Questions:{' '}
          <AnimatedNumber value={p.cleared} animate={animate} /> of <span className="tabular-nums">{fmt(p.total)}</span> cleared
        </p>
        <p className="text-[13px] tabular-nums text-warm-secondary">{p.percent}% done</p>
      </div>
      <div
        role="progressbar"
        aria-label="Questions cleared"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={p.percent}
        className="mt-2 h-2.5 overflow-hidden rounded-full bg-card"
      >
        <div
          className="h-full origin-left rounded-full bg-emerald-500 transition-transform duration-500 motion-reduce:transition-none"
          style={{ transform: `scaleX(${p.percent / 100})` }}
        />
      </div>
    </section>
  );
}

function RouteList({
  route,
  audience,
  animate,
  onShowRegistry,
}: {
  route: Route;
  audience: Audience;
  animate: boolean;
  onShowRegistry: (states: ProcessedState[]) => void;
}) {
  const main = buildMainStops(route, audience);
  const siding = buildSiding(route);
  const max = maxFlow(main);
  // The route wraps here from lg: the end of row 1 joins the start of row 2.
  const wrapIndex = main.findIndex((s) => s.id === 'needsYou');

  const item = (s: RouteStop, i: number) => (
    <li key={s.id} data-stop={s.id} data-count={s.count ?? ''} className={cn('relative min-w-0', PLACE[s.id])}>
      {i > 0 ? (
        <Lane count={s.count ?? 0} max={max} look={s.look} animate={animate} className={i === wrapIndex ? 'lg:hidden' : undefined} />
      ) : null}
      {i === wrapIndex ? <Elbow animate={animate} seconds={laneMotion(s.count ?? 0, max).seconds} /> : null}
      <StopCard stop={s} animate={animate} onShowRegistry={onShowRegistry} />
    </li>
  );

  return (
    <ol
      aria-label={`The papers route, from the PDFs saved on ${COMPUTER_LABEL} to live`}
      className="flex list-none flex-col px-[18px] lg:grid lg:grid-cols-4 lg:gap-x-9 lg:gap-y-12"
    >
      {item(main[0], 0)}
      <li key="leftOut" data-stop="leftOut" data-count={siding.count ?? ''} className={cn('relative min-w-0', PLACE.leftOut)}>
        <div className="ml-6 mt-3 border-l-2 border-dashed border-warm-hairline-strong pl-4 lg:ml-0 lg:mt-0 lg:border-l-0 lg:pl-0">
          <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-warm-label">Set aside</p>
          <StopCard stop={siding} animate={animate} compact onShowRegistry={onShowRegistry} />
        </div>
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-full hidden h-12 -translate-x-1/2 border-l-2 border-dashed border-warm-hairline-strong lg:block"
        />
      </li>
      {main.slice(1).map((s, i) => item(s, i + 1))}
    </ol>
  );
}

/** Questions that cannot go to students or a person yet. Beneath the route, not on it. */
function SidePiles({ route, animate }: { route: Route; animate: boolean }) {
  const side = buildSideStops(route);
  return (
    <section data-stop="side-piles" aria-label="Also open, not with students or a person yet" className="mx-[18px] mt-6">
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-warm-label">Also open, not with students or a person yet</p>
      <ul className="grid list-none gap-3 sm:grid-cols-3">
        {side.map((s) => (
          <li key={s.id} data-stop={s.id} data-count={s.count ?? ''} className="min-w-0">
            <StopCard stop={s} animate={animate} compact onShowRegistry={() => {}} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "Data as of 8 Oct, 11:24 pm (4 days ago)": when the desk last sent numbers. Turns amber when that was too long ago. */
function DataAsOfLine({ route, nowMs }: { route: Route; nowMs: number }) {
  const d = dataAsOf(route, nowMs);
  if (!d.at) {
    return (
      <p className="mx-[18px] mb-3 rounded-xl bg-amber-100 px-3 py-2 text-[13px] text-amber-950" data-data-as-of="never">
        The desk has not sent any numbers yet, so none of these are real.
      </p>
    );
  }
  return (
    <p
      className={cn('mx-[18px] mb-3 rounded-xl px-3 py-2 text-[13px]', d.stale ? 'bg-amber-100 text-amber-950' : 'bg-muted text-warm-secondary')}
      data-data-as-of={d.stale ? 'stale' : 'fresh'}
    >
      <span className="font-bold">The desk last sent numbers {d.ago}</span> ({d.when}).
      {d.stale ? ' The desk has not sent new numbers for a while, so some of these may be out of date.' : ''}
    </p>
  );
}

export function PipelineRouteView({
  route,
  status,
  refreshFailed,
  refreshing = false,
  updatedAt,
  now,
  reducedMotion,
  audience = 'admin',
  onRetry,
  onRefresh,
  onShowRegistry,
}: PipelineRouteViewProps) {
  const animate = !reducedMotion;
  const empty = !!route && route.registry.total === 0 && route.desk.papers === 0 && !route.drive;
  return (
    <BentoPanel fill="card" className={PANEL} id="pipeline-route" data-reduced-motion={reducedMotion ? 'true' : 'false'}>
      <AdminPanelHeader
        title="The papers route"
        subtitle={`Where every paper is right now, from the PDFs saved on ${COMPUTER_LABEL} to the live site. This page checks again by itself, but the numbers are only as new as the desk's last sync.`}
        meta={
          <span className="inline-flex items-center gap-2">
            <LiveDot failed={refreshFailed} animate={animate} />
            <UpdatedAgo updatedAt={updatedAt} now={now} />
          </span>
        }
        action={
          route ? (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              aria-busy={refreshing || undefined}
              aria-label="Refresh the numbers now"
              className={TEXT_ACTION}
            >
              <RefreshCw className={cn('h-4 w-4', refreshing && animate && 'animate-spin')} aria-hidden />
              Refresh
            </button>
          ) : undefined
        }
      />

      {refreshFailed ? (
        <p role="status" className="mx-[18px] mb-3 rounded-xl bg-muted px-3 py-2 text-[13px] text-warm-secondary" data-refresh-failed>
          Could not refresh, showing the last numbers. It will try again by itself.
        </p>
      ) : null}

      {status === 'loading' ? (
        <div className="px-[18px]">
          <AdminLoading shape="cards" rows={3} label="Loading the papers route" />
        </div>
      ) : status === 'error' || !route ? (
        <div className="px-[18px]">
          <AdminError what="the papers route" onRetry={onRetry} />
        </div>
      ) : empty ? (
        <AdminEmpty
          title="The pipeline has not sent any papers yet"
          hint="Papers will appear on the route as soon as the desk syncs the folder."
        />
      ) : (
        <>
          <DataAsOfLine route={route} nowMs={now ?? Date.now()} />
          <RouteList route={route} audience={audience} animate={animate} onShowRegistry={onShowRegistry} />
          <SidePiles route={route} animate={animate} />
          <ProgressStrip route={route} animate={animate} />
          <p className="mt-4 px-[18px] text-[13px] leading-[1.5] text-warm-meta">
            The stages are counted from different lists, so do not add them up. Papers from the earlier library are kept back and are only in the PDF count, never in the stages after it. A number shown as ? has not been sent by the desk yet.
          </p>
        </>
      )}
    </BentoPanel>
  );
}

/** The route, connected to the refresh loop: reads now, then every 20 seconds while the tab is visible. */
export function PipelineRoute({
  api,
  audience = 'admin',
  onShowRegistry,
}: {
  api: PipelineRouteApi;
  audience?: Audience;
  onShowRegistry: (states: ProcessedState[]) => void;
}) {
  const state = usePipelineRoute(api);
  const reducedMotion = usePrefersReducedMotion();
  return (
    <PipelineRouteView
      route={state.route}
      status={state.status}
      refreshFailed={state.refreshFailed}
      refreshing={state.refreshing}
      updatedAt={state.updatedAt}
      reducedMotion={reducedMotion}
      audience={audience}
      onRetry={state.refresh}
      onRefresh={state.refresh}
      onShowRegistry={onShowRegistry}
    />
  );
}
