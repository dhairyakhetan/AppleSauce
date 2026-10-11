import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Device P — Bento tile with oversized tabular numeral.
 * Reference: BBBank, Stoken wallet, the saving-goal dashboard, the marathon app.
 *
 * A flat colored tile with a small label and a very large tabular number.
 * This is a CRISP-surface device (VISUAL_DIRECTION.md §4 — dashboards' tiles
 * "may be bento-colored and use big tabular numbers, that IS Cluster C"), so
 * no rotation/outline/grain here — color-blocking and scale carry it.
 *
 * Use on all three dashboards, the home stat cluster, and paper/teacher
 * counts in first folds.
 */
export interface BentoTileProps {
  /** The big number/stat. Rendered in the display face with tabular numerals. */
  value: ReactNode;
  label: ReactNode;
  /** Any CSS color — a token or `getSubjectPalette().tint`/`.solid`. */
  background?: string;
  /** Text color for `value` and `label`. Defaults to near-black. */
  textColor?: string;
  /** Small leading icon/badge shown above the label. */
  icon?: ReactNode;
  /** Optional pill toggle rendered in the tile's top-right corner. */
  toggle?: ReactNode;
  className?: string;
}

export function BentoTile({
  value,
  label,
  background = 'hsl(var(--warm-muted, var(--muted)))',
  textColor = 'hsl(var(--foreground))',
  icon,
  toggle,
  className,
}: BentoTileProps) {
  return (
    <div
      className={cn(
        'relative flex flex-col justify-between gap-3 rounded-2xl p-5 min-h-[44px]',
        className
      )}
      style={{ background, color: textColor }}
    >
      {toggle && <div className="absolute right-3 top-3">{toggle}</div>}
      {icon && <div className="flex-none">{icon}</div>}
      <div className="flex flex-col gap-1">
        <span className="font-display font-black tabular-nums leading-none text-[clamp(1.75rem,1.4rem+1.6vw,3rem)]">
          {value}
        </span>
        <span className="text-label uppercase tracking-wide font-semibold opacity-80">
          {label}
        </span>
      </div>
    </div>
  );
}
