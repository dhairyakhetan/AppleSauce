import type { ReactNode } from 'react';
import { Pencil, Scissors } from 'lucide-react';
import { MathText } from '@/components/papers/math-text';
import { BodyEditor } from '@/components/checker/BodyEditor';
import { OptionList } from '@/components/checker/OptionList';
import { TypedBadge } from '@/components/checker/Panels';
import { cn } from '@/lib/utils';
import type { RawOption } from '@/lib/checker-options';

/* The part card (owner, 12 Oct 2026: "allow me to edit at the top, why two
   sections"). ONE card holds the words the computer typed for the part being
   checked: it is read-only to begin with, and Fix it turns the same card into
   the editor in place, same text, same position, with a clear ring and an
   "Editing" badge. Split turns the same card into the place where you tap to
   choose where the second question starts. The formula keypad opens inside it.

   Pure presentation: the screen owns every piece of state and passes it in. */

const BADGE = 'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-bold text-foreground';

export type PartCardMode = 'read' | 'edit' | 'split';

export function PartCard({
  mode,
  body,
  options,
  /** The "lost text" heading, when the words are the AI's reading of the page. */
  lostHeading,
  disabled,
  /** The little chip that opens "What the computer changed" (null when there is nothing to show). */
  changesChip,
  /** The opened list, shown under the top row. */
  changesPanel,
  /** The "Computer 92% sure" pill, shown next to the Typed badge (null when the computer gave no number). */
  sureChip,
  /** Edit: the new text of the body. */
  onBody,
  editorKey,
  formulaRequest,
  onFormulaHandled,
  /** Edit: number and marks boxes, the typo box and the notes, under the words in the same card. */
  editFooter,
  /** Split: the instruction, the caret box and the preview. */
  splitBody,
  splitFooter,
  /** The highlight pair is on this card. False while the view has been moved to another part to look at its picture. */
  focused = true,
  /** Tapping a calm card brings the highlight pair back to it (a view aid only). */
  onFocus,
}: {
  mode: PartCardMode;
  body: string;
  options: RawOption[] | null | undefined;
  lostHeading?: string | null;
  disabled?: boolean;
  changesChip?: ReactNode;
  changesPanel?: ReactNode;
  sureChip?: ReactNode;
  onBody?: (next: string) => void;
  editorKey?: number;
  formulaRequest?: number;
  onFormulaHandled?: () => void;
  editFooter?: ReactNode;
  splitBody?: ReactNode;
  splitFooter?: ReactNode;
  focused?: boolean;
  onFocus?: () => void;
}) {
  // Editing and splitting always keep the ring: that is where the typing happens.
  const calm = mode === 'read' && !focused;
  const editing = mode === 'edit';
  const badges = (
    <>
      {/* While editing on a short phone the "Editing" chip is what matters; the provenance chips return when the edit ends. */}
      <span className={cn('contents', editing && '[@media(max-height:699px)]:hidden')}>
        <TypedBadge />
        {sureChip ?? null}
      </span>
      {editing ? (
        <span className={cn(BADGE, 'bg-brand')} data-testid="editing-badge">
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          Editing
        </span>
      ) : null}
      {mode === 'split' ? (
        <span className={cn(BADGE, 'bg-brand')} data-testid="splitting-badge">
          <Scissors className="h-3.5 w-3.5" aria-hidden="true" />
          Splitting
        </span>
      ) : null}
      {lostHeading ? <span className="text-[12px] font-semibold text-warm-meta">{lostHeading}</span> : null}
      {changesChip ? <span className={cn(!editing && 'ml-auto')}>{changesChip}</span> : null}
    </>
  );
  return (
    <section
      aria-label="The part you are checking"
      data-testid="part-card"
      data-tour="question"
      data-mode={mode}
      data-focused={focused ? 'true' : undefined}
      onClick={calm ? onFocus : undefined}
      className={cn(
        'mb-3 shrink-0 rounded-[10px] bg-white transition-shadow duration-150',
        // Always outlined in the brand colour, so the eye lands on the checked part among the calm rest; editing adds a soft ring.
        calm ? 'cursor-pointer border-2 border-warm-hairline' : 'border-2 border-brand',
        mode !== 'read' && 'ring-2 ring-brand/30',
      )}
    >
      <div className="p-3">
        {editing ? (
          <BodyEditor
            key={editorKey}
            variant="card"
            leading={badges}
            afterHeader={changesPanel}
            value={body}
            onChange={onBody ?? (() => undefined)}
            disabled={disabled}
            formulaRequest={formulaRequest}
            onFormulaHandled={onFormulaHandled}
            textareaClassName="rounded-[6px] bg-transparent p-0 text-[18px] leading-relaxed"
          />
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 [@media(max-width:399px)]:gap-x-1.5">{badges}</div>
            {changesPanel}
            {mode === 'split' ? (
              splitBody
            ) : (
              <MathText text={body} className="break-words text-[18px] leading-relaxed text-foreground" />
            )}
          </>
        )}
        <OptionList options={options} />
      </div>
      {editing && editFooter ? <div className="flex flex-col gap-2 border-t border-warm-hairline px-3 py-2.5">{editFooter}</div> : null}
      {mode === 'split' && splitFooter ? <div className="border-t border-warm-hairline px-3 pb-3 pt-1">{splitFooter}</div> : null}
    </section>
  );
}
