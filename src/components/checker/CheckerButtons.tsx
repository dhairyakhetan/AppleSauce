import * as React from 'react';
import { actionToneClass, type ActionTone } from '@/lib/checker-button-styles';
import { cn } from '@/lib/utils';

/* The checker's action button, shared by the checker and the practice round.
   No data access in here: the practice round imports this file, and it must
   stay clear of Supabase (see src/lib/checker-practice.ts). */

export function ActionButton({
  tone,
  onClick,
  disabled,
  children,
  tourId,
  className,
  title,
  ariaLabel,
}: {
  tone: ActionTone;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  /** Marks the button for the first-visit walkthrough (data-tour). */
  tourId?: string;
  /** Extra classes, like a width for the phone's action grid. */
  className?: string;
  /** The tooltip: the long name and the key. */
  title?: string;
  /** The full name for a screen reader, when the visible label is short. */
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-tour={tourId}
      title={title}
      aria-label={ariaLabel}
      className={cn(actionToneClass(tone), className)}
    >
      {children}
    </button>
  );
}
