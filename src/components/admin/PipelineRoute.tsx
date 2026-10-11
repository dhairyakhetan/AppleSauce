import { RefreshCw } from 'lucide-react';
import { BentoPanel } from '@/components/layout/PageContainer';
import { AdminPanelHeader } from '@/pages/admin/AdminTable';
import { AdminEmpty, AdminError, AdminLoading } from '@/components/admin/AdminState';
import { AdminPillButton } from '@/components/admin/AdminPillButton';
import { AnimatedNumber, Elbow, Lane, LiveDot, StopCard, UpdatedAgo } from '@/components/admin/PipelineRouteParts';
import { usePipelineRoute, type PipelineRouteState } from '@/hooks/usePipelineRoute';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';
import type { ProcessedState } from '@/lib/paper-registry';
import {
  buildMainStops,
  buildSideStops,
  buildSiding,
  fmt,
  laneMotion,
  maxFlow,
  questionsProgress,
  type PipelineRoute as Route,
  type PipelineRouteApi,
  type RouteStop,
  type StopId,
} from '@/lib/pipeline-route';
import { cn } from '@/lib/utils';

/* The papers route: the hero of /admin/pipeline.

   Owner, 11 October 2026: "a fresh pipeline picture ... like a route, like a
   logistics route with flowcharts and animations ... completely continuously
   updated."

   Ten stops joined by lanes, top to bottom on a phone, two rows of five from
   lg. A siding for the Maths hold hangs off the first stop and never joins the
   counts. Three smaller piles hang off the admin stop. The whole thing is also
   a real ordered list with the numbers as text; the lanes, parcels and the
   number count are aria-hidden decoration.

   PipelineRouteView is pure (props in, markup out) so it is tested by
   rendering it; PipelineRoute connects it to the 20-second refresh. */

const PANEL = 'px-1.5 py-[18px] lg:px-1.5 lg:py-[18px]';

/** Where each stop sits from lg: row 1 the siding, rows 2 and 3 the route, row 4 the piles beside the admin. */
const PLACE: Partial<Record<StopId, string>> = {
  leftOut: 'lg:col-start-1 lg:row-start-1',
  folder: 'lg:col-start-1 lg:row-start-2',
  waiting: 'lg:col-start-2 lg:row-start-2',
  read: 'lg:col-start-3 lg:row-start-2',
  swarm: 'lg:col-start-4 lg:row-start-2',
  desk: 'lg:col-start-5 lg:row-start-2',
  ai: 'lg:col-start-1 lg:row-start-3',
  students: 'lg:col-start-2 lg:row-start-3',
  admin: 'lg:col-start-3 lg:row-start-3',
  approval: 'lg:col-start-4 lg:row-start-3',
  live: 'lg:col-start-5 lg:row-start-3',
};

export interface PipelineRouteViewProps {
  route: Route | null;
  status: PipelineRouteState['status'];
  refreshFailed: boolean;
  refreshing?: boolean;
  updatedAt: number | null;
  /** Fixed "now" for tests; the live page ticks on its own. */
  now?: number;
  reducedMotion: boolean;
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
  animate,
  onShowRegistry,
}: {
  route: Route;
  animate: boolean;
  onShowRegistry: (states: ProcessedState[]) => void;
}) {
  const main = buildMainStops(route);
  const siding = buildSiding(route);
  const side = buildSideStops(route);
  const max = maxFlow(main);
  const aiIndex = main.findIndex((s) => s.id === 'ai');

  const item = (s: RouteStop, i: number) => (
    <li
      key={s.id}
      data-stop={s.id}
      data-count={s.count}
      className={cn('relative min-w-0', PLACE[s.id])}
    >
      {i > 0 ? (
        <Lane count={s.count} max={max} look={s.look} animate={animate} className={i === aiIndex ? 'lg:hidden' : undefined} />
      ) : null}
      {i === aiIndex ? <Elbow animate={animate} seconds={laneMotion(s.count, max).seconds} /> : null}
      <StopCard stop={s} animate={animate} onShowRegistry={onShowRegistry} />
    </li>
  );

  return (
    <ol
      aria-label="The papers route, from the folder to live"
      className="flex list-none flex-col px-[18px] lg:grid lg:grid-cols-5 lg:gap-x-9 lg:gap-y-12"
    >
      {item(main[0], 0)}
      <li
        key="leftOut"
        data-stop="leftOut"
        data-count={siding.count}
        className={cn('relative min-w-0', PLACE.leftOut)}
      >
        <div className="ml-6 mt-3 border-l-2 border-dashed border-warm-hairline-strong pl-4 lg:ml-0 lg:mt-0 lg:border-l-0 lg:pl-0">
          <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-warm-label">Side track</p>
          <StopCard stop={siding} animate={animate} compact onShowRegistry={onShowRegistry} />
        </div>
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-full hidden h-12 -translate-x-1/2 border-l-2 border-dashed border-warm-hairline-strong lg:block"
        />
      </li>
      {main.slice(1).map((s, i) => (
        <MainWithSide key={s.id} index={i + 1} stop={s} side={side} animate={animate} item={item} />
      ))}
    </ol>
  );
}

/** A main stop, followed by the three side piles when it is the admin stop. */
function MainWithSide({
  index,
  stop,
  side,
  animate,
  item,
}: {
  index: number;
  stop: RouteStop;
  side: RouteStop[];
  animate: boolean;
  item: (s: RouteStop, i: number) => JSX.Element;
}) {
  return (
    <>
      {item(stop, index)}
      {stop.id === 'admin' ? (
        <li
          key="side"
          data-stop="side-piles"
          className="relative min-w-0 lg:col-span-3 lg:col-start-2 lg:row-start-4"
        >
          <svg
            aria-hidden
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="pointer-events-none absolute bottom-full left-0 hidden h-12 w-full lg:block"
          >
            <path
              d="M50 0 V50 M16.67 50 H83.33 M16.67 50 V100 M50 50 V100 M83.33 50 V100"
              fill="none"
              strokeWidth="2"
              strokeDasharray="6 6"
              vectorEffect="non-scaling-stroke"
              className="stroke-warm-hairline-strong"
            />
          </svg>
          <div className="ml-6 mt-3 border-l-2 border-dashed border-warm-hairline-strong pl-4 lg:ml-0 lg:mt-0 lg:border-l-0 lg:pl-0">
            <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-warm-label lg:sr-only">
              Also open, not with students or the admin yet
            </p>
            <ul className="grid list-none gap-3 lg:grid-cols-3 lg:gap-9">
              {side.map((s) => (
                <li key={s.id} data-stop={s.id} data-count={s.count} className="min-w-0">
                  <StopCard stop={s} animate={animate} compact onShowRegistry={() => {}} />
                </li>
              ))}
            </ul>
          </div>
        </li>
      ) : null}
    </>
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
  onRetry,
  onRefresh,
  onShowRegistry,
}: PipelineRouteViewProps) {
  const animate = !reducedMotion;
  const empty = !!route && route.registry.total === 0 && route.desk.papers === 0;
  return (
    <BentoPanel fill="card" className={PANEL} id="pipeline-route" data-reduced-motion={reducedMotion ? 'true' : 'false'}>
      <AdminPanelHeader
        title="The papers route"
        subtitle="Where every paper is right now, from the folder to the live site. These numbers update by themselves."
        meta={
          <span className="inline-flex items-center gap-2">
            <LiveDot failed={refreshFailed} animate={animate} />
            <UpdatedAgo updatedAt={updatedAt} now={now} />
          </span>
        }
        action={
          route ? (
            <AdminPillButton variant="quiet" size="sm" onClick={onRefresh} busy={refreshing} aria-label="Refresh the numbers now">
              <RefreshCw className={cn('h-4 w-4', refreshing && animate && 'animate-spin')} aria-hidden />
              Refresh
            </AdminPillButton>
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
          <RouteList route={route} animate={animate} onShowRegistry={onShowRegistry} />
          <ProgressStrip route={route} animate={animate} />
          <p className="mt-4 px-[18px] text-[13px] leading-[1.5] text-warm-meta">
            The stops are counted from different lists, so do not add them up. The desk, the swarm and the checkers all count papers already on the desk. Left out papers are never in these counts.
          </p>
        </>
      )}
    </BentoPanel>
  );
}

/** The route, connected to the refresh loop: reads now, then every 20 seconds while the tab is visible. */
export function PipelineRoute({
  api,
  onShowRegistry,
}: {
  api: PipelineRouteApi;
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
      onRetry={state.refresh}
      onRefresh={state.refresh}
      onShowRegistry={onShowRegistry}
    />
  );
}
