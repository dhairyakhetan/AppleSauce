import type { ReactNode } from 'react';
import { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * Device N — Circular rotating text badge.
 * Reference: flylane ("LEARN WITHOUT LIMITS" around a pencil), Sand Studio
 * ("Sand Studio & Co"), Creative Haus ("GO TEAM!").
 *
 * Text set on a circular path around a central icon/element, via SVG
 * `<textPath>`.
 *
 * ⚠️ USAGE CONSTRAINT: **one per page maximum** (REFERENCE_DEVICES.md §N). It
 * is a single "seal" moment — the hero, About, or the footer — never a
 * repeated grid element.
 *
 * ⚠️ MOTION CONSTRAINT: the project bans perpetual ambient motion outside a
 * narrow desktop-only whitelist. This component does NOT auto-spin by
 * default — `spin` is off unless explicitly enabled, and even then it is
 * gated by the caller (intended for a desktop-only wrapper, matching how
 * `sparkle`/`bob` are hard-disabled below 1024px in src/index.css) and is
 * automatically frozen by the universal `prefers-reduced-motion` kill-switch.
 */
export interface CircularTextBadgeProps {
  /** The text repeated/curved around the circle, e.g. "LEARN WITHOUT LIMITS". */
  text: string;
  /** Central content — an icon, initial, or small mark. */
  center?: ReactNode;
  /** Any CSS color — a token or `getSubjectPalette().solid`. */
  color?: string;
  /** Background disc color. Defaults to transparent (text + center only). */
  background?: string;
  /** Rendered size in px (square). */
  size?: number;
  /**
   * Enables a slow continuous rotation. OFF by default per the
   * anti-perpetual-motion rule — only pass `true` from a desktop-only,
   * intentionally-chosen "seal" placement, and even then it is a purely
   * decorative loop that `prefers-reduced-motion` freezes globally.
   */
  spin?: boolean;
  /** Spin duration in seconds when `spin` is true. */
  spinDuration?: number;
  className?: string;
}

export function CircularTextBadge({
  text,
  center,
  color = 'hsl(var(--foreground))',
  background,
  size = 120,
  spin = false,
  spinDuration = 18,
  className,
}: CircularTextBadgeProps) {
  const pathId = useId();
  const radius = 42;
  // Repeat the text with a separator so the ring reads as continuous, the
  // way every cited reference ("GO TEAM! • GO TEAM! •") does it.
  const looped = `${text} • `.repeat(3);

  return (
    <div
      className={cn('relative flex-none', className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        style={spin ? { animation: `spin ${spinDuration}s linear infinite` } : undefined}
      >
        {background && <circle cx="50" cy="50" r="49" fill={background} />}
        <defs>
          <path id={pathId} d={`M 50,50 m -${radius},0 a ${radius},${radius} 0 1,1 ${radius * 2},0 a ${radius},${radius} 0 1,1 -${radius * 2},0`} />
        </defs>
        <text fill={color} fontSize="9" fontWeight={700} letterSpacing="0.5">
          <textPath href={`#${pathId}`} startOffset="0%">
            {looped}
          </textPath>
        </text>
      </svg>
      {center && (
        <div className="absolute inset-0 flex items-center justify-center">
          {center}
        </div>
      )}
    </div>
  );
}
