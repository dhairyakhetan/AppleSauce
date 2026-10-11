import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { adminDestructiveBtnStyle, adminPrimaryBtnStyle, adminSecondaryBtnStyle } from '@/components/AdminConsole';

/* The one admin button. Pages used to hand-write these class strings, which is
   how `min-h-9rounded-full` (two classes glued together, so neither applied)
   got into four files. Pick a variant and a size and the string is built here.

   variant  primary      the one dark filled pill per panel
            secondary    muted pill, the usual second choice
            quiet        text-only, for a low-key action beside a primary
            destructive  tinted red, always last in reading order
   size     md  44px     the default
            sm  40px     inside a row or a tight toolbar; never smaller

   `busy` disables the button and sets aria-busy, so a double tap cannot fire
   the action twice. */

export type AdminPillVariant = 'primary' | 'secondary' | 'quiet' | 'destructive';
export type AdminPillSize = 'md' | 'sm';

const QUIET =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-transparent px-4 text-[13px] font-bold text-brand-blue transition-colors duration-150 hover:bg-brand-blue-subtle active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60';

const VARIANT: Record<AdminPillVariant, string> = {
  primary: adminPrimaryBtnStyle,
  secondary: adminSecondaryBtnStyle,
  quiet: QUIET,
  destructive: adminDestructiveBtnStyle,
};

const SIZE: Record<AdminPillSize, string> = { md: 'min-h-11', sm: 'min-h-10' };

export function adminPillClass(variant: AdminPillVariant = 'secondary', size: AdminPillSize = 'md', className?: string): string {
  return cn(VARIANT[variant], SIZE[size], className);
}

export interface AdminPillButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: AdminPillVariant;
  size?: AdminPillSize;
  busy?: boolean;
}

export const AdminPillButton = forwardRef<HTMLButtonElement, AdminPillButtonProps>(
  ({ variant = 'secondary', size = 'md', busy = false, className, disabled, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={adminPillClass(variant, size, className)}
      {...props}
    />
  ),
);
AdminPillButton.displayName = 'AdminPillButton';
