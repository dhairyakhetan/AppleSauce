import { format } from 'date-fns';
import { buildTimeline } from '@/lib/question-timeline';
import type { QuestionHistoryRow } from '@/lib/team-dashboard-api';
import { AdminError } from '@/components/admin/AdminState';
import { cn } from '@/lib/utils';

/**
 * Owner Round 6: "a neat per-question tracker" -- vertical, plain words,
 * who/what/when, a before-after diff for a fix. Pure presentation: the
 * caller fetches the rows (admin_question_history via
 * team-dashboard-api.ts) and passes them in, so this same component works
 * for the real page and for dummy-mode fixtures.
 *
 * It has no heading of its own: it sits in an AdminDialog titled "History for
 * question {id}". Three states are told apart: loading, a failed read (with
 * Try again), and a successful read that found nothing. A failed read must
 * never read as "no history".
 */
export function QuestionTimeline({
  rows,
  loading,
  error,
  onRetry,
}: {
  rows: QuestionHistoryRow[];
  loading?: boolean;
  /** The read failed. Shown instead of the empty message. */
  error?: boolean;
  onRetry?: () => void;
}) {
  const timeline = buildTimeline(rows);

  return (
    <div>
      {loading ? (
        <div className="space-y-2" role="status" aria-label="Loading the history">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-2xl bg-muted motion-reduce:animate-none" />
          ))}
        </div>
      ) : error ? (
        <AdminError what="this question's history" onRetry={onRetry ?? (() => undefined)} />
      ) : timeline.length === 0 ? (
        <p className="rounded-2xl bg-muted p-4 text-[13px] text-warm-secondary">
          Nothing logged yet for this question. Anything from before this dashboard shipped has no history here.
        </p>
      ) : (
        <ol className="relative space-y-4 border-l border-warm-hairline pl-5">
          {timeline.map((entry, i) => (
            <li key={i} className="relative">
              <span
                className={cn('absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full', entry.paperLevel ? 'bg-brand-blue' : 'bg-brand')}
                aria-hidden
              />
              <p className="text-[12px] text-warm-meta">{format(new Date(entry.at), 'd MMM yyyy, h:mm a')}</p>
              <p className="text-[14px] font-semibold text-foreground">
                {entry.who} &middot; {entry.what}
              </p>
              {entry.paperLevel ? (
                <span className="mt-0.5 inline-block rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-warm-label">
                  Whole paper
                </span>
              ) : null}
              {entry.detail ? <p className="mt-0.5 text-[13px] text-warm-secondary">{entry.detail}</p> : null}
              {entry.diff ? <TimelineDiff before={entry.diff.before} after={entry.diff.after} /> : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function jsonText(v: unknown): string {
  if (v === null || v === undefined) return '(none)';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function TimelineDiff({ before, after }: { before: unknown; after: unknown }) {
  const beforeText = jsonText(before);
  const afterText = jsonText(after);
  if (beforeText === afterText) return null;
  return (
    <div className="mt-1.5 grid gap-1.5 text-[12px] sm:grid-cols-2">
      <div className={cn('rounded-xl bg-destructive/5 p-2')}>
        <p className="mb-0.5 font-semibold text-warm-label">Before</p>
        <p className="break-words text-warm-secondary">{beforeText}</p>
      </div>
      <div className={cn('rounded-xl bg-success-subtle-bg p-2')}>
        <p className="mb-0.5 font-semibold text-warm-label">After</p>
        <p className="break-words text-warm-secondary">{afterText}</p>
      </div>
    </div>
  );
}
