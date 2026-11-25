import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { addOption, moveOption, removeOption, updateOption, type EditableOption } from '@/lib/option-editing';
import { cn } from '@/lib/utils';

/* The answer options as boxes you can change: the words and (for label-and-text options) the label, add, remove and
   move up or down. Shared by the HOD desk (Needs you and the ready-to-go-live editor) and the checker's Fix it.
   Controlled: the parent holds the rows (lib/option-editing.ts) and sends only what changed. */

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
  return (
    <section className="mt-3" aria-label="Answer options" data-testid="options-editor">
      <p className="mb-1.5 text-[13px] font-medium text-warm-secondary">
        {value.length > 0 ? 'Answer options (change the words, add, remove or move them)' : 'This question has no answer options.'}
      </p>
      <ul className="space-y-2">
        {value.map((o, i) => (
          <li key={o.id} className="flex items-center gap-1.5" data-testid="option-row">
            {o.shape === 'object' ? (
              <input
                value={o.label}
                onChange={(ev) => onChange(updateOption(value, o.id, { label: ev.target.value }))}
                disabled={disabled}
                aria-label={`Label of option ${i + 1}`}
                className={cn(FIELD, 'w-14 flex-none text-center font-semibold')}
              />
            ) : null}
            <input
              value={o.text}
              onChange={(ev) => onChange(updateOption(value, o.id, { text: ev.target.value }))}
              disabled={disabled}
              aria-label={`Words of option ${i + 1}`}
              className={cn(FIELD, 'min-w-0 flex-1')}
            />
            <button type="button" className={ICON} disabled={disabled || i === 0} onClick={() => onChange(moveOption(value, o.id, -1))} aria-label={`Move option ${i + 1} up`}>
              <ArrowUp className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              className={ICON}
              disabled={disabled || i === value.length - 1}
              onClick={() => onChange(moveOption(value, o.id, 1))}
              aria-label={`Move option ${i + 1} down`}
            >
              <ArrowDown className="h-4 w-4" aria-hidden />
            </button>
            <button type="button" className={ICON} disabled={disabled} onClick={() => onChange(removeOption(value, o.id))} aria-label={`Remove option ${i + 1}`}>
              <X className="h-4 w-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(addOption(value))}
        className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-card px-3.5 text-[13px] font-bold text-foreground transition-colors hover:bg-warm-hairline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-disabled md:min-h-10"
        data-testid="option-add"
      >
        <Plus className="h-4 w-4" aria-hidden />
        Add an option
      </button>
    </section>
  );
}
