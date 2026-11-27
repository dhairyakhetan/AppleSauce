import { useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DIAGRAM_CHECK_LINE, diagramHeading, type DiagramItem } from '@/lib/checker-diagrams';

/* The diagram that belongs to the question being checked, shown with its words, with no tap needed (owner,
   6 November 2026). On the checker screen it sits inside the part card, beside the words on a wide card and
   directly under them on a narrow one (owner, 26 November 2026: "not at the top"; see DiagramBeside in
   PartCard.tsx). A tap on one enlarges it in the same viewer the crop uses.
   Renders nothing when the question has no stored diagram. It sits on a white sheet so it reads like the
   printed paper, and it never grows past a fixed height: the question's own picture keeps the room. */
export const DIAGRAM_LOAD_FAILED = 'The diagram for this question did not load. Use the printed page to check it.';

export function QuestionDiagrams({
  items,
  onEnlarge,
  className,
  failed = false,
}: {
  items: DiagramItem[];
  onEnlarge: (src: string, alt: string) => void;
  className?: string;
  /** The read of the stored diagrams failed (not "there is none"): say so, so a missing diagram is not mistaken for no diagram. */
  failed?: boolean;
}) {
  // A picture that would not load (the file is gone, or the link ran out) is told apart from one that loaded (audit CK-19).
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  if (items.length === 0) {
    return failed ? (
      <p
        role="status"
        data-testid="diagram-load-failed"
        className={cn('rounded-[8px] bg-brand-subtle px-2.5 py-1.5 text-[13px] font-semibold text-foreground', className)}
      >
        {DIAGRAM_LOAD_FAILED}
      </p>
    ) : null;
  }
  return (
    <section
      aria-label={diagramHeading(items.length)}
      data-testid="question-diagrams"
      className={cn('flex min-w-0 shrink-0 flex-col gap-1.5 rounded-[8px] border border-warm-hairline bg-white p-2', className)}
    >
      <div>
        <p className="text-[12px] font-bold text-foreground">{diagramHeading(items.length)}</p>
        <p className="text-[12px] leading-snug text-warm-secondary">{DIAGRAM_CHECK_LINE}</p>
      </div>
      <div className="flex max-h-[46vh] min-w-0 flex-wrap items-start gap-2 overflow-y-auto">
        {items.map((it) =>
          broken.has(it.id) ? (
            <p key={it.id} role="status" data-testid="diagram-item-broken" className="rounded-[6px] bg-brand-subtle px-2.5 py-1.5 text-[13px] font-semibold text-foreground">
              {DIAGRAM_LOAD_FAILED}
            </p>
          ) : (
          <button
            key={it.id}
            type="button"
            onClick={() => onEnlarge(it.url, it.alt)}
            aria-label={`Enlarge: ${it.alt}`}
            data-testid="diagram-item"
            className="group relative flex min-w-0 max-w-full cursor-zoom-in justify-center rounded-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {/* Beside the words (a wide card) it stays short, so the words keep the room and the card does not
                grow much past them. */}
            <img
              src={it.url}
              alt={it.alt}
              onError={() => setBroken((s) => new Set(s).add(it.id))}
              className="block h-auto max-h-[30vh] w-auto max-w-full object-contain [@container(min-width:30rem)]:max-h-[min(30vh,14rem)]"
            />
            <span aria-hidden="true" className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white text-foreground shadow-sm">
              <Maximize2 className="h-3 w-3" />
            </span>
          </button>
          ),
        )}
      </div>
    </section>
  );
}
