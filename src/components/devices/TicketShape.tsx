import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Device Q — Ticket / coupon shape.
 * Reference: bitesized ("RESERVE YOUR SEAT" green ticket), Classico.
 *
 * A rectangle with semicircular notches bitten out of the left and right
 * edges, plus an optional dashed tear line at a caller-supplied position.
 * Use on the WhatsApp CTA, "request a paper", teacher application CTA.
 */
export interface TicketShapeProps {
  children: ReactNode;
  /** Any CSS color — a token or `getSubjectPalette().solid`. */
  background?: string;
  textColor?: string;
  /** Notch radius in px. */
  notchRadius?: number;
  /** Position (0-1, left to right) of the dashed tear line. Omit for none. */
  tearAt?: number;
  className?: string;
}

export function TicketShape({
  children,
  background = 'hsl(var(--brand))',
  textColor = '#FFFFFF',
  notchRadius = 12,
  tearAt,
  className,
}: TicketShapeProps) {
  return (
    <div
      className={cn('ticket-notched relative outline-thick min-h-[44px]', className)}
      style={{
        background,
        color: textColor,
        ['--notch-radius' as string]: `${notchRadius}px`,
        ['--outline-color' as string]: 'hsl(var(--foreground))',
      }}
    >
      <div className="flex items-center gap-4 px-6 py-4">{children}</div>
      {tearAt !== undefined && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-0 bottom-0 border-l-2 border-dashed opacity-60"
          style={{ left: `${tearAt * 100}%`, borderColor: textColor }}
        />
      )}
    </div>
  );
}
