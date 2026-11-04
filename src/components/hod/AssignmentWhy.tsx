import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { HodApi } from '@/lib/hod-api';
import { errorWords, reasonMark } from '@/lib/hod-publish';
import { cn } from '@/lib/utils';

/* "Why this paper?": the plain reasons a paper was given (or would be given) to
   one verifier, from explain_assignment: their subject choices, their class and
   board, their school, and how much they already hold. A tick or a cross is
   always backed by words, so colour is never the only signal. */

export function AssignmentWhy({ api, scope, checkerId, paperId }: { api: HodApi; scope: string; checkerId: string; paperId: string }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ['hod', scope, 'why', checkerId, paperId],
    queryFn: () => api.explainAssignment(checkerId, paperId),
    enabled: open,
    staleTime: 60_000,
  });
  return (
    <div className="mt-2 w-full" data-testid="assignment-why">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="tap-44 rounded-full bg-card px-3.5 py-1.5 text-[13px] font-semibold text-brand-blue transition-transform duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {open ? 'Hide the reasons' : 'Why this paper?'}
      </button>
      {open ? (
        <div className="mt-2 rounded-2xl bg-card p-3" aria-live="polite">
          {q.isLoading ? (
            <p className="text-[13px] text-warm-secondary">Working it out...</p>
          ) : q.isError ? (
            <p role="alert" className="text-[13px] text-destructive">
              {errorWords(q.error, 'The reasons did not load. Try again.')}
            </p>
          ) : q.data ? (
            <>
              <p className="text-[14px] font-semibold text-foreground" data-testid="why-summary">
                {q.data.summary || (q.data.eligible ? 'This paper suits them.' : 'This paper cannot go to them.')}
              </p>
              <ul className="mt-2 space-y-1">
                {q.data.reasons.map((r) => (
                  <li key={`${r.key}-${r.text}`} className="flex items-start gap-2 text-[13px] text-foreground">
                    <span
                      aria-hidden
                      className={cn(
                        'mt-1 h-2 w-2 shrink-0 rounded-full',
                        r.ok === true ? 'bg-mint-solid' : r.ok === false ? 'bg-destructive' : 'bg-warm-label',
                      )}
                    />
                    <span>
                      <span className="sr-only">{reasonMark(r.ok)}: </span>
                      {r.text}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
