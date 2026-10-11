import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Device D — Speech-bubble tag.
 * Reference: pltm ("Community", "This Month's Trends"), the signpost/speech
 * bubble illustration, Linkedist.
 *
 * A small rounded label with a tail, floated around a headline instead of
 * being stacked into a boring subtitle line. Often carries a tiny coloured
 * dot before the text.
 *
 * Purely decorative by default — pass `role="status"` via props only when the
 * content is genuinely live. Never put an interactive control inside one.
 */
export interface SpeechTagProps {
  children: ReactNode;
  /** Where the tail points. */
  tail?: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';
  /** Colour of the leading dot. Omit for no dot. */
  dotColor?: string;
  /** Background of the tag itself. Defaults to the card surface. */
  background?: string;
  tilt?: number;
  className?: string;
}

const TAIL_POSITION: Record<NonNullable<SpeechTagProps['tail']>, string> = {
  'bottom-left': 'left-4 -bottom-1.5',
  'bottom-right': 'right-4 -bottom-1.5',
  'top-left': 'left-4 -top-1.5',
  'top-right': 'right-4 -top-1.5',
};

export function SpeechTag({
  children,
  tail = 'bottom-left',
  dotColor,
  background = 'hsl(var(--card))',
  tilt = 0,
  className,
}: SpeechTagProps) {
  return (
    <span
      className={cn(
        'relative inline-flex items-center gap-1.5 rounded-full px-3 py-1.5',
        'text-meta font-medium text-foreground shadow-border',
        className
      )}
      style={{ background, transform: tilt ? `rotate(${tilt}deg)` : undefined }}
    >
      {dotColor && (
        <span
          aria-hidden="true"
          className="h-2 w-2 flex-none rounded-full"
          style={{ background: dotColor }}
        />
      )}
      {children}
      <span
        aria-hidden="true"
        className={cn('absolute h-3 w-3 rotate-45', TAIL_POSITION[tail])}
        style={{ background }}
      />
    </span>
  );
}
