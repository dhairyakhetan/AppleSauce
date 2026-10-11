import * as React from 'react';
import { actionToneClass, type ActionTone } from '@/lib/checker-button-styles';

/* The checker's action button, shared by the checker and the practice round.
   No data access in here: the practice round imports this file, and it must
   stay clear of Supabase (see src/lib/checker-practice.ts). */

export function ActionButton({
  tone,
  onClick,
  disabled,
  children,
  tourId,
}: {
  tone: ActionTone;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  /** Marks the button for the first-visit walkthrough (data-tour). */
  tourId?: string;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} data-tour={tourId} className={actionToneClass(tone)}>
      {children}
    </button>
  );
}
