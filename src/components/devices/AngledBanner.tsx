import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Device R — Angled outlined banner.
 * Reference: Design Flow (green/orange banners tilted with a heavy black
 * outline), Bullet (red angled strips), Mershe.
 *
 * A solid colour bar with a heavy black outline, rotated a few degrees,
 * carrying display type. Two stacked at opposing angles is the signature
 * treatment — pass alternating `tilt` values.
 *
 * This is the fastest route to a first fold that isn't boring, which is
 * exactly what VISUAL_DIRECTION.md §9a asks for. Because the ground stays
 * light, `color` should be a SATURATED token value, not a tint.
 */
export interface AngledBannerProps {
  children: ReactNode;
  /** Any CSS colour — pass a token (`hsl(var(--brand))`) or a subject palette value. */
  color?: string;
  /** Text colour sitting on `color`. Defaults to white. */
  textColor?: string;
  /** Rotation in degrees. Keep within ±4 so type stays readable. */
  tilt?: number;
  /** Drops the offset shadow, e.g. when stacking many banners tightly. */
  flat?: boolean;
  className?: string;
}

export function AngledBanner({
  children,
  color = 'hsl(var(--brand))',
  textColor = '#FFFFFF',
  tilt = -2,
  flat = false,
  className,
}: AngledBannerProps) {
  return (
    <span
      className={cn(
        'inline-block px-4 py-1.5 font-display text-section-head leading-none',
        'outline-thick',
        !flat && 'outline-offset-shadow',
        className
      )}
      style={{
        background: color,
        color: textColor,
        transform: `rotate(${tilt}deg)`,
      }}
    >
      {children}
    </span>
  );
}
