import type { Draft, Issue } from '@/lib/games/format';
import { cn } from '@/lib/utils';
import { LINKISH, plural } from './helpers';

/* "Your questions", beside the box on Write questions: every question as it will be sent, in its own scrolling column,
   each marked ready (with the games it plays in) or with what to fix, one sentence per problem, each with a link to its
   line. Lines that aren't questions are listed first. "To fix" shows only the questions that need something. */

export type ListFilter = 'all' | 'fix';

export function QuestionList({ drafts, problems, blocked, other, games, fromExample, onGoTo, filter, setFilter, className }: {
  drafts: Draft[];
  /** Each question's problems to show now (by its index), else none. */
  problems: Map<number, Issue[]>;
  /** The questions that can't be sent as they are (shown problems or not yet: one still being written). */
  blocked: Set<number>;
  /** Problems on lines that aren't part of a question. */
  other: Issue[];
  games: (d: Draft) => string[];
  /** A question from "Try an example", which isn't sent. */
  fromExample: (d: Draft) => boolean;
  onGoTo: (line: number) => void;
  filter: ListFilter;
  setFilter: (f: ListFilter) => void;
  className?: string;
}) {
  const toFix = drafts.filter((_, i) => blocked.has(i)).length;
  const ready = drafts.length - toFix;
  const shown = drafts.map((d, i) => ({ d, i })).filter(({ i }) => filter === 'all' || blocked.has(i));
  const tab = (f: ListFilter, label: string, n: number) => (
    <button type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
      className={cn('flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-bold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
        filter === f ? 'bg-card text-foreground' : 'text-warm-secondary hover:text-foreground')}>
      {label}
      <span className={cn('inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-full px-[5px] text-[11px] font-bold tabular-nums',
        f === 'fix' && n > 0 ? 'bg-destructive text-destructive-foreground' : 'bg-muted text-warm-secondary', filter === f && f === 'all' && 'bg-muted')}>{n}</span>
    </button>
  );

  return (
    <section aria-labelledby="list-h" className={cn('flex min-h-0 flex-col gap-3 rounded-[24px] bg-muted p-4 sm:p-6', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="list-h" className="text-[15px] font-bold text-foreground">Your questions</h2>
          <p className="text-[13px] text-warm-secondary" role="status" aria-live="polite">
            {drafts.length ? <>{ready} ready{toFix > 0 && <>, <b className="text-destructive">{toFix} to fix</b></>}</> : 'As you paste or type, each question shows here.'}
          </p>
        </div>
        {drafts.length > 0 && (
          <div className="flex items-center gap-1 rounded-full bg-background/60 p-1">
            {tab('all', 'All', drafts.length)}
            {tab('fix', 'To fix', toFix)}
          </div>
        )}
      </div>

      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-1">
        {other.length > 0 && (
          <div className="mb-2 rounded-2xl bg-destructive/10 p-3 text-[13px] text-foreground">
            <p className="font-bold">{plural(other.length, 'line', 'lines')} to fix or remove</p>
            <ul className="mt-1 flex flex-col gap-1">
              {other.slice(0, 20).map((x) => (
                <li key={`${x.line}\u0000${x.text}`}><button type="button" className={LINKISH} onClick={() => onGoTo(x.line)}>Line {x.line}</button>: {x.text}</li>
              ))}
              {other.length > 20 && <li className="text-warm-secondary">and {other.length - 20} more</li>}
            </ul>
          </div>
        )}

        {!drafts.length ? (
          <p className="rounded-2xl bg-card px-4 py-10 text-center text-[14px] text-warm-secondary">No questions yet.</p>
        ) : !shown.length ? (
          <p className="rounded-2xl bg-card px-4 py-10 text-center text-[14px] text-warm-secondary">Nothing to fix.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {shown.map(({ d, i }) => {
              const xs = problems.get(i) ?? [];
              const bad = blocked.has(i);
              const plays = !bad ? games(d) : [];
              return (
                <li key={`${d.line}\u0000${d.question}`} className={cn('flex gap-3 rounded-2xl bg-card p-3 sm:p-4', bad && 'ring-1 ring-destructive/40')}>
                  <span aria-hidden className={cn('mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-bold tabular-nums', bad ? 'bg-destructive/10 text-destructive' : 'bg-mint text-foreground')}>{i + 1}</span>
                  <div className="min-w-0 flex-1 text-[14px]">
                    <p className="break-words text-foreground">{d.question || <i className="text-warm-secondary">No question yet</i>}</p>
                    {d.answer && (
                      <p className="mt-0.5 break-words font-semibold text-foreground">
                        {d.answer}
                        {d.also.length > 0 && <span className="font-normal text-warm-meta"> · also {d.also.join(', ')}</span>}
                        {d.level && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 align-middle text-[11px] font-semibold text-warm-secondary">{d.level}</span>}
                      </p>
                    )}
                    {d.fill && <p className="mt-1 break-words text-[12px] text-warm-meta">Fill: {d.fill}</p>}
                    {d.wrong.length > 0 && <p className="break-words text-[12px] text-warm-meta">Wrong: {d.wrong.join(' · ')}</p>}
                    {xs.length > 0 ? (
                      <ul className="mt-2 flex flex-col gap-1 rounded-xl bg-destructive/10 px-3 py-2 text-[13px] text-foreground">
                        {xs.map((x) => (
                          <li key={`${x.line}\u0000${x.text}`}><button type="button" className={LINKISH} onClick={() => onGoTo(x.line)}>Line {x.line}</button>: {x.text}</li>
                        ))}
                      </ul>
                    ) : bad ? (
                      <p className="mt-2 text-[12px] text-warm-secondary">Still being written.</p>
                    ) : fromExample(d) ? (
                      <p className="mt-2 text-[12px] text-warm-secondary">From the example, so it isn't sent.</p>
                    ) : (
                      <p className="mt-2 text-[12px] font-semibold text-success-subtle-text">Ready{plays.length ? ` · plays in ${plays.join(', ')}` : ''}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
