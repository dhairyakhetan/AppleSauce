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
  ariaDisabled,
  testId,
  type = 'button',
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
  /** Looks switched off but still takes a tap, so the screen can say why it is off (a disabled button takes no tap at all). */
  ariaDisabled?: boolean;
  /** data-testid, for tests and the browser checks. */
  testId?: string;
  /** 'submit' inside a form, so Enter in a box presses it. */
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-disabled={ariaDisabled || undefined}
      data-tour={tourId}
      data-testid={testId}
      title={title}
      aria-label={ariaLabel}
      className={cn(actionToneClass(tone), ariaDisabled && 'cursor-not-allowed opacity-disabled active:scale-100', className)}
    >
      {children}
    </button>
  );
}
