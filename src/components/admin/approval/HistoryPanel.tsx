import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, ChevronDown, Cog, GraduationCap, UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';
import { historyLine, shownChanges, type ActorKind } from '@/lib/history-labels';
import type { ApprovalApi, HistoryEvent } from '@/lib/admin-approval-shape';
import { ChangeList } from '@/components/admin/approval/ChangeView';

/* A paper's (or a question's) history as sentences: who did what, and when,
   newest first. "Priya Sharma changed the question text on question 5" with
   the local time under it, and "See what changed" opening a word diff. The
   sentences come from src/lib/history-labels.ts, never from raw codes. */

const KIND_ICON: Record<ActorKind, typeof UserRound> = {
  admin: UserRound,
  student: GraduationCap,
  ai: Bot,
  pipeline: Cog,
};

const KIND_TINT: Record<ActorKind, string> = {
  admin: 'bg-brand-subtle text-brand-deep',
  student: 'bg-brand-blue-subtle text-brand-blue-deep',
  ai: 'bg-mint text-[#24603D]',
  pipeline: 'bg-muted text-warm-secondary',
};

/** Where a line happened, for logs that span papers (the checker log). */
export type PaperRef = { title: string; to: string | null };

export function HistoryItem({ event, now, paper }: { event: HistoryEvent; now?: Date; paper?: PaperRef | null }) {
  const [open, setOpen] = useState(false);
  const { who, what, when, note } = historyLine(event, now);
  const Icon = KIND_ICON[event.actor_kind];
  const changes = shownChanges(event.changes);
  const hasChanges = changes.length > 0;
  return (
    <li className="flex gap-3 py-3">
      <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', KIND_TINT[event.actor_kind])}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-pretty text-[14px] leading-[1.5] text-foreground">
          <span className="font-bold">{who}</span> {what}
        </p>
        <p className="text-[12px] tabular-nums text-warm-meta">
          {when}
          {paper ? (
            <>
              {' · '}
              {paper.to ? (
                <Link to={paper.to} className="font-semibold text-brand-blue hover:text-brand-blue-deep">
                  {paper.title}
                </Link>
              ) : (
                <span className="font-semibold text-warm-secondary">{paper.title}</span>
              )}
            </>
          ) : null}
        </p>
        {note ? (
          <p className="mt-1 rounded-[10px] bg-muted px-2.5 py-1.5 text-[13px] text-warm-prose">
            <span className="font-semibold">Note:</span> {note}
          </p>
        ) : null}
        {hasChanges ? (
          <>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="mt-1 inline-flex min-h-10 items-center gap-1 rounded-full px-1 text-[13px] font-semibold text-brand-blue transition-colors duration-150 hover:text-brand-blue-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {open ? 'Hide what changed' : 'See what changed'}
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-150', open && 'rotate-180')} aria-hidden />
            </button>
            {open ? <ChangeList changes={changes} /> : null}
          </>
        ) : null}
      </div>
    </li>
  );
}

export function HistoryList<E extends HistoryEvent>({
  events,
  now,
  empty,
  paperFor,
}: {
  events: E[];
  now?: Date;
  empty?: string;
  paperFor?: (e: E) => PaperRef | null;
}) {
  if (!events.length) {
    return <p className="rounded-2xl bg-muted p-4 text-[13px] text-warm-secondary">{empty ?? 'Nothing has happened here yet.'}</p>;
  }
  return (
    <ol className="divide-y divide-warm-hairline" aria-label="History, newest first">
      {events.map((e, i) => (
        <HistoryItem key={`${e.at}-${e.action}-${i}`} event={e} now={now} paper={paperFor?.(e) ?? null} />
      ))}
    </ol>
  );
}

const PAGE = 12;

/** The whole paper's history, loaded on open. `reloadKey` refetches after a write. */
export function PaperHistoryPanel({
  api,
  auditPaperId,
  reloadKey = 0,
  now,
}: {
  api: Pick<ApprovalApi, 'paperHistory'>;
  auditPaperId: string;
  reloadKey?: number;
  now?: Date;
}) {
  const [events, setEvents] = useState<HistoryEvent[] | null>(null);
  const [error, setError] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const load = useCallback(async () => {
    setError(false);
    try {
      setEvents(await api.paperHistory(auditPaperId));
    } catch {
      setEvents(null);
      setError(true);
    }
  }, [api, auditPaperId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  if (error) {
    return (
      <div role="alert" className="rounded-2xl bg-muted p-4 text-[13px] text-foreground">
        The history did not load. Check your internet and try again.
        <button type="button" onClick={() => void load()} className="tap-44 ml-2 font-semibold text-brand-blue">
          Try again
        </button>
      </div>
    );
  }
  if (!events) {
    return (
      <div className="space-y-3" role="status" aria-label="Loading the history">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3">
            <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
            <div className="h-10 flex-1 animate-pulse rounded-[12px] bg-muted" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div>
      <HistoryList events={events.slice(0, shown)} now={now} empty="Nothing has happened to this paper yet." />
      {events.length > shown ? (
        <button
          type="button"
          onClick={() => setShown((n) => n + PAGE)}
          className="mt-2 inline-flex min-h-10 items-center rounded-full bg-muted px-4 text-[13px] font-bold text-warm-secondary transition-transform duration-150 hover:bg-warm-hairline active:scale-[0.96]"
        >
          Show {Math.min(PAGE, events.length - shown)} older
        </button>
      ) : null}
    </div>
  );
}
