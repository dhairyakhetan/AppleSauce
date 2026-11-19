import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AttentionGroup, PaperStatusPill, PaperTimelineDisclosure } from '@/components/PaperStatus';
import { EmptyNote, ListSkeleton, LoadError, ago, deskLink } from '@/components/hod/HodShared';
import { EMPTY_MOMENTS, stageOfReady, waitingReason, type AttentionItem } from '@/lib/paper-status';
import { PublishFlow } from '@/components/hod/PublishFlow';
import { CheckChips, RouteTrail } from '@/components/hod/RouteTrail';
import { actionToneClass } from '@/lib/checker-button-styles';
import type { HodApi } from '@/lib/hod-api';
import { blockedReasons, checksSummary, leftOutText, readySummaryText, unqueuedBannerText, type HodReadyPaper, type TrailStage } from '@/lib/hod-publish';
import { cn } from '@/lib/utils';

/* "Ready to go live": papers whose questions are all settled and that wait for
   a yes. Each row shows the four checks as chips. Opening a paper starts the
   preview flow (PublishFlow): read it, run the checks, fix the details, publish.
   The paper in view is the ?paper= in the address, so Back works and a link can
   point straight at one paper. */

export const READY_KEY = (scope: string) => ['hod', scope, 'ready'] as const;

function ReadyRow({ p, api, scope, stage }: { p: HodReadyPaper; api: HodApi; scope: string; stage: TrailStage }) {
  const reasons = p.all_ok ? [] : blockedReasons(p.checks);
  return (
    <li className="rounded-[18px] bg-muted shadow-card p-4" data-testid="ready-paper" data-ok={p.all_ok}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[15px] font-bold text-foreground">{p.title}</p>
            {p.all_ok ? <PaperStatusPill stage={stageOfReady(p)} /> : null}
          </div>
          <p className="mt-0.5 text-[12px] text-warm-meta">
            {[p.school, p.cls ? `Class ${p.cls}` : null, p.board, p.exam, p.year].filter(Boolean).join(' · ')}
          </p>
          <p className="mt-1 text-[12px] tabular-nums text-warm-secondary">
            {p.passed_count} of {p.question_count} questions passed
            {p.queued_at ? ` · queued ${ago(p.queued_at)}` : ''}
          </p>
        </div>
        <Link
          to={deskLink('ready', p.audit_paper_id)}
          className={cn(actionToneClass(p.all_ok ? 'dark' : 'brand'), 'shrink-0')}
          aria-label={`${p.all_ok ? 'Review and publish' : 'Open'} ${p.title}`}
        >
          {p.all_ok ? 'Review and publish' : 'Open'}
        </Link>
      </div>
      {reasons.length > 0 ? (
        <ul className="mt-3 space-y-1 text-[13px] text-foreground" data-testid="blocked-reasons">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <CheckChips checks={p.checks} />
        <span className={cn('text-[12px] font-semibold', p.all_ok ? 'text-foreground' : 'text-destructive')}>{checksSummary(p.checks)}</span>
        {leftOutText(p.left_out) ? (
          <span className="rounded-full bg-brand-subtle px-2.5 py-1 text-[12px] font-semibold text-foreground" data-testid="ready-left-out">
            {leftOutText(p.left_out)}
          </span>
        ) : null}
        {p.kind === 'retro' ? <span className="rounded-full bg-card px-2.5 py-1 text-[12px] text-warm-secondary">Already live: approving records it</span> : null}
      </div>
      <RouteTrail stage={stage} className="mt-3" />
      <PaperTimelineDisclosure
        className="mt-3"
        queryKey={['hod', scope, 'timeline', p.audit_paper_id]}
        load={() => api.paperTimeline(p.audit_paper_id)}
        fallback={{ ...EMPTY_MOMENTS, finished_at: p.queued_at }}
        stage={stageOfReady(p)}
      />
    </li>
  );
}

export function ReadyList({ api, scope }: { api: HodApi; scope: string }) {
  const q = useQuery({ queryKey: READY_KEY(scope), queryFn: () => api.readyPapers(), staleTime: 0, refetchOnMount: true });
  const trailQ = useQuery({ queryKey: ['hod', scope, 'trail'], queryFn: () => api.paperTrail(), staleTime: 30_000 });
  const stageOf = useMemo(() => new Map((trailQ.data ?? []).map((t) => [t.audit_paper_id, t.stage])), [trailQ.data]);
  if (q.isLoading) return <ListSkeleton label="Loading the papers that are ready" />;
  if (q.isError) return <LoadError what="The papers that are ready" onRetry={() => void q.refetch()} />;
  const list = q.data ?? [];
  if (list.length === 0) {
    return <EmptyNote>No paper is ready yet. When every question on a paper is settled, it waits here for your yes.</EmptyNote>;
  }
  // The papers that pass all four checks come first; the rest are blocked and each says why.
  const goLive = list.filter((p) => p.all_ok);
  const blocked = list.filter((p) => !p.all_ok);
  const now = new Date();
  // Papers that can go live but have waited a week for a yes. A blocked paper says its reason on its own row.
  const attention: AttentionItem[] = goLive.flatMap((p) => {
    const reason = waitingReason(p, now);
    return reason ? [{ key: p.audit_paper_id, stage: stageOfReady(p), label: p.title, reason }] : [];
  });
  return (
    <div>
      <AttentionGroup id="ready-attention" items={attention} />
      <p className="mb-3 mt-3 text-[13px] text-warm-secondary" data-testid="ready-summary">
        {readySummaryText(list.length, goLive.length)} Open a paper to read it, run the checks and publish.
      </p>
      {goLive.length > 0 ? (
        <section aria-labelledby="ready-can-go-live" data-testid="ready-can-go-live">
          <h2 id="ready-can-go-live" className="mb-2 text-[16px] font-bold text-foreground">
            Can go live now ({goLive.length})
          </h2>
          <ul className="space-y-3">
            {goLive.map((p) => (
              <ReadyRow key={p.audit_paper_id} p={p} api={api} scope={scope} stage={stageOf.get(p.audit_paper_id) ?? 'ready'} />
            ))}
          </ul>
        </section>
      ) : null}
      {blocked.length > 0 ? (
        <section aria-labelledby="ready-blocked" className={goLive.length > 0 ? 'mt-6' : undefined} data-testid="ready-blocked">
          <h2 id="ready-blocked" className="mb-2 text-[16px] font-bold text-foreground">
            Blocked, with the reason ({blocked.length})
          </h2>
          <ul className="space-y-3">
            {blocked.map((p) => (
              <ReadyRow key={p.audit_paper_id} p={p} api={api} scope={scope} stage={stageOf.get(p.audit_paper_id) ?? 'ready'} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** The line above the list: papers whose questions are all checked but that no queue run has put on this desk yet. */
function UnqueuedBanner({ api, scope }: { api: HodApi; scope: string }) {
  const q = useQuery({ queryKey: ['hod', scope, 'unqueued'], queryFn: () => api.unqueuedCount(), staleTime: 30_000, retry: false });
  const text = unqueuedBannerText(q.data ?? 0);
  if (!text) return null;
  return (
    <p className="mb-3 rounded-xl bg-brand-subtle px-3 py-2 text-[13px] font-semibold text-foreground" role="status" data-testid="unqueued-banner">
      {text}
    </p>
  );
}

export function ReadyTab({ api, scope }: { api: HodApi; scope: string }) {
  const [params] = useSearchParams();
  const paperId = params.get('paper');
  if (paperId) return <PublishFlow key={paperId} api={api} scope={scope} paperId={paperId} />;
  return (
    <>
      <UnqueuedBanner api={api} scope={scope} />
      <ReadyList api={api} scope={scope} />
    </>
  );
}
