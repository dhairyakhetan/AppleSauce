import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { ActionButton } from '@/components/checker/CheckerButtons';
import { askFailureMessage, askOutcomeMessage, isNotSwitchedOn } from '@/lib/paper-asks';
import type { PaperAsksApi } from '@/lib/paper-asks-api';

/* The button a checker sees when no paper is waiting for them (owner, 13 Nov 2026: "Add an 'Ask HOD for more' button").
   One tap tells the HODs this person is free. Warm and short: the checkers are student volunteers.

   AskForPapersView is the pure picture (so the tests can draw every state); AskForPapers does the asking. Before the
   database file is pasted the calls fail with "function not found" and the view says "not switched on yet": never an error
   screen. */

export type AskState =
  /** Not asked yet: the button. */
  | { kind: 'ready'; problem?: string | null }
  /** Asked (just now, or earlier and still open): the thank-you. */
  | { kind: 'asked'; message: string }
  /** The database part is not pasted yet. */
  | { kind: 'off' };

export function AskForPapersView({ state, busy, onAsk }: { state: AskState; busy?: boolean; onAsk: () => void }) {
  if (state.kind === 'off') {
    return (
      <p className="mx-auto mt-4 max-w-md text-pretty text-[13px] text-warm-secondary" data-testid="ask-off">
        Asking for more papers is not switched on yet. Your HOD gives papers out automatically, so please check back soon.
      </p>
    );
  }
  if (state.kind === 'asked') {
    return (
      <p
        role="status"
        className="mx-auto mt-4 max-w-md text-pretty rounded-2xl bg-card px-4 py-3 text-[14px] font-semibold text-foreground"
        data-testid="ask-done"
      >
        {state.message}
      </p>
    );
  }
  return (
    <div className="mt-4 flex flex-col items-center gap-2" data-testid="ask-ready">
      <p className="max-w-md text-pretty text-[14px] text-foreground">You are all caught up. Thank you for the good work.</p>
      <ActionButton tone="brand" onClick={onAsk} disabled={busy}>
        {busy ? 'Asking...' : 'Ask my HOD for more papers'}
      </ActionButton>
      {state.problem ? (
        <p role="alert" className="max-w-md text-pretty text-[13px] text-destructive" data-testid="ask-problem">
          {state.problem}
        </p>
      ) : null}
    </div>
  );
}

/** What the screen says for an ask made at `askedAt`, in words ("You asked 2 hours ago"). */
export function askedMessage(askedAt: string): string {
  const d = new Date(askedAt);
  const when = Number.isNaN(d.getTime()) ? '' : ` ${formatDistanceToNow(d, { addSuffix: true })}`;
  return `You asked${when}. Your HOD can see you are free.`;
}

export function AskForPapers({ api, scope }: { api: PaperAsksApi; scope: string }) {
  const qc = useQueryClient();
  const key = ['paper-ask-mine', scope] as const;
  const mine = useQuery({ queryKey: key, queryFn: api.mine, retry: false, staleTime: 30_000 });
  const [message, setMessage] = useState<string | null>(null);
  const ask = useMutation({
    mutationFn: api.ask,
    onSuccess: (outcome) => {
      setMessage(askOutcomeMessage(outcome));
      void qc.invalidateQueries({ queryKey: key });
    },
  });

  const off = (mine.isError && isNotSwitchedOn(mine.error)) || (ask.isError && isNotSwitchedOn(ask.error));
  let state: AskState;
  if (off) state = { kind: 'off' };
  else if (message) state = { kind: 'asked', message };
  else if (mine.data) state = { kind: 'asked', message: askedMessage(mine.data) };
  else state = { kind: 'ready', problem: ask.isError ? askFailureMessage(ask.error) : null };

  return <AskForPapersView state={state} busy={ask.isPending} onAsk={() => ask.mutate()} />;
}
