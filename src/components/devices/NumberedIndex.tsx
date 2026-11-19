import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Device L — Numbered index with per-item color.
 * Reference: Design Project Brief (01 Context, 02 Audience… each a different
 * color), Gift Guide (numbered hotspots), Chuckle.
 *
 * A list where each item's number is oversized and individually colored.
 * Use on HowItWorks steps, FAQ, Help, the JoinApply wizard steps.
 */
export interface NumberedIndexItem {
  key: string;
  title: ReactNode;
  description?: ReactNode;
  /** Any CSS color for this item's number — a token or `getSubjectPalette().solid`. */
  color?: string;
}

export interface NumberedIndexProps {
  items: NumberedIndexItem[];
  className?: string;
  /** Zero-pads numbers to 2 digits ("01", "02"...). Defaults on. */
  padNumbers?: boolean;
}

export function NumberedIndex({ items, className, padNumbers = true }: NumberedIndexProps) {
  return (
    <ol className={cn('flex flex-col', className)}>
      {items.map((item, i) => {
        const n = padNumbers ? String(i + 1).padStart(2, '0') : String(i + 1);
        return (
          <li
            key={item.key}
            className="flex items-start gap-4 border-b border-warm-hairline py-6 last:border-b-0"
          >
            <span
              aria-hidden="true"
              className="flex-none font-display font-black leading-none tabular-nums text-[clamp(2.25rem,1.9rem+1.75vw,3.5rem)]"
              style={{ color: item.color ?? 'hsl(var(--brand))' }}
            >
              {n}
            </span>
            <div className="flex flex-col gap-1 pt-2">
              <h3 className="text-subsection font-semibold text-foreground">{item.title}</h3>
              {item.description && (
                <p className="text-body-secondary text-warm-secondary">{item.description}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
