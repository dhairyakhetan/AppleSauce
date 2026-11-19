import { MathText } from '@/components/papers/math-text';
import { normaliseOptions, type RawOption } from '@/lib/checker-options';

/* Multiple-choice options, read-only and verbatim, in printed order, so an
   mcq_malformed flag can actually be checked against the paper. Text goes
   through MathText like the public paper page (options may hold LaTeX).
   Handles both stored shapes (see checker-options.ts). */
export function OptionList({ options }: { options: RawOption[] | null | undefined }) {
  const shown = normaliseOptions(options);
  if (shown.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1" aria-label="Answer options">
      {shown.map((o, i) => (
        <li key={i} className="flex gap-2 text-[14px] leading-relaxed text-foreground">
          {o.label ? (
            <span className="font-semibold">{o.label}</span>
          ) : (
            <span aria-hidden="true" className="mt-[9px] h-1 w-1 flex-none rounded-full bg-warm-label" />
          )}
          <MathText text={o.text} className="min-w-0 flex-1" />
        </li>
      ))}
    </ul>
  );
}
