import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Row } from '@/lib/games/rows';
import { LINKISH } from './helpers';

/* What the games pages share on screen: the grouped table of rows, loading, failure and empty states, and the icon that
   becomes a check mark. The plain helpers (button looks, dates, saving a file, "Undo") are in helpers.ts. */

/** An icon that turns into a check mark for a moment after the action worked, without changing the button's size. */
export function ActionIcon({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <span className="relative inline-grid size-4 place-items-center" aria-hidden>
      <span className={cn('col-start-1 row-start-1 transition-opacity duration-150', done && 'opacity-0')}>{children}</span>
      <span className={cn('col-start-1 row-start-1 transition-opacity duration-150', !done && 'opacity-0')}><Check /></span>
    </span>
  );
}

/** The rows as they will be stored, grouped under a heading for each chapter and topic. */
export function RowsTable<R extends Row>({ rows, keyOf = (_r, i) => i, extra, rowClass }: {
  rows: R[];
  /** A stable key per row, so rows that leave or arrive don't disturb the others. */
  keyOf?: (r: R, i: number) => string | number;
  /** Buttons or a note shown under a row (the HoD desk). */
  extra?: (r: R) => ReactNode;
  rowClass?: (r: R) => string;
}) {
  // rows rise in as they are added: on the first render one after another, briefly; later only a new row
  const first = useRef(true);
  useEffect(() => { first.current = false; }, []);
  const delay = (n: number): CSSProperties | undefined => (first.current ? { animationDelay: `${Math.min(n, 6) * 40}ms` } : undefined);
  let shown = 0;
  const out: ReactNode[] = [];
  let chapter = '';
  let topic = '';
  rows.forEach((r, i) => {
    const ch = [r.chapter_id, r.board, r.class, r.subject, r.chapter_no, r.chapter].join('\u0000');
    if (ch !== chapter || i === 0) {
      chapter = ch;
      topic = '';
      const title = r.chapter || r.chapter_no !== null ? [r.chapter_no !== null && `Chapter ${r.chapter_no}`, r.chapter].filter(Boolean).join(': ') : 'No chapter';
      const meta = [r.board, r.class && `Class ${r.class}`, r.subject].filter(Boolean).join(' · ');
      out.push(
        <div className="animate-fade-slide-up flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pt-3 first:pt-0" style={delay(shown++)} key={`c${i}`}>
          <span className="text-[15px] font-bold text-foreground">{title}</span>
          {meta && <span className="text-[12px] text-warm-meta">{meta}</span>}
        </div>,
      );
    }
    const tp = `${r.topic_no}\u0000${r.topic}`;
    if (tp !== topic) {
      topic = tp;
      const has = r.topic || r.topic_no !== null;
      out.push(
        <div className="animate-fade-slide-up mt-1 border-b border-border pb-1 pt-2" style={delay(shown++)} key={`t${i}`}>
          <span className={cn('text-[12px] font-bold uppercase tracking-[0.06em]', has ? 'text-warm-secondary' : 'text-warm-label')}>
            {has ? [r.topic_no !== null && `Topic ${r.topic_no}`, r.topic].filter(Boolean).join(': ') : 'No topic'}
          </span>
        </div>,
      );
    }
    out.push(
      <div
        className={cn('animate-fade-slide-up grid grid-cols-[1.75rem_1fr] gap-x-2 gap-y-1 border-b border-border/70 py-2 transition-opacity duration-200 sm:grid-cols-[1.75rem_minmax(0,3fr)_minmax(0,2fr)_auto]', rowClass?.(r))}
        style={delay(shown++)}
        key={keyOf(r, i)}
      >
        <span className="pt-0.5 text-right text-[12px] tabular-nums text-warm-meta">{r.question_no}</span>
        <span className="min-w-0 break-words text-[14px] text-foreground">{r.question}</span>
        <span className="col-start-2 min-w-0 break-words text-[14px] font-semibold text-foreground sm:col-start-auto">
          {r.answer}
          {r.wrong_options?.length > 0 && <span className="block text-[12px] font-normal text-warm-meta">Wrong: {r.wrong_options.join(' · ')}</span>}
        </span>
        {r.difficulty ? (
          <span className={cn('col-start-2 h-fit w-fit self-start rounded-full px-2 py-0.5 text-[11px] font-semibold sm:col-start-auto',
            r.difficulty === 'easy' ? 'bg-success-subtle-bg text-success-subtle-text' : r.difficulty === 'medium' ? 'bg-brand-subtle text-brand-deep' : 'bg-brand-blue-subtle text-brand-blue-deep')}>
            {r.difficulty}
          </span>
        ) : <span className="hidden sm:block" />}
        {extra && <div className="col-span-full pl-9 sm:col-start-2">{extra(r)}</div>}
      </div>,
    );
  });
  return <div>{out}</div>;
}

/** The page's loading block: the shape of a list, not a spinner. */
export function Loading({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-muted" />)}
    </div>
  );
}

/** Something didn't load: say so plainly, with a way to try again. */
export function LoadFailed({ what, error, onRetry }: { what: string; error: string; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-2xl bg-destructive/10 px-4 py-4 text-[14px] text-foreground">
      <p><b>{what} did not load.</b> {error}</p>
      <button type="button" onClick={onRetry} className={cn(LINKISH, 'mt-1')}>Try again</button>
    </div>
  );
}

/** A plain note for "nothing here yet". */
export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl bg-muted px-4 py-8 text-center text-[14px] text-warm-secondary">{children}</div>;
}
