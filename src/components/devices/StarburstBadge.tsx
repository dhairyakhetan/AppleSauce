import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Device C — Starburst / scalloped badge.
 * Reference: Glassdoor "WE WON" (blue starburst), bitesized ("Sale!" burst,
 * green ticket), ThriftHaus (scalloped circles), Classico (orange scalloped disc).
 *
 * A burst or scallop-edged disc holding one to three words, tilted, usually
 * overlapping a corner. Use for "Free", "New this week", "No commission",
 * counts — never for anything the user must read carefully, since the shape
 * eats horizontal room.
 */
export interface StarburstBadgeProps {
  children: ReactNode;
  variant?: 'burst' | 'scallop';
  color?: string;
  textColor?: string;
  tilt?: number;
  /** Rendered size in px. Keep >= 44 if it ever becomes interactive. */
  size?: number;
  className?: string;
}

/** 12-point star polygon, generated once rather than per render. */
const BURST_POINTS = (() => {
  const pts: string[] = [];
  const spikes = 12;
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? 50 : 41;
    const a = (Math.PI / spikes) * i - Math.PI / 2;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(2)}% ${(50 + r * Math.sin(a)).toFixed(2)}%`);
  }
  return pts.join(', ');
})();

export function StarburstBadge({
  children,
  variant = 'burst',
  color = 'hsl(var(--brand-blue))',
  textColor = '#FFFFFF',
  tilt = -8,
  size = 84,
  className,
}: StarburstBadgeProps) {
  const isBurst = variant === 'burst';
  return (
    <span
      className={cn(
        'inline-grid place-items-center text-center font-display leading-none',
        className
      )}
      style={{
        width: size,
        height: size,
        background: color,
        color: textColor,
        transform: `rotate(${tilt}deg)`,
        clipPath: isBurst ? `polygon(${BURST_POINTS})` : undefined,
        borderRadius: isBurst ? undefined : '50%',
        // Scallop reads as a disc with a notched ring rather than a star.
        boxShadow: isBurst ? undefined : `0 0 0 4px ${color}, 0 0 0 7px hsl(var(--foreground))`,
      }}
    >
      <span className="px-2 text-label uppercase">{children}</span>
    </span>
  );
}
