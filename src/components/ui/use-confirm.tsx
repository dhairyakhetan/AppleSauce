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

/* A promise-shaped confirm, so `window.confirm` can be replaced without
   restructuring the caller.

   micro-06-non-negotiables rule 4 rules out a browser alert for a confirmation.
   Beyond the rule, window.confirm is unstyled, blocks the whole tab, and on iOS
   Safari prefixes the message with the hostname — so an admin deleting a paper
   read "shikshaq.in says" over a bone-and-orange console.

   The shape is deliberate. Rewriting each caller into open-a-dialog-then-act
   would move the destructive call into a new callback, and these are delete
   paths behind an admin login I cannot sign into to test. Returning a promise
   keeps the guard exactly where it was:

     if (!window.confirm('…')) return;     ->    if (!(await confirm({…}))) return;

   Same early return, same handler body, same order of operations — only the
   dialog implementation differs.

   Dismissing (Cancel, Escape, clicking outside) resolves false, so an
   unanswered dialog can never fall through to the destructive branch. */

export interface ConfirmOptions {
  title: string;
  description?: string;
  /** Label for the destructive action. Say what it does, not "OK". */
  confirmLabel?: string;
  cancelLabel?: string;
}

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

export function useConfirm() {
  const [pending, setPending] = React.useState<PendingConfirm | null>(null);

  const confirm = React.useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending({ options, resolve });
      }),
    [],
  );

  const settle = React.useCallback(
    (value: boolean) => {
      setPending((current) => {
        current?.resolve(value);
        return null;
      });
    },
    [],
  );

  const confirmDialog = (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(next) => {
        /* Any dismissal that is not the confirm button is a "no". */
        if (!next) settle(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{pending?.options.title ?? ''}</AlertDialogTitle>
          {pending?.options.description ? (
            <AlertDialogDescription>{pending.options.description}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>
            {pending?.options.cancelLabel ?? 'Keep it'}
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => settle(true)}>
            {pending?.options.confirmLabel ?? 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, confirmDialog };
}
