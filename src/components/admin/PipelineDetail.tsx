import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow, format } from 'date-fns';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { AdminTable, AdminPanelHeader, AdminStatusPill, type AdminTableColumn, type AdminTableRow } from '@/pages/admin/AdminTable';
import { AdminEmpty, AdminError, AdminLoading, type AdminLoadingShape } from '@/components/admin/AdminState';
import { adminPillClass } from '@/components/admin/AdminPillButton';
import { BentoPanel, BentoStack } from '@/components/layout/PageContainer';
import { PaperRegistryPanel } from '@/components/admin/PaperRegistryPanel';
import {
  paperState,
  pct,
  seriesMax,
  seriesTotal,
  type DailyPoint,
  type FeedRow,
  type PipelineStats,
} from '@/lib/pipeline-stats';
import type { Audience } from '@/lib/pipeline-route';
import type { PaperRegistryApi, ProcessedState } from '@/lib/paper-registry';
import { feedActionWords, feedActorWords } from '@/lib/activity-format';
import { relativeWords, timeWords } from '@/lib/history-labels';
import { cn } from '@/lib/utils';

/* The folded detail under the papers route, shared by /admin (System tab) and
   /hod/pipeline (owner, 12 October 2026: "HODs may see the whole Admin pipeline
   page"). Same panels, same words; the audience decides three things only:

   - the data source: admins read through admin_pipeline_stats() and
     admin_paper_registry*(), HODs through hod_pipeline_stats() and
     hod_registry*() (migration 20261012600000);
   - links: a paper links to the admin Library for an admin and to nothing for
     an HOD (an HOD cannot open the Library page);
   - the Activity panel is admin-only. admin_activity_feed() returns account ids
     and free text, so it is not opened to HODs and the panel is not drawn. */

type Tone = 'alert' | 'plain' | 'good';

const TONE: Record<Tone, { box: string; label: string; value: string; sub: string }> = {
  plain: { box: 'bg-muted', label: 'text-warm-label', value: 'text-foreground', sub: 'text-warm-meta' },
  alert: { box: 'bg-rose-100', label: 'text-rose-900', value: 'text-rose-950', sub: 'text-rose-900' },
  good: { box: 'bg-mint', label: 'text-[#24603D]', value: 'text-[#24603D]', sub: 'text-[#24603D]' },
};

function Tile({
  label,
  value,
  sub,
  tone = 'plain',
  to,
  onClick,
  state = 'ok',
}: {
  label: string;
  value?: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  /** Makes the tile a link to the list behind the number. */
  to?: string;
  /** Makes the tile a button (scrolls or filters in this page). Its body is spans only: a button cannot hold a div or a p. */
  onClick?: () => void;
  /** 'unknown' shows "?": a number that did not load is never shown as 0. */
  state?: 'ok' | 'loading' | 'unknown';
}) {
  const t = TONE[tone];
  const body = (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className={cn('block text-[12px] font-semibold uppercase tracking-wide', t.label)}>{label}</span>
        {to || onClick ? <ArrowRight className={cn('mt-0.5 h-4 w-4 shrink-0', t.label)} aria-hidden /> : null}
      </span>
      {state === 'loading' ? (
        <span className="mt-2 block h-7 w-16 animate-pulse rounded-lg bg-card/60 motion-reduce:animate-none" role="status" aria-label={`Loading ${label}`} />
      ) : (
        <span className={cn('mt-1 block text-3xl font-extrabold tabular-nums', t.value)}>{state === 'unknown' ? '?' : value}</span>
      )}
      {sub ? <span className={cn('mt-0.5 block text-[13px]', t.sub)}>{state === 'unknown' ? 'Did not load' : sub}</span> : null}
    </>
  );
  const box = cn('block min-h-[78px] w-full min-w-0 rounded-2xl px-4 py-3 text-left', t.box);
  const interactive = cn(
    box,
    'transition-[filter,transform] duration-150 hover:brightness-95 active:scale-[0.985] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  );
  if (to) {
    return (
      <Link to={to} className={interactive}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={interactive}>
        {body}
      </button>
    );
  }
  return <div className={box}>{body}</div>;
}

const BAR_PARTS = [
  { key: 'verified', label: 'Verified', dot: 'bg-emerald-500' },
  { key: 'needs_review', label: 'Needs review', dot: 'bg-amber-400' },
  { key: 'hidden', label: 'Hidden', dot: 'bg-slate-300' },
] as const;

/** One horizontal stacked bar: verified / needs review / hidden. Colour is not the only key: see StackLegend. */
function StackBar({ parts }: { parts: { value: number; className: string; label: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="img"
      aria-label={parts.map((p) => `${p.label} ${p.value}`).join(', ')}>
      {parts.map((p) => (
        <div key={p.label} className={p.className} style={{ width: `${(p.value / total) * 100}%` }} />
      ))}
    </div>
  );
}

/** Dot, label and count for each segment, drawn once beside the bars so the colours are named in text. */
function StackLegend({ counts }: { counts: { verified: number; needs_review: number; hidden: number } }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="What the bar colours mean">
      {BAR_PARTS.map((p) => (
        <li key={p.key} className="flex items-center gap-1.5 text-[12px] text-warm-secondary">
          <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', p.dot)} aria-hidden />
          <span className="font-semibold text-foreground">{p.label}</span>
          <span className="tabular-nums">{counts[p.key].toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}

/** 30 small bars for one daily series, drawn as plain SVG (no chart library). */
export function DayBars({ points, field, label, barClass }: {
  points: DailyPoint[];
  field: 'papers_added' | 'desk_papers' | 'questions_cleared';
  label: string;
  barClass: string;
}) {
  const max = seriesMax(points, field);
  const w = 300;
  const h = 72;
  const gap = 2;
  const bw = points.length ? (w - gap * (points.length - 1)) / points.length : w;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <p className="text-[13px] font-semibold text-foreground">{label}</p>
        <p className="text-[13px] tabular-nums text-warm-meta">{seriesTotal(points, field)} in 30 days</p>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-[72px] w-full" role="img" aria-label={`${label}, last 30 days`}>
        {points.map((p, i) => {
          const v = Number(p[field]) || 0;
          const bh = v ? Math.max(2, (v / max) * (h - 4)) : 0;
          return (
            <rect key={p.day} x={i * (bw + gap)} y={h - bh} width={bw} height={bh} rx={1.5} className={barClass}>
              <title>{`${format(new Date(p.day), 'd MMM')}: ${v}`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-[12px] text-warm-label">
        <span>{points[0] ? format(new Date(points[0].day), 'd MMM') : ''}</span>
        <span>{points.length ? format(new Date(points[points.length - 1].day), 'd MMM') : ''}</span>
      </div>
    </div>
  );
}

export type StatsStatus = 'loading' | 'ok' | 'error';

/* Same outer padding as the route panel above (see PipelineRoute.tsx), so the
   library panels line up with it and with the desk. */
const PANEL = 'px-0.5 py-5 lg:px-3.5 lg:py-8';

/** A panel fed by the stats read: its own skeleton while that loads, its own error with Try again if it fails. */
export function StatsPanel({
  title,
  subtitle,
  meta,
  status,
  what,
  onRetry,
  shape = 'tiles',
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  meta?: ReactNode;
  status: StatsStatus;
  what: string;
  onRetry: () => void;
  shape?: AdminLoadingShape;
  children: ReactNode;
}) {
  return (
    <BentoPanel fill="card" className={PANEL}>
      <AdminPanelHeader title={title} subtitle={subtitle} meta={status === 'ok' ? meta : undefined} />
      {status === 'ok' ? (
        children
      ) : status === 'loading' ? (
        <div className="px-[18px]">
          <AdminLoading shape={shape} rows={shape === 'tiles' ? 4 : 3} label={`Loading ${what}`} />
        </div>
      ) : (
        <div className="px-[18px]">
          <AdminError what={what} onRetry={onRetry} />
        </div>
      )}
    </BentoPanel>
  );
}

export function PipelineDetailFold({
  audience,
  stats,
  status,
  onRetry,
  feed = [],
  feedFailed = false,
  registryApi,
  focus,
  open,
  onOpenChange,
}: {
  audience: Audience;
  stats: PipelineStats | null;
  status: StatsStatus;
  onRetry: () => void;
  /** The activity rows. Only drawn for admins; the HOD page never passes them. */
  feed?: FeedRow[];
  feedFailed?: boolean;
  registryApi: PaperRegistryApi;
  focus: { states: ProcessedState[]; nonce: number } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const isAdminView = audience === 'admin';
  const lib = stats?.library;
  const mathsLive = lib ? lib.maths_verified + lib.maths_needs_review : 0;

  const recentColumns: AdminTableColumn[] = [
    { key: 'paper', label: 'Paper', width: '2fr' },
    { key: 'school', label: 'School', width: '1.6fr' },
    { key: 'qs', label: 'Questions', width: '0.8fr' },
    { key: 'added', label: 'Added', width: '1fr' },
    { key: 'state', label: 'State', width: '1fr' },
  ];
  const recentRows: AdminTableRow[] = (stats?.recent_papers ?? []).map((p) => {
    const state = paperState(p);
    return {
      id: p.id,
      href: isAdminView ? `/admin/library/${encodeURIComponent(p.id)}` : undefined,
      cells: [
        <span key="p">{`${p.board ?? ''} ${p.cls} ${p.subject}`.trim()}{p.year ? `, ${p.year}` : ''}</span>,
        p.school || 'School not recorded',
        String(p.questions ?? 0),
        <span key="a" className="font-normal text-warm-meta" title={relativeWords(p.created_at)}>{timeWords(p.created_at)}</span>,
        <AdminStatusPill key="s" status={state === 'Verified' ? 'live' : state === 'Hidden' ? 'hidden' : 'paused'} label={state} />,
      ],
    };
  });

  const feedColumns: AdminTableColumn[] = [
    { key: 'when', label: 'When', width: '1fr' },
    { key: 'who', label: 'Who', width: '1.2fr' },
    { key: 'what', label: 'What', width: '1.4fr', wrap: true },
    { key: 'detail', label: 'Detail', width: '2fr', wrap: true },
  ];
  const feedRows: AdminTableRow[] = isAdminView
    ? feed.map((r) => ({
        id: `${r.stream}:${r.event_id}`,
        cells: [
          <span key="w" className="font-normal text-warm-meta" title={relativeWords(r.at)}>{timeWords(r.at)}</span>,
          feedActorWords(r.actor_label, r.actor_kind),
          <span key="a" className="font-bold text-foreground">{feedActionWords(r.action)}</span>,
          r.detail || '',
        ],
      }))
    : [];

  return (
    <details
      open={open}
      onToggle={(e) => onOpenChange(e.currentTarget.open)}
      className="group mt-3"
      data-testid="pipeline-detail-fold"
    >
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-bento bg-card px-[18px] py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <h3 className="block text-[14px] font-bold text-foreground">The paper list and the library numbers</h3>
          <span className="block text-[13px] text-warm-secondary">
            {isAdminView
              ? "Admins only. The desk's list of every paper (longer than the PDFs saved on the main computer), then the library, the newest papers and the activity."
              : "The desk's list of every paper (longer than the PDFs saved on the main computer), then the library and the newest papers."}
          </span>
        </span>
        <ChevronDown className="h-5 w-5 shrink-0 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>

      <BentoStack className="mt-3 bg-muted">
        <PaperRegistryPanel api={registryApi} focus={focus} audience={audience} />

        <StatsPanel
          title="Papers library"
          subtitle="Papers published on the website. This counts library papers, so it differs from the PDF count on the route."
          meta={stats ? `updated ${formatDistanceToNow(new Date(stats.generated_at), { addSuffix: true })}` : undefined}
          status={status}
          what="the library numbers"
          onRetry={onRetry}
        >
          {lib ? (
            <>
              <div className="grid grid-cols-2 gap-3 px-[18px] md:grid-cols-4">
                <Tile label="Live papers" value={lib.published.toLocaleString()} sub={`${lib.questions.toLocaleString()} questions`} />
                <Tile label="Verified" value={lib.verified.toLocaleString()} sub={`${pct(lib.verified, lib.published)}% of live`} />
                <Tile label="Needs review" value={lib.needs_review.toLocaleString()} sub="live, not fully checked" />
                <Tile label="Hidden" value={lib.hidden.toLocaleString()} sub="not published" />
              </div>
              <div className="mt-4 px-[18px]">
                <div className="mb-1.5 flex items-baseline justify-between">
                  <p className="text-[13px] font-semibold text-foreground">Maths</p>
                  <p className="text-[13px] tabular-nums text-warm-meta">
                    {mathsLive} of {lib.maths_papers} live, {lib.maths_verified} verified
                  </p>
                </div>
                <StackBar parts={[
                  { value: lib.maths_verified, className: 'bg-emerald-500', label: 'Verified' },
                  { value: lib.maths_needs_review, className: 'bg-amber-400', label: 'Needs review' },
                  { value: lib.maths_hidden, className: 'bg-slate-300', label: 'Hidden' },
                ]} />
                <div className="mt-2">
                  <StackLegend counts={{ verified: lib.maths_verified, needs_review: lib.maths_needs_review, hidden: lib.maths_hidden }} />
                </div>
              </div>
            </>
          ) : null}
        </StatsPanel>

        <StatsPanel
          title="Newest papers"
          subtitle={isAdminView ? 'The latest papers added to the library. Open one to edit it.' : 'The latest papers added to the library.'}
          meta={stats ? `last ${stats.recent_papers.length}` : undefined}
          status={status}
          what="the newest papers"
          onRetry={onRetry}
          shape="table"
        >
          {recentRows.length ? (
            <>
              <AdminTable columns={recentColumns} rows={recentRows} readOnly />
              {isAdminView ? (
                <div className="mt-3 px-[18px]">
                  <Link to="/admin/library" className={adminPillClass('quiet', 'sm', 'px-3')}>
                    Open the Library
                  </Link>
                </div>
              ) : null}
            </>
          ) : (
            <AdminEmpty title="No papers in the library yet" />
          )}
        </StatsPanel>

        {isAdminView ? (
          <StatsPanel
            title="Activity"
            subtitle="The latest things the desk, the AI and people did."
            meta={stats ? `most recent ${feed.length}` : undefined}
            status={status === 'ok' && feedFailed ? 'error' : status}
            what="the activity"
            onRetry={onRetry}
            shape="table"
          >
            {feedRows.length ? (
              <>
                <AdminTable columns={feedColumns} rows={feedRows} readOnly />
                <div className="mt-3 px-[18px]">
                  <Link to="/admin/activity" className={adminPillClass('quiet', 'sm', 'px-3')}>
                    Open the full activity
                  </Link>
                </div>
              </>
            ) : (
              <AdminEmpty title="No activity recorded yet" hint="Checks, edits and pipeline steps will appear here as they happen." />
            )}
          </StatsPanel>
        ) : null}

        <StatsPanel
          title="Trends and subjects"
          subtitle="The 30-day charts and the library broken down by subject."
          meta={stats ? `3 charts, ${stats.by_subject.length} subjects` : undefined}
          status={status}
          what="the trends"
          onRetry={onRetry}
        >
          {stats ? (
            <details className="group px-[18px]">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-full bg-muted px-5 text-[13px] font-bold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                Show the charts and the subject bars
                <ChevronDown className="h-4 w-4 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
              </summary>
              <div className="mt-5 grid gap-6 md:grid-cols-3">
                <DayBars points={stats.daily} field="desk_papers" label="Papers loaded to the desk" barClass="fill-brand-blue" />
                <DayBars points={stats.daily} field="questions_cleared" label="Questions cleared" barClass="fill-emerald-500" />
                <DayBars points={stats.daily} field="papers_added" label="Papers added to the library" barClass="fill-amber-400" />
              </div>
              <h3 className="mb-2 mt-6 text-[14px] font-bold text-foreground">By subject</h3>
              <div className="mb-3">
                <StackLegend
                  counts={{
                    verified: stats.by_subject.reduce((n, s) => n + s.verified, 0),
                    needs_review: stats.by_subject.reduce((n, s) => n + s.needs_review, 0),
                    hidden: stats.by_subject.reduce((n, s) => n + s.hidden, 0),
                  }}
                />
              </div>
              <ul className="space-y-3">
                {stats.by_subject.map((s) => (
                  <li key={s.subject}>
                    <div className="mb-1 flex items-baseline justify-between gap-3">
                      <span className="text-[13px] font-semibold text-foreground">{s.subject}</span>
                      <span className="text-[13px] tabular-nums text-warm-meta">
                        {s.published} live, {s.verified} verified{s.hidden ? `, ${s.hidden} hidden` : ''}
                      </span>
                    </div>
                    <StackBar parts={[
                      { value: s.verified, className: 'bg-emerald-500', label: 'Verified' },
                      { value: s.needs_review, className: 'bg-amber-400', label: 'Needs review' },
                      { value: s.hidden, className: 'bg-slate-300', label: 'Hidden' },
                    ]} />
                  </li>
                ))}
              </ul>
              <p className="mt-4 pb-1 text-[13px] text-warm-label">
                Boards: {Object.entries(stats.by_board).map(([b, n]) => `${b} ${n}`).join(', ')}
              </p>
            </details>
          ) : null}
        </StatsPanel>
      </BentoStack>
    </details>
  );
}
