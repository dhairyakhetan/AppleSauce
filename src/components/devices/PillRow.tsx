import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Device M — Colored pill row with leading badge.
 * Reference: Events Calendar (date badge + colored pill per row), BBBank, the
 * marathon app.
 *
 * A stack of full-width rounded pills, each a different color, each led by a
 * small contrasting badge holding a number or short code. Directly fixes the
 * flat `flex-wrap` pill wall pattern — use this instead of a bare chip grid
 * for class/board pill walls on the papers shelf, subject lists, dashboard
 * rows. Crisp-surface device (M is on the §4 permitted list) — no rotation.
 */
export interface PillRowItem {
  key: string;
  /** Short code/number shown in the leading badge, e.g. "IX", "01", "A". */
  badge: ReactNode;
  label: ReactNode;
  meta?: ReactNode;
  /** Any CSS color — a token or `getSubjectPalette().solid`. */
  color?: string;
  textColor?: string;
  onClick?: () => void;
  href?: string;
}

export interface PillRowProps {
  items: PillRowItem[];
  className?: string;
  /** 'stack' (default) is the full-width row-per-item layout this device was
   *  built for. 'grid' packs items into a dense wrapped grid instead — for
   *  long, low-information lists (e.g. 12 class numbers) where a full-width
   *  row per item is mostly empty space repeated twelve times. Meta text is
   *  dropped in grid mode since there's no room for a second line. */
  layout?: 'stack' | 'grid';
}

export function PillRow({ items, className, layout = 'stack' }: PillRowProps) {
  if (layout === 'grid') {
    return (
      <ul className={cn('grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4', className)}>
        {items.map((item) => {
          const Tag = (item.onClick || item.href ? 'button' : 'div') as 'button' | 'div';
          return (
            <li key={item.key}>
              <Tag
                type={Tag === 'button' ? 'button' : undefined}
                onClick={item.onClick}
                className={cn(
                  'flex min-h-11 w-full items-center gap-2 rounded-lg px-2.5 py-1.5',
                  'text-left transition-[transform,box-shadow] duration-hover',
                  item.color
                    ? 'outline-thick'
                    : (item.onClick || item.href) && 'hover:-translate-y-0.5 shadow-border hover:shadow-border-hover active:scale-[0.97]',
                  item.color && (item.onClick || item.href) && 'hover:-translate-y-0.5 active:scale-[0.97]'
                )}
                style={{
                  background: item.color ?? 'hsl(var(--warm-muted, var(--muted)))',
                  color: item.textColor ?? 'hsl(var(--foreground))',
                }}
              >
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-white/90 font-display font-bold tabular-nums text-[11px] text-foreground"
                >
                  {item.badge}
                </span>
                <span className="truncate text-sm font-semibold">{item.label}</span>
              </Tag>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <ul className={cn('flex flex-col gap-2', className)}>
      {items.map((item) => {
        const Tag = (item.onClick || item.href ? 'button' : 'div') as 'button' | 'div';
        return (
          <li key={item.key}>
            <Tag
              type={Tag === 'button' ? 'button' : undefined}
              onClick={item.onClick}
              className={cn(
                'flex w-full items-center gap-3 rounded-full pl-1.5 pr-4 py-1.5 min-h-[44px]',
                'text-left transition-[transform,box-shadow] duration-hover',
                item.color
                  ? 'outline-thick'
                  : (item.onClick || item.href) && 'hover:-translate-y-0.5 shadow-border hover:shadow-border-hover active:scale-[0.99]',
                item.color && (item.onClick || item.href) && 'hover:-translate-y-0.5 active:scale-[0.99]'
              )}
              style={{
                background: item.color ?? 'hsl(var(--warm-muted, var(--muted)))',
                color: item.textColor ?? 'hsl(var(--foreground))',
              }}
            >
              <span
                aria-hidden="true"
                className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-white/90 font-display font-bold tabular-nums text-sm text-foreground"
              >
                {item.badge}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-card-title font-semibold">{item.label}</span>
                {item.meta && <span className="truncate text-meta opacity-80">{item.meta}</span>}
              </span>
            </Tag>
          </li>
        );
      })}
    </ul>
  );
}
