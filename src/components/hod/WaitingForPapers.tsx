import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Hourglass } from 'lucide-react';
import { ago } from '@/components/hod/HodShared';
import { actionToneClass } from '@/lib/checker-button-styles';
import { SLOW_ACTION_WORDS } from '@/lib/checker-timeout';
import { isNotSwitchedOn, waitingLine, type PaperAsk } from '@/lib/paper-asks';
import type { PaperAsksApi } from '@/lib/paper-asks-api';
import { loadGate } from '@/lib/verifier-papers';

/* "Waiting for papers" on the HOD's Assignments screen (owner, 13 Nov 2026: "Add an 'Ask HOD for more' button").
   Who has finished everything and tapped the button, since when, and how many papers they finished lately. A person
   drops off by themselves once they hold a paper again; an ask older than 3 days is not listed; an HOD can clear one.
   The same card look as the Needs attention group above it. "Give papers to <name>" picks that person in the assign
   bar of "Papers nobody has" and takes the HOD there, so the next tap is ticking papers.

   WaitingForPapersView is the pure picture (so the tests can draw every state); WaitingForPapers fetches and dismisses.
   Before the database file is pasted the read fails with "function not found" and the view says "not switched on yet":
   never an error screen. */

export type WaitingState =
  | { kind: 'loading' }
  | { kind: 'off' }
  | { kind: 'error' }
  | { kind: 'list'; asks: PaperAsk[] };

const SECTION = 'rounded-[18px] bg-muted p-3 shadow-card';

export function WaitingForPapersView({
  state,
  busyId,
  problem,
  onDismiss,
  onRetry,
  onGive,
}: {
  state: WaitingState;
  busyId?: string | null;
  problem?: string | null;
  onDismiss: (id: string) => void;
  onRetry: () => void;
  /** Picks this person in the assign bar below. Left out, no Give button is drawn. */
  onGive?: (userId: string, name: string) => void;
}) {
  const heading = (count?: number) => (
    <h2 id="waiting-for-papers" className="mb-2 flex items-center gap-2 text-[16px] font-bold text-foreground">
      <Hourglass className="h-4 w-4 shrink-0 text-brand-deep" aria-hidden />
      Waiting for papers
      {count ? <span className="text-[12px] font-normal text-warm-secondary">{count === 1 ? '1 person' : `${count} people`}</span> : null}
    </h2>
  );

  if (state.kind === 'loading') return null;

  if (state.kind === 'off') {
    return (
      <section aria-labelledby="waiting-for-papers" className={SECTION} data-testid="waiting-off">
        {heading()}
        <p className="text-[13px] text-warm-secondary">
          Checkers asking for more papers is not switched on yet. It needs one database step; until then, give papers out below as usual.
        </p>
      </section>
    );
  }

  if (state.kind === 'error') {
    return (
      <section aria-labelledby="waiting-for-papers" className={SECTION} data-testid="waiting-error">
        {heading()}
        <p className="text-[13px] text-warm-secondary">
          This list did not load.{' '}
          <button type="button" onClick={onRetry} className="tap-44 font-semibold text-brand-blue">
            Try again
          </button>
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="waiting-for-papers" className={SECTION} data-testid="waiting-for-papers">
      {heading(state.asks.length)}
      {problem ? (
        <p role="alert" className="mb-2 text-[13px] text-destructive" data-testid="waiting-problem">
          {problem}
        </p>
      ) : null}
      {state.asks.length === 0 ? (
        <p className="text-[13px] text-warm-secondary" data-testid="waiting-empty">
          Nobody is waiting for papers right now.
        </p>
      ) : (
        <ul className="space-y-2">
          {state.asks.map((a) => (
            <li key={a.ask_id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-card p-3" data-testid="waiting-person">
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-foreground">{a.name}</p>
                <p className="text-[13px] text-warm-secondary">{waitingLine(a, ago(a.asked_at))}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {onGive ? (
                  <button type="button" onClick={() => onGive(a.user_id, a.name)} className={actionToneClass('brand')} data-testid="give-to-waiting">
                    Give papers to {a.name}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busyId === a.ask_id}
                  onClick={() => onDismiss(a.ask_id)}
                  className={actionToneClass('muted')}
                  aria-label={`Clear ${a.name}'s ask`}
                >
                  Clear
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {state.asks.length > 0 ? (
        <p className="mt-2 text-[12px] text-warm-secondary">
          Give papers picks the person in the list below; tick the papers and press Assign. They leave this list by themselves once they hold a paper.
        </p>
      ) : null}
    </section>
  );
}

export function WaitingForPapers({ api, scope, onGive }: { api: PaperAsksApi; scope: string; onGive?: (userId: string, name: string) => void }) {
  const qc = useQueryClient();
  const key = ['hod', scope, 'paper-asks'] as const;
  const q = useQuery({ queryKey: key, queryFn: api.list, retry: false, refetchInterval: 60_000 });
  const [problem, setProblem] = useState<string | null>(null);
  const dismiss = useMutation({
    mutationFn: (id: string) => api.dismiss(id),
    onSuccess: () => setProblem(null),
    // Never "check your connection": a slow or refused request is not the person's internet (docs/DECISIONS.md, 13 Nov 2026).
    onError: () => setProblem(SLOW_ACTION_WORDS),
    onSettled: () => void qc.invalidateQueries({ queryKey: key }),
  });

  let state: WaitingState;
  if (q.isError) state = isNotSwitchedOn(q.error) ? { kind: 'off' } : { kind: 'error' };
  else if (loadGate(q) === 'loading') state = { kind: 'loading' };
  else state = { kind: 'list', asks: q.data ?? [] };

  return (
    <WaitingForPapersView
      state={state}
      busyId={dismiss.isPending ? dismiss.variables : null}
      problem={problem}
      onDismiss={(id) => dismiss.mutate(id)}
      onRetry={() => void q.refetch()}
      onGive={onGive}
    />
  );
}
