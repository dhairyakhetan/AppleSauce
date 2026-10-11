import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/* The one tab control for the admin. It replaces the hand-rolled tablists
   (36px targets, no arrow keys, no panel link) and drives the ?view= tabs.

   Pattern: WAI-ARIA tabs with automatic activation.
   - roving tabindex: only the selected tab is in the Tab order
   - Left/Right move and select, Home/End jump to the first/last
   - every tab has aria-controls pointing at the single tabpanel, and the panel
     is labelled by the selected tab
   - each tab is 40px tall with a `before:-inset-1` hit extension

   The caller keeps the state (usually the URL's ?view=) and passes `value` and
   `onChange`. `count` shows a small badge when above 0; `null` shows "?" for an
   unknown count; undefined shows nothing. */

export interface AdminTabItem {
  key: string;
  label: string;
  count?: number | null;
}

/** The tab a key press moves to, or null when the key is not a tab key. Pure. */
export function nextTabKey(keys: string[], current: string, pressed: string): string | null {
  if (keys.length === 0) return null;
  const i = Math.max(0, keys.indexOf(current));
  if (pressed === 'ArrowRight') return keys[(i + 1) % keys.length];
  if (pressed === 'ArrowLeft') return keys[(i - 1 + keys.length) % keys.length];
  if (pressed === 'Home') return keys[0];
  if (pressed === 'End') return keys[keys.length - 1];
  return null;
}

export function AdminTabs({
  tabs,
  value,
  onChange,
  label,
  children,
  className,
}: {
  tabs: AdminTabItem[];
  value: string;
  onChange: (key: string) => void;
  /** Accessible name for the tablist. */
  label: string;
  /** The selected tab's content. Wrapped in the tabpanel. */
  children?: ReactNode;
  className?: string;
}) {
  const uid = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabId = (k: string) => `${uid}-tab-${k}`;
  const panelId = `${uid}-panel`;
  const keys = tabs.map((t) => t.key);

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const next = nextTabKey(keys, value, e.key);
    if (!next) return;
    e.preventDefault();
    onChange(next);
    refs.current[next]?.focus();
  }

  return (
    <div className={className}>
      <div className="max-w-full overflow-x-auto">
        <div role="tablist" aria-label={label} className="inline-flex items-center gap-1 rounded-full bg-muted p-1">
          {tabs.map((t) => {
            const on = t.key === value;
            return (
              <button
                key={t.key}
                ref={(el) => {
                  refs.current[t.key] = el;
                }}
                id={tabId(t.key)}
                role="tab"
                type="button"
                aria-selected={on}
                aria-controls={panelId}
                tabIndex={on ? 0 : -1}
                onClick={() => onChange(t.key)}
                onKeyDown={onKeyDown}
                className={cn(
                  'relative inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-[13px] font-bold transition-colors duration-150 before:absolute before:-inset-1 before:content-[""] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  on ? 'bg-card text-foreground' : 'text-warm-secondary hover:text-foreground',
                )}
              >
                {t.label}
                {t.count === null ? (
                  <span className="inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-card px-[5px] text-[11px] font-bold text-warm-secondary" aria-label="count unknown">
                    ?
                  </span>
                ) : typeof t.count === 'number' && t.count > 0 ? (
                  <span className="inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-brand px-[5px] text-[11px] font-bold tabular-nums text-foreground">
                    {t.count}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
      <div id={panelId} role="tabpanel" aria-labelledby={tabId(value)} tabIndex={0} className="mt-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {children}
      </div>
    </div>
  );
}
