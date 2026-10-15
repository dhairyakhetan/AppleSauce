import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

/* A dropdown in Shikshaq's look, for the Chapters page's board, class and subject: a pill that opens an anchored panel
   (scales and fades in from the pill, shorter on the way out), with the options that have chapters first and, for long
   lists, a search box. Arrow keys, Home and End move, Enter picks, Escape closes; without a search box, typing a letter
   jumps to the first option starting with it. */

export interface PickerOption {
  value: string;
  label: string;
  /** Shown on the right, e.g. "12 chapters". */
  meta?: string;
  /** On the list: shown first, under its own heading. */
  on?: boolean;
}

const EASE = 'ease-[cubic-bezier(0.2,0,0,1)]';

export function Picker({ label, value, options, onPick, searchable = false, className }: {
  /** What it picks ("Board"): its accessible name, and the search box's placeholder. */
  label: string;
  value: string;
  options: PickerOption[];
  onPick: (value: string) => void;
  searchable?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const id = useId();

  // options on the list first, then the rest, each as given; a search keeps those whose name has it
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const xs = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
    return [...xs.filter((o) => o.on), ...xs.filter((o) => !o.on)];
  }, [options, query]);
  const sections = useMemo(() => {
    const on = shown.filter((o) => o.on);
    const off = shown.filter((o) => !o.on);
    return [
      { title: 'On the list', items: on, from: 0 },
      { title: on.length ? 'Not on the list yet' : '', items: off, from: on.length },
    ].filter((s) => s.items.length);
  }, [shown]);
  const current = options.find((o) => o.value === value);

  const show = (i: number) => {
    setActive(i);
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' }));
  };
  const toggle = (o: boolean) => {
    setOpen(o);
    if (!o) return;
    setQuery('');
    const all = [...options.filter((x) => x.on), ...options.filter((x) => !x.on)];
    const at = Math.max(0, all.findIndex((x) => x.value === value));
    setActive(at);
    // the chosen one in the middle of the panel when it opens
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-i="${at}"]`)?.scrollIntoView({ block: 'center' }));
  };
  const choose = (o: PickerOption) => {
    onPick(o.value);
    setOpen(false);
  };
  const onKey = (e: KeyboardEvent) => {
    const last = shown.length - 1;
    if (e.key === 'ArrowDown') { e.preventDefault(); show(Math.min(last, active + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); show(Math.max(0, active - 1)); }
    else if (e.key === 'Home' && !searchable) { e.preventDefault(); show(0); }
    else if (e.key === 'End' && !searchable) { e.preventDefault(); show(last); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) choose(shown[active]); }
    else if (!searchable && e.key.length === 1 && /\S/.test(e.key)) {
      const k = e.key.toLowerCase();
      const order = [...shown.keys()].map((i) => (active + 1 + i) % shown.length);
      const hit = order.find((i) => shown[i].label.toLowerCase().startsWith(k) || shown[i].label.toLowerCase().replace(/^class /, '').startsWith(k));
      if (hit !== undefined) show(hit);
    }
  };
  const optionId = (i: number) => `${id}-o${i}`;

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={toggle}>
      <PopoverPrimitive.Trigger asChild>
        <button type="button" aria-haspopup="listbox" aria-label={`${label}: ${current?.label ?? 'none'}`}
          className={cn('group inline-flex h-11 max-w-full items-center gap-2 rounded-full bg-card pl-4 pr-3 text-[14px] font-semibold text-foreground ring-1 ring-border',
            `transition-[transform,box-shadow] duration-150 ${EASE} hover:ring-warm-hairline active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand data-[state=open]:ring-2 data-[state=open]:ring-brand`, className)}>
          <span className="truncate">{current?.label ?? label}</span>
          <ChevronDown aria-hidden className={`size-4 shrink-0 text-warm-meta transition-transform duration-200 ${EASE} group-data-[state=open]:rotate-180`} />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content align="start" sideOffset={8} collisionPadding={16}
          onOpenAutoFocus={(e) => { e.preventDefault(); (searchRef.current ?? listRef.current)?.focus({ preventScroll: true }); }}
          className={cn('z-50 flex w-[min(20rem,calc(100vw-32px))] flex-col rounded-[24px] bg-card p-1.5 text-foreground outline-none',
            'shadow-[0_0_0_1px_hsl(var(--border)),0_18px_44px_rgba(0,0,0,.18)] origin-[--radix-popover-content-transform-origin]',
            `data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:duration-200 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 ${EASE}`,
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.98] data-[state=closed]:duration-150')}>
          {searchable && (
            <div className="relative mb-1.5">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-warm-meta" />
              <input ref={searchRef} value={query} onChange={(e) => { setQuery(e.target.value); setActive(0); }} onKeyDown={onKey}
                role="combobox" aria-expanded aria-controls={`${id}-list`} aria-activedescendant={shown[active] ? optionId(active) : undefined}
                aria-label={`Search: ${label.toLowerCase()}`} placeholder={`Search ${label.toLowerCase()}s`} autoComplete="off" spellCheck={false}
                className="h-10 w-full rounded-[18px] bg-muted pl-9 pr-3 text-base text-foreground placeholder:text-warm-label outline-none focus-visible:ring-2 focus-visible:ring-brand sm:text-[14px]" />
            </div>
          )}
          <div ref={listRef} id={`${id}-list`} role="listbox" aria-label={label} tabIndex={searchable ? -1 : 0} onKeyDown={searchable ? undefined : onKey}
            aria-activedescendant={!searchable && shown[active] ? optionId(active) : undefined}
            className="scrollbar-slim max-h-[min(50vh,320px)] overflow-y-auto overscroll-contain outline-none">
            {sections.map((s) => (
              <div key={s.title || 'rest'} role="group" aria-label={s.title || undefined}>
                {s.title && <p aria-hidden className="px-3 pb-1 pt-2 text-[12px] font-semibold text-warm-meta">{s.title}</p>}
                {s.items.map((o, j) => {
                  const i = s.from + j;
                  const picked = o.value === value;
                  return (
                    <div key={o.value} id={optionId(i)} data-i={i} role="option" aria-selected={picked} onPointerMove={() => active !== i && setActive(i)} onClick={() => choose(o)}
                      className={cn('flex min-h-10 cursor-pointer select-none items-center gap-2 rounded-[18px] px-3 text-[14px] transition-colors duration-100',
                        i === active ? 'bg-muted' : 'bg-transparent', picked ? 'font-semibold text-foreground' : 'text-warm-prose')}>
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      {o.meta && <span className="shrink-0 text-[12px] font-normal tabular-nums text-warm-meta">{o.meta}</span>}
                      <Check aria-hidden className={cn('size-4 shrink-0 text-brand transition-opacity duration-150', picked ? 'opacity-100' : 'opacity-0')} />
                    </div>
                  );
                })}
              </div>
            ))}
            {!shown.length && <p className="px-3 py-3 text-[14px] text-warm-meta">Nothing called "{query.trim()}".</p>}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
