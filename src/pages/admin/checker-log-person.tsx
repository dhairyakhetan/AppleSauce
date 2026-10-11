import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronDown } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useAdminGuard, AdminGuardErrorState } from '@/components/AdminConsole';
import { AdminHeader, AdminAuditNote, buildAdminNav } from '@/pages/admin/shell';
import { BentoPanel, BentoStack } from '@/components/layout/PageContainer';
import { AdminError, AdminLoading } from '@/components/admin/AdminState';
import { AdminFilterChips } from '@/components/admin/AdminFilterChips';
import { AdminPillButton, adminPillClass } from '@/components/admin/AdminPillButton';
import { useAdminSectionCounts } from '@/pages/admin/useAdminSectionCounts';
import { cn } from '@/lib/utils';
import { createLatestGuard } from '@/lib/latest-guard';
import { realCheckerLogApi } from '@/lib/checker-log-api';
import {
  COUNT_KEYS,
  COUNT_LABELS,
  ROLE_LABELS,
  addDays,
  dayRange,
  daySentence,
  dayWords,
  heatLevel,
  kolkataDay,
  otherActionWords,
  rangeSummary,
  totalOf,
  type CheckerDayLog,
  type CheckerLogApi,
  type CountKey,
  type LogDay,
  type LogEvent,
} from '@/lib/checker-log';
import { HistoryList } from '@/components/admin/approval/HistoryPanel';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { isDummyMode } from '@/lib/dummy-mode';

const DummyCheckerLogPerson = PREVIEW_TOOLS ? lazy(() => import('@/dummy/AdminCheckerLogPersonDummy')) : null;

/* /admin/checker-log/:actorKey: one checker's work, day by day, in words.
   A heat strip of the whole range on top (one square per Kolkata day, darker
   = busier), then one card per day with a sentence ("Tuesday 2 Oct: Rahul
   checked 34 questions on 3 papers, passed 28, fixed 4, set aside 2.") and a
   small bar chart, opening to every action as a history sentence with the
   paper it was on. */

const RANGES = [30, 90] as const;

const BAR_CLASS: Record<CountKey, string> = {
  passed: 'bg-emerald-500',
  fixed: 'bg-sky-500',
  set_aside: 'bg-rose-400',
  flagged: 'bg-amber-400',
  edited: 'bg-violet-400',
  approved: 'bg-teal-700',
  other: 'bg-slate-300',
};

const HEAT_CLASS = ['bg-muted', 'bg-emerald-100', 'bg-emerald-300', 'bg-emerald-500', 'bg-emerald-700'] as const;

function CountBars({ counts, events }: { counts: LogDay['counts']; events: LogDay['events'] }) {
  // "Other" names nothing, so it is not a bar. It is a muted line that says
  // what it mostly holds.
  const shown = COUNT_KEYS.filter((k) => k !== 'other' && counts[k] > 0);
  const max = Math.max(1, ...shown.map((k) => counts[k]));
  const mostly = counts.other > 0 ? otherActionWords(events) : null;
  return (
    <>
      {shown.length ? (
        <dl className="mt-3 grid gap-1.5" aria-label="Actions by kind">
          {shown.map((k) => (
            <div key={k} className="grid grid-cols-[84px_minmax(0,1fr)_36px] items-center gap-2">
              <dt className="text-[12px] font-semibold text-warm-secondary">{COUNT_LABELS[k]}</dt>
              <div className="h-2.5 overflow-hidden rounded-full bg-card" aria-hidden>
                <div className={cn('h-full rounded-full', BAR_CLASS[k])} style={{ width: `${(counts[k] / max) * 100}%` }} />
              </div>
              <dd className="text-right text-[12px] font-bold tabular-nums text-foreground">{counts[k]}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {counts.other > 0 ? (
        <p className="mt-2 text-[12px] text-warm-meta">
          Other ({counts.other}){mostly ? `, mostly: ${mostly}` : ''}
        </p>
      ) : null}
    </>
  );
}

function DayCard({
  day,
  actor,
  thisYear,
  now,
}: {
  day: LogDay;
  actor: CheckerDayLog['actor'];
  thisYear: number;
  now?: Date;
}) {
  const [open, setOpen] = useState(false);
  const sentence = daySentence(actor, day, thisYear);
  const colon = sentence.indexOf(':');
  const total = totalOf(day.counts);
  return (
    <li id={`day-${day.day}`} className="scroll-mt-4 rounded-[18px] bg-muted p-4">
      <p className="text-pretty text-[15px] leading-[1.5] text-foreground">
        <span className="font-extrabold">{sentence.slice(0, colon + 1)}</span>
        {sentence.slice(colon + 1)}
      </p>
      <CountBars counts={day.counts} events={day.events} />
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="mt-2 inline-flex min-h-10 items-center gap-1 rounded-full px-1 text-[13px] font-semibold text-brand-blue transition-colors duration-150 hover:text-brand-blue-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {open ? 'Hide the actions' : `See each action (${total})`}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-150', open && 'rotate-180')} aria-hidden />
      </button>
      {open ? (
        <div className="mt-1 rounded-[14px] bg-card px-3">
          <HistoryList<LogEvent>
            events={day.events}
            now={now}
            paperFor={(e) =>
              e.paper_title
                ? { title: e.paper_title, to: e.paper_audit_id ? `/admin/paper-approvals/${encodeURIComponent(e.paper_audit_id)}` : null }
                : null
            }
          />
        </div>
      ) : null}
    </li>
  );
}

export function AdminCheckerLogPersonPage({
  actorKey,
  api = realCheckerLogApi,
  dummy = false,
  banner,
  now,
}: {
  actorKey: string;
  api?: CheckerLogApi;
  dummy?: boolean;
  banner?: ReactNode;
  /** Fixed clock for fixtures. */
  now?: Date;
}) {
  const { user, profile } = useAuth();
  const signedIn = dummy ? 'admin@example.com' : user?.email ?? profile?.full_name ?? 'Signed-in admin';
  const [range, setRange] = useState<(typeof RANGES)[number]>(30);
  // The log and the range it was read for travel together, so the header and
  // the strip never describe 30 days of data as "the last 90".
  const [loaded, setLoaded] = useState<{ log: CheckerDayLog; range: (typeof RANGES)[number] } | null>(null);
  const log = loaded?.log ?? null;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const loadGuard = useRef(createLatestGuard());

  const today = kolkataDay(now ?? new Date());
  const requestFrom = addDays(today, -(range - 1));
  const shownRange = loaded?.range ?? range;
  const from = addDays(today, -(shownRange - 1));
  const thisYear = Number(today.slice(0, 4));

  usePageMeta(log ? `${log.actor.name} | Checker log | Shikshaq Admin` : 'Checker log | Shikshaq Admin', 'One checker\'s work, day by day.');

  const guard = useAdminGuard(dummy ? null : user, { redirectOnDenied: !dummy });
  const isAdmin = dummy ? true : guard.isAdmin;
  const checkingAdmin = dummy ? false : guard.checkingAdmin;
  const sectionCounts = useAdminSectionCounts();

  const load = useCallback(async () => {
    // Only the newest request may write: a slow answer for an earlier range is dropped.
    const token = loadGuard.current.next();
    setLoading(true);
    setLoadError(false);
    try {
      const result = await api.dayLog(actorKey, requestFrom, today);
      if (loadGuard.current.isCurrent(token)) setLoaded({ log: result, range });
    } catch (e) {
      if (import.meta.env.DEV) console.error('checker day log', e);
      if (loadGuard.current.isCurrent(token)) setLoadError(true);
    } finally {
      if (loadGuard.current.isCurrent(token)) setLoading(false);
    }
  }, [api, actorKey, requestFrom, today, range]);

  useEffect(() => {
    if (isAdmin) void load();
    else if (!checkingAdmin) setLoading(false);
    const guard = loadGuard.current;
    return () => guard.cancel();
  }, [isAdmin, checkingAdmin, load]);

  const nav = buildAdminNav('checker-log', sectionCounts);

  const byDay = useMemo(() => new Map((log?.days ?? []).map((d) => [d.day, d])), [log]);
  const strip = useMemo(() => dayRange(from, today), [from, today]);
  const max = useMemo(() => Math.max(0, ...(log?.days ?? []).map((d) => totalOf(d.counts))), [log]);
  // A day with only taken-back actions still has a card, so the "(undone)" rows can be read.
  const activeDays = (log?.days ?? []).filter((d) => totalOf(d.counts) > 0 || d.events.length > 0);
  const { total: rangeTotal, daysWithActions } = rangeSummary(log?.days ?? []);

  if (checkingAdmin || (loading && !log)) {
    return (
      <BentoStack className="min-h-screen bg-muted">
        <AdminHeader nav={nav} signedInEmail={signedIn} />
        {banner}
        <BentoPanel fill="card" className="px-[18px] py-[18px]">
          <AdminLoading shape="cards" rows={3} label="Loading the log" />
        </BentoPanel>
      </BentoStack>
    );
  }
  if (!dummy && guard.error) return <AdminGuardErrorState onRetry={guard.retry} />;
  if (!isAdmin) return null;

  if (loadError || !log) {
    return (
      <BentoStack className="min-h-screen bg-muted">
        <AdminHeader nav={nav} signedInEmail={signedIn} />
        {banner}
        <BentoPanel fill="card" className="px-[18px] py-[18px]">
          <AdminError what="this log" onRetry={() => void load()} />
          <div className="mt-3">
            <Link to="/admin/checker-log" className={adminPillClass('secondary', 'sm')}>
              Back to everyone
            </Link>
          </div>
        </BentoPanel>
      </BentoStack>
    );
  }

  return (
    <BentoStack className="min-h-screen bg-muted">
      <AdminHeader nav={nav} signedInEmail={signedIn} />
      {banner}

      <BentoPanel fill="card" className="px-[18px] py-[18px] lg:px-[18px] lg:py-[18px]" aria-busy={loading || undefined}>
        <Link
          to="/admin/checker-log"
          className="tap-44 inline-flex min-h-10 items-center gap-1.5 text-[13px] font-semibold text-brand-blue hover:text-brand-blue-deep"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Everyone in the log
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-balance text-[22px] font-extrabold leading-tight tracking-[-0.03em] text-foreground">{log.actor.name}</h1>
            <p className="mt-0.5 text-[14px] text-warm-secondary">
              {ROLE_LABELS[log.actor.role]} · {rangeTotal.toLocaleString()} {rangeTotal === 1 ? 'action' : 'actions'} on{' '}
              {daysWithActions} of the last {shownRange} days
            </p>
          </div>
          <AdminFilterChips
            label="How far back"
            chips={RANGES.map((r) => ({ key: String(r), label: `Last ${r} days`, noCount: true }))}
            value={String(range)}
            onChange={(k) => setRange(Number(k) as (typeof RANGES)[number])}
          />
        </div>

        <div className="mt-4">
          <div className="flex flex-wrap gap-[3px]" role="list" aria-label={`Activity per day, ${dayWords(from, thisYear)} to ${dayWords(today, thisYear)}`}>
            {strip.map((d) => {
              const day = byDay.get(d);
              const total = day ? totalOf(day.counts) : 0;
              const undoneOnly = !total && !!day && day.events.length > 0;
              const label = `${dayWords(d, thisYear)}: ${total ? `${total} ${total === 1 ? 'action' : 'actions'}` : undoneOnly ? 'only undone actions' : 'nothing'}`;
              const cls = cn('block h-[18px] w-[18px] rounded-[6px]', HEAT_CLASS[heatLevel(total, max)], d === today && 'ring-2 ring-inset ring-panel');
              return (
                <span key={d} role="listitem">
                  {total ? (
                    <a href={`#day-${d}`} aria-label={label} title={label} className={cn(cls, 'hover:ring-2 hover:ring-brand-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')} />
                  ) : (
                    <span aria-label={label} title={label} className={cls} />
                  )}
                </span>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-[12px] text-warm-label">
            <span>{dayWords(from, thisYear)}</span>
            <span className="flex items-center gap-1" aria-hidden>
              Less
              {HEAT_CLASS.map((c) => (
                <span key={c} className={cn('h-3 w-3 rounded-[2px]', c)} />
              ))}
              More
            </span>
            <span>Today</span>
          </div>
        </div>
      </BentoPanel>

      <BentoPanel fill="card" className="px-[18px] py-[18px] lg:px-[18px] lg:py-[18px]">
        <h2 className="mb-3 text-[19px] font-extrabold tracking-[-0.03em] text-foreground">Day by day</h2>
        {activeDays.length ? (
          <ol className="flex flex-col gap-2.5">
            {activeDays.map((d) => (
              <DayCard key={d.day} day={d} actor={log.actor} thisYear={thisYear} now={now} />
            ))}
          </ol>
        ) : (
          <div className="rounded-2xl bg-muted p-5 text-center">
            <p className="text-[15px] font-semibold text-foreground">Nothing recorded in the last {shownRange} days.</p>
            {shownRange < RANGES[RANGES.length - 1] ? (
              <AdminPillButton className="mt-3" onClick={() => setRange(RANGES[RANGES.length - 1])}>
                Look further back
              </AdminPillButton>
            ) : null}
          </div>
        )}
      </BentoPanel>

      <AdminAuditNote />
    </BentoStack>
  );
}

export default function AdminCheckerLogPerson() {
  const { actorKey = '' } = useParams<{ actorKey: string }>();
  if (DummyCheckerLogPerson && isDummyMode()) {
    return (
      <Suspense fallback={null}>
        <DummyCheckerLogPerson actorKey={actorKey} />
      </Suspense>
    );
  }
  return <AdminCheckerLogPersonPage actorKey={actorKey} />;
}
