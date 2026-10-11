import { cn } from '@/lib/utils';

/* A segmented filter: one chip per view, each carrying ITS OWN count. This is
   where per-view counts live (the nav badge is the headline, tiles are only for
   figures the chips do not show).

   - The chips are `aria-pressed` buttons, `min-h-10` (40px).
   - A chip whose `count` is undefined shows "?": the count is unknown, which is
     not the same as 0. Pass `noCount` on a chip that has no number by design.
   - When the applied chip is not the default, a "Clear filter" button appears
     so the filter is visible and one tap undoes it. */

export interface AdminFilterChip {
  key: string;
  label: string;
  /** undefined = unknown, shown as "?". 0 is a real zero and is shown. */
  count?: number;
  /** A chip that has no count by design (for example "All"). */
  noCount?: boolean;
  /** Plain-words meaning, shown on hover and read by screen readers. */
  hint?: string;
}

export function chipCountText(chip: Pick<AdminFilterChip, 'count' | 'noCount'>): string | null {
  if (chip.noCount) return null;
  return typeof chip.count === 'number' ? String(chip.count) : '?';
}

export function AdminFilterChips({
  chips,
  value,
  onChange,
  onClear,
  defaultValue,
  label = 'Filter',
  className,
}: {
  chips: AdminFilterChip[];
  value: string;
  onChange: (key: string) => void;
  /** Called by the "Clear filter" button. Omit to hide the button. */
  onClear?: () => void;
  /** The chip that means "no filter". Defaults to the first chip. */
  defaultValue?: string;
  /** Accessible name for the group. */
  label?: string;
  className?: string;
}) {
  const base = defaultValue ?? chips[0]?.key;
  const applied = value !== base;
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
        {chips.map((c) => {
          const on = c.key === value;
          const count = chipCountText(c);
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={on}
              title={c.hint}
              onClick={() => onChange(c.key)}
              className={cn(
                'relative inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] transition-colors duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                on ? 'bg-panel font-bold text-background' : 'bg-muted font-semibold text-warm-secondary hover:bg-warm-hairline',
              )}
            >
              {c.label}
              {count !== null ? (
                <span
                  className={cn(
                    'inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-full px-[5px] text-[11px] font-bold tabular-nums',
                    on ? 'bg-background/20 text-background' : 'bg-card text-warm-secondary',
                  )}
                  aria-label={count === '?' ? 'count unknown' : undefined}
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      {applied && onClear ? (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex min-h-10 items-center rounded-full px-3 text-[13px] font-bold text-brand-blue hover:bg-brand-blue-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Clear filter
        </button>
      ) : null}
    </div>
  );
}
