import * as React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/* The HOD desk's "are you sure?" box. The same promise shape as useConfirm (src/components/ui/use-confirm.tsx), with
   two differences the owner asked for on 26 Nov 2026:

   - the way out says "Cancel", not "Keep it" (on "Hand out 12 papers now?" there is nothing to keep);
   - an everyday action (Auto assign all, Move it) confirms in the normal orange button. The pale red is kept for
     taking something away (Unassign), with `tone: 'danger'`.

   Any dismissal that is not the confirm button (Cancel, Escape, a tap outside) answers no. */

export interface HodConfirmOptions {
  title: string;
  description?: string;
  /** Say what it does, not "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  /** 'brand' (orange, the default) for an everyday action; 'danger' (pale red) for taking something away. */
  tone?: 'brand' | 'danger';
}

/** The orange confirm button: the same fill and edge as the desk's main buttons. */
export const HOD_CONFIRM_BRAND = 'bg-brand text-foreground shadow-solid [--tactile-edge:var(--brand-deep)]';

export function HodConfirmBox({ options, onAnswer }: { options: HodConfirmOptions | null; onAnswer: (yes: boolean) => void }) {
  return (
    <AlertDialog
      open={options !== null}
      onOpenChange={(next) => {
        if (!next) onAnswer(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{options?.title ?? ''}</AlertDialogTitle>
          {options?.description ? <AlertDialogDescription>{options.description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onAnswer(false)}>{options?.cancelLabel ?? 'Cancel'}</AlertDialogCancel>
          <AlertDialogAction
            data-tone={options?.tone ?? 'brand'}
            className={(options?.tone ?? 'brand') === 'brand' ? HOD_CONFIRM_BRAND : undefined}
            onClick={() => onAnswer(true)}
          >
            {options?.confirmLabel ?? ''}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function useHodConfirm() {
  const [pending, setPending] = React.useState<{ options: HodConfirmOptions; resolve: (yes: boolean) => void } | null>(null);
  const confirm = React.useCallback(
    (options: HodConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending({ options, resolve });
      }),
    [],
  );
  const answer = React.useCallback((yes: boolean) => {
    setPending((current) => {
      current?.resolve(yes);
      return null;
    });
  }, []);
  return { confirm, confirmDialog: <HodConfirmBox options={pending?.options ?? null} onAnswer={answer} /> };
}
