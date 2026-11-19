import { refreshHod } from '@/lib/hod-refresh';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { EmptyNote, ListSkeleton, LoadError, quietButton } from '@/components/hod/HodShared';
import { ReportProblemDialog } from '@/components/requests/ReportProblemDialog';
import { CHIP, actionToneClass } from '@/lib/checker-button-styles';
import { realFixRequestsApi, type FixRequestsApi } from '@/lib/fix-requests-api';
import {
  DEFAULT_GROUP,
  REQUEST_GROUPS,
  decisionProblem,
  describeScreen,
  groupCounts,
  hodStatusWord,
  kindWord,
  requestErrorWords,
  requestsCountsKey,
  screenPath,
  timeAgo,
  type FixRequest,
  type RequestGroup,
  type RequestStatus,
} from '@/lib/fix-requests';
import type { HodTabProps } from '@/pages/Hod';
import { cn } from '@/lib/utils';
import { useOptionalAuth } from '@/lib/auth-context';

/* "Requests": the bugs and changes people have asked for. A checker's request waits here for a yes or a
   no (a no needs a reason). Once it is approved it is for Claude to fix; Claude reads the list from the
   database at the start of a session (docs/FIX_REQUESTS.md) and writes down what was done. An HOD can
   send their own from "New request", which is approved at once and needs nobody's yes.
   The server checks is_hod() on every call (admins count). */

const REQUESTS_LIST_KEY = (scope: string, group: RequestGroup) => ['hod', scope, 'requests', group] as const;

const STATUS_TONE: Record<RequestStatus, string> = {
  waiting_for_hod: 'bg-brand-subtle text-foreground',
  approved: 'bg-mint text-foreground',
  in_progress: 'bg-mint text-foreground',
  rejected: 'bg-destructive/10 text-destructive',
  done: 'bg-mint text-foreground',
};

export function RequestsTab({ scope, requestsApi, canSwitchTrust }: HodTabProps) {
  return <RequestsSection api={requestsApi ?? realFixRequestsApi} scope={scope} isAdmin={canSwitchTrust} />;
}

export function RequestsSection({ api, scope, isAdmin = false }: { api: FixRequestsApi; scope: string; isAdmin?: boolean }) {
  const qc = useQueryClient();
  const myId = useOptionalAuth()?.user?.id ?? null;
  const [group, setGroup] = useState<RequestGroup>(DEFAULT_GROUP);
  const [writing, setWriting] = useState(false);
  const countsQ = useQuery({ queryKey: requestsCountsKey(scope), queryFn: () => api.counts(), staleTime: 15_000 });
  const listQ = useQuery({ queryKey: REQUESTS_LIST_KEY(scope, group), queryFn: () => api.list(group), staleTime: 0, refetchOnMount: true });
  const numbers = groupCounts(countsQ.data);
  const current = REQUEST_GROUPS.find((g) => g.key === group) ?? REQUEST_GROUPS[0];
  const refresh = () => refreshHod(qc, scope, 'requests');

  return (
    <section aria-labelledby="requests-heading" data-testid="requests-tab">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="requests-heading" className="text-[15px] font-bold text-foreground">
            Requests
          </h2>
          <p className="mt-1 max-w-2xl text-pretty text-[14px] leading-snug text-warm-secondary">
            Things checkers say are broken or should change. Say yes or no to each one. A yes sends it on to be fixed. You can also send your own: it goes
            straight on without waiting for anyone.
          </p>
        </div>
        <button type="button" onClick={() => setWriting(true)} className={cn('flex items-center gap-1.5', actionToneClass('brand'))}>
          <Plus className="h-4 w-4" aria-hidden />
          New request
        </button>
      </div>

      <div role="group" aria-label="Show requests" className="my-4 flex flex-wrap gap-1.5">
        {REQUEST_GROUPS.map((g) => (
          <button
            key={g.key}
            type="button"
            aria-pressed={group === g.key}
            onClick={() => setGroup(g.key)}
            className={cn(CHIP, group === g.key ? 'bg-panel text-background' : 'bg-muted text-warm-secondary hover:text-foreground')}
          >
            {g.label}
            {countsQ.data ? <span className="ml-1.5 tabular-nums">{numbers[g.key]}</span> : countsQ.isError ? <span className="ml-1.5">?</span> : null}
          </button>
        ))}
      </div>

      {listQ.isLoading ? (
        <ListSkeleton label="Loading requests" />
      ) : listQ.isError ? (
        <LoadError what="The requests" onRetry={() => void listQ.refetch()} />
      ) : (listQ.data ?? []).length === 0 ? (
        <EmptyNote>{current.empty}</EmptyNote>
      ) : (
        <ul className="space-y-3" aria-label={current.label}>
          {(listQ.data ?? []).map((r) => (
            <RequestCard key={r.id} api={api} request={r} onDecided={refresh} own={!isAdmin && myId !== null && r.raised_by === myId} />
          ))}
        </ul>
      )}

      {writing ? <ReportProblemDialog api={api} scope={scope} page={screenPath(window.location)} asHod onClose={() => setWriting(false)} /> : null}
    </section>
  );
}

export function RequestCard({
  api,
  request: r,
  onDecided,
  own = false,
}: {
  api: FixRequestsApi;
  request: FixRequest;
  onDecided: () => void;
  /** True when the signed-in HOD sent this one themselves (and is not an admin): the database refuses that decision. */
  own?: boolean;
}) {
  const [mode, setMode] = useState<null | 'approve' | 'reject'>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waiting = r.status === 'waiting_for_hod';

  async function decide(approve: boolean) {
    const problem = decisionProblem(approve, note);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.decide(r.id, approve, note);
      toast.success(approve ? 'Approved. It goes on to be fixed.' : 'Rejected. The person can see your reason.');
      setMode(null);
      setNote('');
      onDecided();
    } catch (err) {
      setError(requestErrorWords(err));
      // Someone else may have decided it already: show the list as it is now.
      onDecided();
    } finally {
      setBusy(false);
    }
  }

  const who = r.raised_by_name ?? 'Someone';

  return (
    <li className="rounded-[18px] bg-muted shadow-card p-4" data-testid="request-card" data-status={r.status}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-[15px] font-bold text-foreground">{r.title}</p>
          <p className="mt-0.5 text-[12px] text-warm-meta">
            {kindWord(r.kind)} · from {who}
            {r.raised_as === 'hod' ? ' (an HOD)' : ''}
            {r.created_at ? `, ${timeAgo(r.created_at)}` : ''} · on {describeScreen(r.page_path)}
          </p>
        </div>
        <span className={cn('shrink-0 rounded-full px-3 py-1 text-[12px] font-bold', STATUS_TONE[r.status])}>{hodStatusWord(r.status)}</span>
      </div>

      {r.details ? <p className="mt-2 whitespace-pre-wrap break-words text-[14px] leading-snug text-foreground">{r.details}</p> : <p className="mt-2 text-[13px] text-warm-meta">No details were written.</p>}

      {r.raised_as === 'hod' && r.status === 'approved' ? <p className="mt-2 text-[13px] text-warm-secondary">Sent by an HOD, so it went straight on to be fixed.</p> : null}

      {!waiting && r.decided_at ? (
        <p className="mt-2 text-[13px] text-warm-secondary">
          {r.status === 'rejected' ? 'Rejected' : 'Approved'}
          {r.decided_by_name ? ` by ${r.decided_by_name}` : ''} {timeAgo(r.decided_at)}.{r.decision_note ? ` Note: ${r.decision_note}` : ''}
        </p>
      ) : null}
      {r.status === 'done' && r.claude_note ? (
        <p className="mt-2 rounded-xl bg-card px-3 py-2 text-[13px] leading-snug text-foreground">
          <span className="font-semibold">What was done: </span>
          {r.claude_note}
        </p>
      ) : null}

      {waiting && own ? (
        <p className="mt-3 text-[13px] text-warm-secondary">You sent this one, so another HOD has to say yes or no to it.</p>
      ) : waiting ? (
        <div className="mt-3">
          {mode ? (
            <label className="mb-2 flex flex-col gap-1 text-[13px] font-semibold text-foreground">
              {mode === 'reject' ? 'Why is it not going ahead? (required, the person will see this)' : 'A note for the person (optional)'}
              <textarea
                value={note}
                onChange={(ev) => {
                  setNote(ev.target.value);
                  setError(null);
                }}
                rows={2}
                maxLength={500}
                disabled={busy}
                className="w-full rounded-xl bg-card p-3 text-[16px] font-normal outline-none focus-visible:ring-2 focus-visible:ring-focus sm:text-[14px]"
              />
            </label>
          ) : null}
          {error ? (
            <p role="alert" className="mb-2 text-[13px] text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {mode === null ? (
              <>
                <button type="button" className={actionToneClass('brand')} onClick={() => setMode('approve')}>
                  Approve
                </button>
                <button type="button" className={quietButton} onClick={() => setMode('reject')}>
                  Reject
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={actionToneClass(mode === 'approve' ? 'brand' : 'dark')}
                  disabled={busy || (mode === 'reject' && note.trim() === '')}
                  onClick={() => void decide(mode === 'approve')}
                >
                  {busy ? 'Saving...' : mode === 'approve' ? 'Approve it' : 'Reject it'}
                </button>
                <button
                  type="button"
                  className={quietButton}
                  disabled={busy}
                  onClick={() => {
                    setMode(null);
                    setNote('');
                    setError(null);
                  }}
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </li>
  );
}
