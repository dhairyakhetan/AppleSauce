import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/* The one admin dialog: a thin wrapper on ui/dialog (Radix), so Escape, focus
   trap and focus return to the opener come for free. It replaces the
   hand-rolled overlays (paper-edit Versions, team history, activity) and gives
   every admin dialog the same 20px radius and the same four sizes.

   - `title` is required: a dialog with no name is not announced.
   - The body scrolls; the header and the `footer` stay put, so a long form
     keeps its Save button on screen on a phone.
   - sizes: sm max-w-md, md max-w-xl, lg max-w-3xl, xl max-w-4xl. */

export type AdminDialogSize = 'sm' | 'md' | 'lg' | 'xl';

export const ADMIN_DIALOG_WIDTH: Record<AdminDialogSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-4xl',
};

export function AdminDialog({
  open,
  onOpenChange,
  title,
  description,
  size = 'md',
  footer,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  size?: AdminDialogSize;
  /** Sticky footer: the Save and Cancel buttons. */
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className={cn(
          'flex max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] flex-col gap-0 overflow-hidden rounded-[20px] border-0 bg-card p-0 sm:rounded-[20px]',
          ADMIN_DIALOG_WIDTH[size],
          className,
        )}
      >
        <div className="shrink-0 px-5 pb-3 pt-5 pr-14">
          <DialogTitle className="text-[19px] font-extrabold leading-[1.25] tracking-[-0.02em] text-foreground">{title}</DialogTitle>
          {description ? <DialogDescription className="mt-1 text-[13px] leading-[1.5] text-warm-secondary">{description}</DialogDescription> : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-warm-hairline bg-card px-5 py-3">{footer}</div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
