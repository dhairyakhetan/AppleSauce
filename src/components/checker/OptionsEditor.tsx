import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Undo2, X } from 'lucide-react';
import { addOption, moveOption, removeOption, updateOption, type EditableOption } from '@/lib/option-editing';
import { restoreOption } from '@/lib/checker-options';
import { cn } from '@/lib/utils';

/* The answer options as boxes you can change: the words and (for label-and-text options) the label, add, remove and
   move up or down. Shared by the HOD desk (Needs you and the ready-to-go-live editor) and the checker's Fix it.
   Controlled: the parent holds the rows (lib/option-editing.ts) and sends only what changed.

   Phone first (audit, 26 Nov 2026): at 375px the words box was squeezed to about 90px and Remove sat right next to
   Move down. Now, below `sm`, the words have the whole first line and the move and remove buttons sit on a second line,
   with Remove set apart at the far end; from `sm` up it is one row as before. A removed option can be put back with
   one tap (Undo), so a slip never loses words. */

const FIELD =
  'min-h-11 md:min-h-[40px] rounded-xl bg-card px-3 py-1 text-[16px] sm:text-[14px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus';
const ICON =
  'inline-flex h-11 w-11 md:h-10 md:w-10 flex-none items-center justify-center rounded-full bg-card text-warm-secondary transition-colors hover:bg-warm-hairline hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-disabled';

export function OptionsEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: EditableOption[];
  onChange: (next: EditableOption[]) => void;
  disabled?: boolean;
}) {
  // The option removed last, and where it was, so Undo can put it back.
  // `after` is the list the removal produced: once the list is anything else (another change, a new question), the
  // Undo is gone, so it can never put an option into a list it did not come from.
  const [removedState, setRemoved] = useState<{ option: EditableOption; index: number; after: EditableOption[] } | null>(null);
  const removed = removedState && removedState.after === value ? removedState : null;
  // Any other change ends the chance to undo the removal (the list it belonged to has moved on).
  const change = (next: EditableOption[]) => {
    setRemoved(null);
    onChange(next);
  };
  const remove = (o: EditableOption, index: number) => {
    const after = removeOption(value, o.id);
    onChange(after);
    setRemoved({ option: o, index, after });
  };
  const undoRemove = () => {
    if (!removed) return;
    onChange(restoreOption(value, removed.option, removed.index));
    setRemoved(null);
  };
  const removedWords = removed ? removed.option.text.trim() || removed.option.label.trim() : '';

  return (
    <section className="mt-3" aria-label="Answer options" data-testid="options-editor">
      <p className="mb-1.5 text-[13px] font-medium text-warm-secondary">
        {value.length > 0 ? 'Answer options (change the words, add, remove or move them)' : 'This question has no answer options.'}
      </p>
      <ul className="space-y-2">
        {value.map((o, i) => (
          <li key={o.id} className="flex flex-col gap-1.5 sm:flex-row sm:items-center" data-testid="option-row">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              {o.shape === 'object' ? (
                <input
                  value={o.label}
                  onChange={(ev) => change(updateOption(value, o.id, { label: ev.target.value }))}
                  disabled={disabled}
                  aria-label={`Label of option ${i + 1}`}
                  className={cn(FIELD, 'w-14 flex-none text-center font-semibold')}
                />
              ) : null}
              <input
                value={o.text}
                onChange={(ev) => change(updateOption(value, o.id, { text: ev.target.value }))}
                disabled={disabled}
                aria-label={`Words of option ${i + 1}`}
                className={cn(FIELD, 'min-w-0 flex-1')}
              />
            </div>
            <div className="flex items-center gap-1.5" data-testid="option-row-tools">
              <button type="button" className={ICON} disabled={disabled || i === 0} onClick={() => change(moveOption(value, o.id, -1))} aria-label={`Move option ${i + 1} up`}>
                <ArrowUp className="h-4 w-4" aria-hidden />
              </button>
              <button
                type="button"
                className={ICON}
                disabled={disabled || i === value.length - 1}
                onClick={() => change(moveOption(value, o.id, 1))}
                aria-label={`Move option ${i + 1} down`}
              >
                <ArrowDown className="h-4 w-4" aria-hidden />
              </button>
              {/* Set apart from the move buttons, so a slip of the thumb does not remove an option. */}
              <button
                type="button"
                className={cn(ICON, 'ml-auto sm:ml-3')}
                disabled={disabled}
                onClick={() => remove(o, i)}
                aria-label={`Remove option ${i + 1}`}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </li>
        ))}
      </ul>
      {removed ? (
        <div role="status" className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-brand-subtle px-3 py-1.5 text-[13px] text-foreground" data-testid="option-removed">
          <span className="min-w-0 flex-1">
            Option removed{removedWords ? `: ${removedWords.length > 40 ? `${removedWords.slice(0, 40)}...` : removedWords}` : ''}.
          </span>
          <button
            type="button"
            onClick={undoRemove}
            disabled={disabled}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-card px-3.5 text-[13px] font-bold text-foreground transition-colors hover:bg-warm-hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-disabled md:min-h-10"
            data-testid="option-undo-remove"
          >
            <Undo2 className="h-4 w-4" aria-hidden />
            Undo
          </button>
        </div>
      ) : null}
      <button
        type="button"
        disabled={disabled}
        onClick={() => change(addOption(value))}
        className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-card px-3.5 text-[13px] font-bold text-foreground transition-colors hover:bg-warm-hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-disabled md:min-h-10"
        data-testid="option-add"
      >
        <Plus className="h-4 w-4" aria-hidden />
        Add an option
      </button>
    </section>
  );
}
