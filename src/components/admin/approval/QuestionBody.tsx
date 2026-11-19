import type { ReactNode } from 'react';
import { MathText } from '@/components/papers/math-text';
import { marksShownInText, showQuestionInstructions } from '@/lib/bank-paper-display';
import { displayBodyWithoutDuplicateNumber } from '@/lib/checker-body';
import type { ReviewOption } from '@/lib/admin-approval-shape';

/* One question drawn the way a visitor sees it on /past-papers/:id
   (BankPaper.tsx's question card): the blue number badge, the marks pill
   unless the paper prints its own, question instructions in italics, the
   body through MathText (verbatim, never altered), the options with a dot
   marker (never re-lettered) and the figure from the paper-figures bucket.
   Used for the current question on the review page and for "View" on an
   older version. */

/** The paper-figures bucket's public URL for a figure path, built the way
 *  supabase.storage.getPublicUrl builds it (no network call). Kept free of
 *  the Supabase client so this component renders in a unit test. */
function figureUrl(path: string): string {
  const base = String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '');
  return `${base}/storage/v1/object/public/paper-figures/${path.replace(/^\/+/, '')}`;
}

export function QuestionBody({
  number,
  marks,
  instructions,
  body,
  options,
  figure,
  chips,
  className,
}: {
  number: string | null;
  marks: number | null;
  instructions: string | null;
  body: string;
  options: ReviewOption[];
  figure: string | null;
  /** Extra chips on the meta line (state pill, version). */
  chips?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {number ? (
          <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-blue px-1.5 text-[12px] font-extrabold tabular-nums text-white">
            {number}
          </span>
        ) : null}
        {marks !== null && !marksShownInText(marks, body) ? (
          <span className="rounded-full bg-card px-2 py-0.5 text-[12px] font-bold tabular-nums text-foreground shadow-border">
            {marks} {marks === 1 ? 'mark' : 'marks'}
          </span>
        ) : null}
        {chips}
      </div>
      {showQuestionInstructions(instructions) ? (
        <MathText text={instructions as string} className="mb-1.5 text-[13px] italic leading-[1.5] text-warm-secondary" />
      ) : null}
      {body.trim() ? (
        <MathText text={displayBodyWithoutDuplicateNumber(body, number)} className="text-[15px] leading-[1.6] text-foreground" />
      ) : (
        <p className="text-[14px] italic text-warm-label">This question has no text.</p>
      )}
      {options.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {options.map((o, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden="true" className="mt-[9px] h-1 w-1 flex-none rounded-full bg-warm-label" />
              <MathText
                text={o.label ? `(${o.label}) ${o.text}` : o.text}
                className="text-[14px] leading-[1.55] text-warm-prose"
              />
            </li>
          ))}
        </ul>
      ) : null}
      {figure ? (
        <figure className="mt-2.5">
          <img
            src={figureUrl(figure)}
            alt={`Figure for question ${number ?? ''}`.trim()}
            loading="lazy"
            decoding="async"
            className="max-h-[300px] w-auto max-w-full rounded-[12px] bg-card p-2 shadow-border"
          />
        </figure>
      ) : null}
    </div>
  );
}
