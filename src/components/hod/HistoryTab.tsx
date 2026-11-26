// Decided 2026-10-12: History shows absolute dates; every other HOD tab shows relative times ("3 hours ago"). Keep it that way.
import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { EmptyNote, ListSkeleton, LoadError } from '@/components/hod/HodShared';
import { historyByPaper, historyPeople, historyView } from '@/lib/hod-desk';
import { ACTION_LABELS, markUndone } from '@/lib/history-labels';
import { HISTORY_ROLES, memberName, roleWord, type HistoryRow, type HodApi } from '@/lib/hod-api';
import { TEAM_KEY } from '@/components/hod/VerifiersTab';
import { actionToneClass } from '@/lib/checker-button-styles';

/* "History": what HODs, admins and verifiers did, newest first, visible to
   every HOD and admin. Filter by person and by role; "Load older" asks for the
   page before the oldest row on screen (hod_action_history p_before).

   Search by paper (26 Nov 2026) looks through the rows already loaded, and says
   so; "Load older" brings more in to search. The Person list has the checkers
   and every HOD or admin who appears in the rows read so far (there is no list
   of HODs and admins to read on its own). */

export const HISTORY_PAGE = 100;

function when(iso: string): string {
  try {
    return format(parseISO(iso), 'd MMM, h:mm a');
  } catch {
    return iso;
  }
}

/** The sentence for a row: the server's meaning, else our label, else the code in words. */
export function historyText(r: HistoryRow): string {
  const label = ACTION_LABELS[r.action];
  if (label) {
    try {
      const q = r.question_number ? `question ${r.question_number}` : 'a question';
      return label({ q, on: r.question_number ? ` on ${q}` : '', changes: null, verdict: '', conf: '', toVersion: '' });
    } catch {
      /* fall through */
    }
  }
  // Never the code in words ("hod unassign"): an unknown code reads as a plain change.
  return r.meaning ?? 'made a change (details are in the admin log)';
}

export function HistoryTab({ api, scope }: { api: HodApi; scope: string }) {
  const [actor, setActor] = useState('');
  const [role, setRole] = useState('');
  const [paperQ, setPaperQ] = useState('');
  /** Everyone seen acting in the history so far, kept when a filter narrows the rows, so the Person list does not shrink. */
  const [seen, setSeen] = useState<{ id: string; name: string | null; role: string | null }[]>([]);
  const teamQ = useQuery({ queryKey: TEAM_KEY(scope), queryFn: () => api.team(), staleTime: 15_000, refetchOnMount: true });
  const q = useInfiniteQuery({
    queryKey: ['hod', scope, 'history', actor, role],
    queryFn: ({ pageParam }) => api.history({ actor: actor || null, role: role || null, before: pageParam ?? null, limit: HISTORY_PAGE }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.length >= HISTORY_PAGE ? last[last.length - 1].at : undefined),
    staleTime: 0,
    refetchOnMount: true,
  });

  const rowsAll = q.data?.pages.flat() ?? [];
  const view = historyView({ hasData: q.data !== undefined, isError: q.isError, rowCount: rowsAll.length });
  const rows = historyByPaper(rowsAll, paperQ);
  const searching = paperQ.trim() !== '';
  useEffect(() => {
    const found = (q.data?.pages.flat() ?? []).filter((r) => r.actor_id).map((r) => ({ id: r.actor_id as string, name: r.actor_name, role: r.actor_role }));
    if (found.length === 0) return;
    setSeen((cur) => {
      const ids = new Set(cur.map((s) => s.id));
      const add: typeof cur = [];
      for (const f of found) {
        if (ids.has(f.id)) continue;
        ids.add(f.id);
        add.push(f);
      }
      return add.length > 0 ? [...cur, ...add] : cur;
    });
  }, [q.data]);
  const people = historyPeople(
    (teamQ.data ?? []).map((m) => ({ user_id: m.user_id, label: memberName(m) })),
    seen,
    roleWord,
  );
  const select = 'min-h-11 md:min-h-10 rounded-full bg-muted px-3 text-[16px] sm:text-[13px] font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus';

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[13px] font-semibold text-warm-secondary">
          Person
          <select value={actor} onChange={(e) => setActor(e.target.value)} className={select}>
            <option value="">Everyone</option>
            {people.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-[13px] font-semibold text-warm-secondary">
          Role
          <select value={role} onChange={(e) => setRole(e.target.value)} className={select}>
            {HISTORY_ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="relative block min-w-0 flex-1 sm:min-w-[14rem]">
          <span className="sr-only">Search by paper</span>
          <input
            type="search"
            value={paperQ}
            onChange={(e) => setPaperQ(e.target.value)}
            placeholder="Search by paper"
            className="min-h-11 md:min-h-10 w-full rounded-full bg-muted px-4 text-[16px] sm:text-[13px] text-foreground outline-none placeholder:text-warm-meta focus-visible:ring-2 focus-visible:ring-focus"
            data-testid="history-paper-search"
          />
        </label>
      </div>
      {searching && view === 'rows' ? (
        <p role="status" className="mb-3 text-[13px] text-warm-secondary" data-testid="history-search-note">
          {rows.length === 1 ? '1 row matches' : `${rows.length} rows match`} in the {rowsAll.length} loaded.
          {q.hasNextPage ? ' Load older at the bottom to search further back.' : ''}
        </p>
      ) : null}

      {view === 'loading' ? (
        <ListSkeleton label="Loading history" />
      ) : view === 'error' ? (
        <LoadError what="The history" onRetry={() => void q.refetch()} />
      ) : view === 'empty' ? (
        <EmptyNote>Nothing has been recorded for that choice yet.</EmptyNote>
      ) : (
        <>
          {searching && rows.length === 0 ? <EmptyNote>No loaded row is about a paper like that.</EmptyNote> : null}
          <ol className="space-y-3" aria-label="History, newest first">
            {rows.map((r, i) => (
              <li key={`${r.at}-${i}`} className="rounded-[18px] bg-muted shadow-card p-4 text-[14px]" data-testid="history-row">
                <p className="text-foreground">
                  <span className="font-semibold">{r.actor_name ?? 'Someone'}</span>
                  {r.actor_role ? <span className="ml-1 text-[12px] text-warm-meta">({roleWord(r.actor_role)})</span> : null} {markUndone(historyText(r), r.undone)}
                  {r.paper_label ? <span className="text-warm-secondary"> in {r.paper_label}</span> : null}
                </p>
                {r.note ? <p className="text-[13px] text-warm-secondary">Note: {r.note}</p> : null}
                <p className="text-[12px] text-warm-meta">{when(r.at)}</p>
              </li>
            ))}
          </ol>
          {q.isError ? (
            <p role="alert" className="mt-3 rounded-2xl bg-destructive/10 px-4 py-3 text-center text-[13px] text-foreground">
              The older history did not load. What is above is still here.
            </p>
          ) : null}
          {q.hasNextPage ? (
            <div className="mt-4 text-center">
              <button type="button" className={actionToneClass('muted')} disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
                {q.isFetchingNextPage ? 'Loading...' : q.isError ? 'Try again' : 'Load older'}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
