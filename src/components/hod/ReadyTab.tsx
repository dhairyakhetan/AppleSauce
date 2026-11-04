import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { EmptyNote, ListSkeleton, LoadError, ago, deskLink } from '@/components/hod/HodShared';
import { PublishFlow } from '@/components/hod/PublishFlow';
import { CheckChips, RouteTrail } from '@/components/hod/RouteTrail';
import { actionToneClass } from '@/lib/checker-button-styles';
import type { HodApi } from '@/lib/hod-api';
import { checksSummary, leftOutText } from '@/lib/hod-publish';
import { cn } from '@/lib/utils';

/* "Ready to go live": papers whose questions are all settled and that wait for
   a yes. Each row shows the four checks as chips. Opening a paper starts the
   preview flow (PublishFlow): read it, run the checks, fix the details, publish.
   The paper in view is the ?paper= in the address, so Back works and a link can
   point straight at one paper. */

export const READY_KEY = (scope: string) => ['hod', scope, 'ready'] as const;

function ReadyList({ api, scope }: { api: HodApi; scope: string }) {
  const q = useQuery({ queryKey: READY_KEY(scope), queryFn: () => api.readyPapers(), staleTime: 0, refetchOnMount: true });
  const trailQ = useQuery({ queryKey: ['hod', scope, 'trail'], queryFn: () => api.paperTrail(), staleTime: 30_000 });
  const stageOf = useMemo(() => new Map((trailQ.data ?? []).map((t) => [t.audit_paper_id, t.stage])), [trailQ.data]);
  if (q.isLoading) return <ListSkeleton label="Loading the papers that are ready" />;
  if (q.isError) return <LoadError what="The papers that are ready" onRetry={() => void q.refetch()} />;
  const list = q.data ?? [];
  if (list.length === 0) {
    return <EmptyNote>No paper is ready yet. When every question on a paper is settled, it waits here for your yes.</EmptyNote>;
  }
  const ok = list.filter((p) => p.all_ok).length;
  return (
    <div>
      <p className="mb-3 text-[13px] text-warm-secondary" data-testid="ready-summary">
        {list.length === 1 ? '1 paper is ready' : `${list.length} papers are ready`}, {ok === 0 ? 'none can go live yet' : ok === 1 ? '1 can go live now' : `${ok} can go live now`}. Open a paper to read it,
        run the checks and publish.
      </p>
      <ul className="space-y-3">
        {list.map((p) => (
          <li key={p.audit_paper_id} className="rounded-[18px] bg-muted p-4" data-testid="ready-paper" data-ok={p.all_ok}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[15px] font-bold text-foreground">{p.title}</p>
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
            <RouteTrail stage={stageOf.get(p.audit_paper_id) ?? 'ready'} className="mt-3" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReadyTab({ api, scope }: { api: HodApi; scope: string }) {
  const [params] = useSearchParams();
  const paperId = params.get('paper');
  if (paperId) return <PublishFlow key={paperId} api={api} scope={scope} paperId={paperId} />;
  return <ReadyList api={api} scope={scope} />;
}
