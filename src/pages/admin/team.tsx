import { useCallback, useEffect, useRef, useState, lazy, Suspense, type ReactNode } from 'react';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useAuth } from '@/lib/auth-context';
import { useAdminGuard, AdminGuardErrorState } from '@/components/AdminConsole';
import { AdminHeader, AdminAuditNote, buildAdminNav } from '@/pages/admin/shell';
import { AdminPageIntroPanel, InfoTip } from '@/components/admin/AdminHelp';
import { AdminPanelHeader } from '@/pages/admin/AdminTable';
import { BentoPanel, BentoStack } from '@/components/layout/PageContainer';
import { useAdminSectionCounts } from '@/pages/admin/useAdminSectionCounts';
import { QuestionTimeline } from '@/components/admin/QuestionTimeline';
import { AdminDialog } from '@/components/admin/AdminDialog';
import { AdminFilterChips } from '@/components/admin/AdminFilterChips';
import { AdminPillButton } from '@/components/admin/AdminPillButton';
import { AdminEmpty, AdminError, AdminLoading } from '@/components/admin/AdminState';
import { DebugId } from '@/components/DebugId';
import { formatSeconds } from '@/lib/format-seconds';
import { loadView } from '@/lib/admin-load-view';
import { PAPER_PAGE, moreCount, nextPaperLimit, papersShownText, summaryLine, totalsOf } from '@/lib/team-view';
import {
  realTeamDashboardApi,
  type TeamDashboardApi,
  type TeamStatsRow,
  type PaperProgressRow,
  type QuestionHistoryRow,
} from '@/lib/team-dashboard-api';
import { PREVIEW_TOOLS } from '@/lib/preview-tools';
import { isDummyMode } from '@/lib/dummy-mode';
import { cn } from '@/lib/utils';

const DummyAdminTeam = PREVIEW_TOOLS ? lazy(() => import('@/dummy/AdminTeamDummy')) : null;

/* Owner Round 6 ("00 Owner Brief and Answers.md"): "a visual dashboard for
   HODs, in the admin paper-review section: how each team member performs,
   a neat per-question tracker, without much effort -- readable at a
   glance." Its own tab (Verifier progress) in People, rather than a section
   folded into that already-large page, for the same reason Verifiers got
   its own tab: this is a different shape of screen (aggregate stats +
   drill-down), not another moderation queue.

   The page keeps its shape while it refreshes: changing the range, or
   retrying, never brings the skeleton back, and a failed refresh keeps the
   last good numbers on screen with an error beside them. A failed first read
   is an error with Try again, never "Nobody checked a question". */

type Range = 'today' | '7d' | '30d' | 'all';

const RANGE_LABEL: Record<Range, string> = { today: 'Today', '7d': '7 days', '30d': '30 days', all: 'All' };

function rangeToDates(range: Range): { from: Date; to: Date } {
  const to = new Date();
  const from = new Date(to);
  if (range === 'today') {
    from.setHours(0, 0, 0, 0);
  } else if (range === '7d') {
    from.setDate(from.getDate() - 7);
  } else if (range === '30d') {
    from.setDate(from.getDate() - 30);
  } else {
    from.setFullYear(from.getFullYear() - 10);
  }
  return { from, to };
}

const COLS = 'lg:grid-cols-[minmax(160px,2fr)_1fr_1fr_1fr_1fr_auto]';

export function AdminTeamPage({
  api = realTeamDashboardApi,
  dummy = false,
  banner,
}: {
  api?: TeamDashboardApi;
  dummy?: boolean;
  banner?: ReactNode;
}) {
  usePageMeta('Verifier progress | Shikshaq Admin', 'How many questions each verifier checked, and how the papers are moving.');
  const { user, profile } = useAuth();
  const actorName = dummy ? 'admin@example.com' : profile?.full_name || user?.email || 'Signed-in admin';
  const [range, setRange] = useState<Range>('7d');
  const [stats, setStats] = useState<TeamStatsRow[]>([]);
  const [progress, setProgress] = useState<PaperProgressRow[]>([]);
  // The range the numbers on screen belong to, so a failed refresh can say so.
  const [heldRange, setHeldRange] = useState<Range | null>(null);
  const [settled, setSettled] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paperLimit, setPaperLimit] = useState(PAPER_PAGE);
  const loadSeq = useRef(0);

  const [questionQuery, setQuestionQuery] = useState('');
  const [openQuestionId, setOpenQuestionId] = useState<string | null>(null);
  const [historyRows, setHistoryRows] = useState<QuestionHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const historySeq = useRef(0);

  const guard = useAdminGuard(dummy ? null : user, { redirectOnDenied: !dummy });
  const isAdmin = dummy ? true : guard.isAdmin;
  const checkingAdmin = dummy ? false : guard.checkingAdmin;
  const { error: adminGuardError, retry: retryAdminGuard } = guard;
  const sectionCounts = useAdminSectionCounts();

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setBusy(true);
    try {
      const { from, to } = rangeToDates(range);
      const [s, p] = await Promise.all([api.teamStats(from, to), api.paperProgress()]);
      if (seq !== loadSeq.current) return;
      setStats(s);
      setProgress(p);
      setHeldRange(range);
      setLoadError(false);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      // Keep the last good numbers; the error shows beside them.
      if (import.meta.env.DEV) console.error('Error loading the verifier progress:', e);
      setLoadError(true);
    } finally {
      if (seq === loadSeq.current) {
        setSettled(true);
        setBusy(false);
      }
    }
  }, [api, range]);

  useEffect(() => {
    if (dummy || isAdmin) void load();
  }, [dummy, isAdmin, load]);

  async function openHistory(id: string) {
    const clean = id.trim();
    if (!clean) return;
    const seq = ++historySeq.current;
    setOpenQuestionId(clean);
    setHistoryLoading(true);
    setHistoryError(false);
    setHistoryRows([]);
    try {
      const rows = await api.questionHistory(clean);
      if (seq !== historySeq.current) return;
      setHistoryRows(rows);
    } catch {
      if (seq !== historySeq.current) return;
      setHistoryError(true);
    } finally {
      if (seq === historySeq.current) setHistoryLoading(false);
    }
  }

  const nav = buildAdminNav('team', sectionCounts);

  if (adminGuardError) return <AdminGuardErrorState onRetry={retryAdminGuard} />;

  if (checkingAdmin || !settled) {
    return (
      <BentoStack className="min-h-screen bg-muted">
        <AdminHeader nav={nav} signedInEmail={dummy ? 'admin@example.com' : user?.email ?? actorName} />
        <BentoPanel fill="card" className="px-1.5 py-[18px] lg:px-1.5 lg:py-[18px]">
          <div className="px-[18px]">
            <AdminLoading shape="table" label="Loading the verifier progress" />
          </div>
        </BentoPanel>
        <AdminAuditNote />
      </BentoStack>
    );
  }
  if (!isAdmin) return null;

  const view = loadView({ settled, error: loadError, count: stats.length + progress.length });

  return (
    <BentoStack className="min-h-screen bg-muted">
      <AdminHeader nav={nav} signedInEmail={dummy ? 'admin@example.com' : user?.email ?? actorName} />
      <AdminPageIntroPanel page="team" />
      {banner}

      <BentoPanel fill="card" className="px-1.5 py-[18px] lg:px-1.5 lg:py-[18px]">
        <AdminPanelHeader title="Verifier progress" meta={view === 'list' || view === 'empty' ? `${stats.length} ${stats.length === 1 ? 'verifier' : 'verifiers'} active` : undefined} />

        <div className="mb-3 px-[18px]">
          <AdminFilterChips
            label="Time range"
            value={range}
            onChange={(k) => setRange(k as Range)}
            chips={(Object.keys(RANGE_LABEL) as Range[]).map((r) => ({ key: r, label: RANGE_LABEL[r], noCount: true }))}
          />
        </div>

        <div aria-busy={busy || undefined}>
          <TeamBody
            settled={settled}
            loadError={loadError}
            stats={stats}
            progress={progress}
            range={range}
            heldRange={heldRange}
            paperLimit={paperLimit}
            questionQuery={questionQuery}
            onQuestionQuery={setQuestionQuery}
            onLookup={(id) => void openHistory(id)}
            onRetry={() => void load()}
            onRange={setRange}
            onShowMore={() => setPaperLimit((l) => nextPaperLimit(l, progress.length))}
          />
        </div>
      </BentoPanel>

      <AdminAuditNote />

      <AdminDialog
        open={openQuestionId !== null}
        onOpenChange={(o) => {
          if (!o) {
            historySeq.current++;
            setOpenQuestionId(null);
          }
        }}
        title={openQuestionId ? `History for question ${openQuestionId}` : 'Question history'}
        size="md"
        footer={
          <AdminPillButton variant="secondary" size="sm" onClick={() => setOpenQuestionId(null)}>
            Close
          </AdminPillButton>
        }
      >
        {openQuestionId ? (
          <QuestionTimeline
            rows={historyRows}
            loading={historyLoading}
            error={historyError}
            onRetry={() => void openHistory(openQuestionId)}
          />
        ) : null}
      </AdminDialog>
    </BentoStack>
  );
}

/** Everything under the range chips. Pure, so the error, empty and success states can each be checked. */
export function TeamBody({
  settled,
  loadError,
  stats,
  progress,
  range,
  heldRange,
  paperLimit,
  questionQuery,
  onQuestionQuery,
  onLookup,
  onRetry,
  onRange,
  onShowMore,
}: {
  settled: boolean;
  loadError: boolean;
  stats: TeamStatsRow[];
  progress: PaperProgressRow[];
  range: Range;
  heldRange: Range | null;
  paperLimit: number;
  questionQuery: string;
  onQuestionQuery: (v: string) => void;
  onLookup: (id: string) => void;
  onRetry: () => void;
  onRange: (r: Range) => void;
  onShowMore: () => void;
}) {
  const view = loadView({ settled, error: loadError, count: stats.length + progress.length });
  const heldLabel = heldRange ? RANGE_LABEL[heldRange] : null;
  const totals = totalsOf(stats);
  const maxChecked = Math.max(1, ...stats.map((r) => r.questions_checked));
  if (view === 'skeleton') return <AdminLoading shape="table" label="Loading the verifier progress" />;
  if (view === 'error') {
    return (
      <div className="px-[18px]">
        <AdminError what="the verifier progress" onRetry={onRetry} />
      </div>
    );
  }
  return (
    <>
      {loadError ? (
        <div className="mb-3 px-[18px]">
          <AdminError
            what={`the numbers for ${RANGE_LABEL[range]}`}
            onRetry={onRetry}
            detail={heldLabel ? `Showing the numbers for ${heldLabel} below.` : undefined}
          />
        </div>
      ) : null}

      {stats.length > 0 ? (
        <p className="mb-4 px-[18px] text-pretty text-[13px] leading-[1.5] text-warm-secondary" aria-live="polite">
          {summaryLine(totals)}
        </p>
      ) : null}

      <LookupBox value={questionQuery} onChange={onQuestionQuery} onLookup={onLookup} />

      {stats.length === 0 ? (
        <div className="mx-[18px]">
          <AdminEmpty
            title={
              range === 'all'
                ? 'Nobody has checked a question yet'
                : range === 'today'
                ? 'Nobody has checked a question today'
                : `Nobody checked a question in the last ${RANGE_LABEL[range].toLowerCase()}`
            }
            hint="Try a longer range to see earlier work."
            action={range === 'all' ? undefined : { label: 'Show all time', onClick: () => onRange('all') }}
            className="rounded-2xl bg-muted"
          />
        </div>
      ) : (
        <VerifierStatsList stats={stats} maxChecked={maxChecked} />
      )}

      <div className="mt-8 px-[18px]">
        <h2 className="mb-1 text-[15px] font-bold text-foreground">Papers, most doubts left first</h2>
        {progress.length > 0 ? <p className="mb-3 text-[13px] text-warm-secondary">{papersShownText(Math.min(paperLimit, progress.length), progress.length)}</p> : null}
        <div className="space-y-2">
          {progress.slice(0, paperLimit).map((p) => (
            <PaperProgressCard key={p.audit_paper_id} row={p} />
          ))}
          {progress.length === 0 ? <p className="text-[13px] text-warm-secondary">No papers in the pipeline right now.</p> : null}
        </div>
        {progress.length > paperLimit ? (
          <div className="mt-3">
            <AdminPillButton variant="secondary" size="sm" onClick={onShowMore}>
              Show {moreCount(paperLimit, progress.length)} more
            </AdminPillButton>
          </div>
        ) : null}
      </div>
    </>
  );
}

function LookupBox({ value, onChange, onLookup }: { value: string; onChange: (v: string) => void; onLookup: (id: string) => void }) {
  return (
    <div className="mb-6 px-[18px]">
      <label className="flex min-w-0 max-w-full flex-col gap-1">
        <span className="text-[12px] font-semibold text-warm-secondary">Look up a question by its id</span>
        <div className="flex max-w-full gap-1.5">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onLookup(value);
              }
            }}
            placeholder="Paste a question id"
            aria-label="Question id"
            className="h-11 w-full min-w-0 max-w-[320px] flex-1 rounded-full bg-muted px-4 font-mono text-[13px] text-foreground outline-none placeholder:text-warm-label focus-visible:ring-2 focus-visible:ring-brand"
          />
          <AdminPillButton variant="primary" onClick={() => onLookup(value)} disabled={!value.trim()} className="shrink-0 bg-brand text-foreground">
            Show history
          </AdminPillButton>
        </div>
      </label>
      <p className="mt-1.5 max-w-xl text-pretty text-[12px] leading-[1.5] text-warm-meta">
        A question id appears on the Question changes page, and beside names here when the debug switch at the top is on. History shows who touched the question and what changed.
      </p>
    </div>
  );
}

/** Verifier, Checked, Passed, Fixed, Changed by admin. The rest sits one tap away in a line under the row. */
export function VerifierStatsList({ stats, maxChecked }: { stats: TeamStatsRow[]; maxChecked: number }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="px-[18px]" role="table" aria-label="Verifier progress">
      <div
        role="row"
        className={cn('hidden gap-3.5 px-[14px] py-[10px] shadow-[inset_0_-1px_0_#E7DFD5] lg:grid', COLS)}
      >
        <span role="columnheader" className="text-[11px] font-bold uppercase tracking-[.06em] text-warm-label">Verifier</span>
        <HeaderCell label="Checked" hint="Questions this verifier looked at in this range." />
        <HeaderCell label="Passed" hint="Marked right as printed, with no change." />
        <HeaderCell label="Fixed" hint="Changed to match the printed page." />
        <HeaderCell label="Changed by admin" hint="Their decision was later changed by an admin." />
        <span role="columnheader"><span className="sr-only">More</span></span>
      </div>
      <ul role="rowgroup" className="divide-y divide-warm-hairline lg:divide-y-0">
        {stats.map((r) => {
          const open = openId === r.user_id;
          const detailId = `team-more-${r.user_id}`;
          return (
            <li key={r.user_id} role="row" className="py-3 lg:px-[14px] lg:shadow-[inset_0_-1px_0_#F0EAE2]">
              <div className={cn('grid grid-cols-4 items-center gap-x-3 gap-y-2 lg:gap-3.5', COLS)}>
                <div role="cell" className="col-span-4 min-w-0 lg:col-span-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[15px] font-bold text-foreground lg:text-[14px]">{r.name}</span>
                    <DebugId label="verifier" value={r.user_id} />
                  </div>
                  <MiniBar value={r.questions_checked} max={maxChecked} />
                </div>
                <Num label="Checked" value={r.questions_checked} strong />
                <Num label="Passed" value={r.passed} />
                <Num label="Fixed" value={r.fixed} />
                <Num label="Changed by admin" value={r.admin_overturns} warn={r.admin_overturns > 0} />
                <div role="cell" className="col-span-4 flex justify-start lg:col-span-1 lg:justify-end">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={detailId}
                    onClick={() => setOpenId(open ? null : r.user_id)}
                    className="relative inline-flex min-h-10 items-center rounded-full bg-muted px-3.5 text-[13px] font-bold text-warm-secondary transition-colors duration-150 before:absolute before:-inset-[2px] before:content-[''] hover:bg-warm-hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {open ? 'Less' : 'More'}
                    <span className="sr-only"> about {r.name}</span>
                  </button>
                </div>
              </div>
              {open ? (
                <p id={detailId} className="mt-2 text-pretty text-[13px] leading-[1.5] text-warm-secondary lg:pr-2">
                  Asked the HOD for help {r.asked_help}. Skipped {r.skipped}. Papers finished {r.papers_completed}.
                  {r.median_seconds !== null ? ` Median time per question ${formatSeconds(r.median_seconds)}.` : ''}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function HeaderCell({ label, hint }: { label: string; hint: string }) {
  return (
    <span role="columnheader" className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-[.06em] text-warm-label">
      {label}
      <InfoTip text={hint} label={label} />
    </span>
  );
}

function Num({ label, value, strong, warn }: { label: string; value: number; strong?: boolean; warn?: boolean }) {
  return (
    <div role="cell" className="min-w-0">
      <span className="block text-[11px] font-bold uppercase leading-[1.3] tracking-[.04em] text-warm-label lg:hidden">{label}</span>
      <span
        className={cn(
          'text-[15px] tabular-nums lg:text-[14px]',
          strong ? 'font-bold text-foreground' : 'text-warm-secondary',
          warn && 'font-semibold text-destructive',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function MiniBar({ value, max }: { value: number; max: number }) {
  const pct = Math.max(2, Math.round((value / max) * 100));
  return (
    <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`${value} of ${max} checked`}>
      <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
    </div>
  );
}

function PaperProgressCard({ row }: { row: PaperProgressRow }) {
  return (
    <div className="rounded-2xl bg-muted p-3">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="truncate text-[13px] font-semibold text-foreground">
            {[row.school || 'School not known', row.subject, row.cls ? `Class ${row.cls}` : null].filter(Boolean).join(' · ')}
          </p>
          <DebugId label="paper" value={row.live_bank_paper_id ?? row.audit_paper_id} />
          <DebugId label="audit-paper" value={row.audit_paper_id} />
        </div>
        <span className="text-[12px] tabular-nums text-warm-secondary">{row.open_doubts} open · {row.pct_done}% done</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-warm-hairline">
        <div className="h-full rounded-full bg-mint" style={{ width: `${Math.min(100, row.pct_done)}%` }} />
      </div>
      {row.workers.length > 0 ? (
        <p className="mt-1.5 text-[12px] text-warm-secondary">Worked on by: {row.workers.join(', ')}</p>
      ) : null}
    </div>
  );
}

export default function AdminTeam() {
  if (DummyAdminTeam && isDummyMode()) {
    return (
      <Suspense fallback={null}>
        <DummyAdminTeam />
      </Suspense>
    );
  }
  return <AdminTeamPage />;
}
