import { Maximize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DIAGRAM_CHECK_LINE, diagramHeading, type DiagramItem } from '@/lib/checker-diagrams';

/* The diagram that belongs to the question being checked, shown right beside the picture of its words,
   with no tap needed (owner, 6 November 2026). A tap on one enlarges it in the same viewer the crop uses.
   Renders nothing when the question has no stored diagram. It sits on a white sheet so it reads like the
   printed paper, and it never grows past a fixed height: the question's own picture keeps the room. */
export function QuestionDiagrams({
  items,
  onEnlarge,
  className,
}: {
  items: DiagramItem[];
  onEnlarge: (src: string, alt: string) => void;
  className?: string;
}) {
  if (items.length === 0) return null;
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
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            onClick={() => onEnlarge(it.url, it.alt)}
            aria-label={`Enlarge: ${it.alt}`}
            data-testid="diagram-item"
            className="group relative flex min-w-0 max-w-full cursor-zoom-in justify-center rounded-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <img src={it.url} alt={it.alt} className="block h-auto max-h-[30vh] w-auto max-w-full object-contain" />
            <span aria-hidden="true" className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white text-foreground shadow-sm">
              <Maximize2 className="h-3 w-3" />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
