import { Clock } from 'lucide-react';
import { partIndent } from '@/lib/bank-paper-display';

/** The placeholder for a held question: its number and one friendly line,
 *  never any of its text (QUEUE_20261002: set-aside, rejected and in-check
 *  questions on a live paper reach the browser as {held: true, number, ord}).
 *  Drawn as a line of the printed paper (number in the margin, a quiet italic
 *  note) so it sits in the sheet instead of looking like a card.
 *  No em or en dashes in the copy. */
export function HeldQuestionCard({ id, number, depth = 0 }: { id: string; number: string | null; depth?: number }) {
  return (
    <li
      id={`q-${id}`}
      data-held="true"
      style={partIndent(depth)}
      className="min-w-0 py-2.5 font-paper text-foreground"
    >
      <div className="flex items-start gap-2.5 sm:gap-3">
        {number ? <span className="min-w-7 text-[15px] font-bold leading-[1.5] tabular-nums sm:min-w-9">{number}</span> : null}
        <p className="flex items-start gap-2 text-[14px] italic leading-[1.5] text-warm-secondary">
          <Clock className="mt-0.5 h-4 w-4 flex-none text-warm-label" aria-hidden="true" />
          This question is not shown right now. It may appear here later.
        </p>
      </div>
    </li>
  );
}
