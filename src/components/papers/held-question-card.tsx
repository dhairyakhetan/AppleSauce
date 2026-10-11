import { Clock } from 'lucide-react';

/** The placeholder for a held question: its number and one friendly line,
 *  never any of its text (QUEUE_20261002: set-aside, rejected and in-check
 *  questions on a live paper reach the browser as {held: true, number, ord}).
 *  No em or en dashes in the copy. */
export function HeldQuestionCard({ id, number, depth = 0 }: { id: string; number: string | null; depth?: number }) {
  return (
    <li
      id={`q-${id}`}
      data-held="true"
      style={depth > 0 ? { marginLeft: `${Math.min(depth, 3) * 16}px` } : undefined}
      className={`min-w-0 rounded-[18px] bg-muted p-[16px]${depth > 0 ? ' border-l-2 border-border pl-3' : ''}`}
    >
      <div className="flex items-center gap-2">
        {number ? (
          <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-warm-label px-1.5 text-[12px] font-extrabold tabular-nums text-white">
            {number}
          </span>
        ) : null}
        <Clock className="h-4 w-4 flex-none text-warm-label" aria-hidden="true" />
        <p className="text-[14px] leading-[1.5] text-warm-secondary">
          This question is being checked and will appear soon.
        </p>
      </div>
    </li>
  );
}
