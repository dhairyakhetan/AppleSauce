import { cn } from '@/lib/utils';
import { AdminPillButton } from '@/components/admin/AdminPillButton';

/* The three non-success states every async admin surface needs (CRAFT 4):
   loading, error and empty. Success is the page's own content.

   - AdminLoading is a skeleton in the FINAL layout, so nothing jumps when the
     data arrives. Show it on the first load only: refetching after an action
     patches the row and refreshes quietly, it never re-skeletons the page.
   - AdminError says what did not load and offers Try again. It is the ONLY
     thing to show when a read failed. A failed read is never "nothing yet".
   - AdminEmpty is for a read that SUCCEEDED and returned nothing. It says why
     and offers a next step. Never render it from an error branch. */

export type AdminLoadingShape = 'table' | 'tiles' | 'cards' | 'rows';

export function AdminLoading({
  shape = 'rows',
  rows,
  label = 'Loading',
  className,
}: {
  shape?: AdminLoadingShape;
  /** How many rows, cards or tiles. Defaults to the usual size for the shape. */
  rows?: number;
  label?: string;
  className?: string;
}) {
  const n = rows ?? (shape === 'tiles' ? 3 : shape === 'cards' ? 3 : 5);
  const items = Array.from({ length: n }, (_, i) => i);
  return (
    <div role="status" aria-label={label} aria-busy="true" className={cn('animate-pulse motion-reduce:animate-none', className)}>
      {shape === 'tiles' ? (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {items.map((i) => (
            <div key={i} className="h-[78px] rounded-2xl bg-muted" />
          ))}
        </div>
      ) : shape === 'cards' ? (
        <div className="space-y-3">
          {items.map((i) => (
            <div key={i} className="h-28 rounded-[18px] bg-muted" />
          ))}
        </div>
      ) : shape === 'table' ? (
        <div>
          <div className="mb-2 h-8 rounded-xl bg-muted" />
          <div className="space-y-2">
            {items.map((i) => (
              <div key={i} className="h-12 rounded-xl bg-muted/70" />
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((i) => (
            <div key={i} className="h-14 rounded-2xl bg-muted" />
          ))}
        </div>
      )}
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** "the applications" -> "The applications did not load." */
export function errorSentence(what: string): string {
  const t = what.trim().replace(/[.!?]+$/, '');
  if (!t) return 'This did not load.';
  return `${t.charAt(0).toUpperCase()}${t.slice(1)} did not load.`;
}

export function AdminError({
  what,
  onRetry,
  detail,
  className,
}: {
  /** The thing that failed, as a noun phrase: "the applications". */
  what: string;
  onRetry: () => void;
  /** Optional second line, e.g. what is still safe to do. */
  detail?: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-start gap-3 rounded-[18px] bg-destructive/10 px-4 py-4 sm:flex-row sm:items-center sm:justify-between', className)}
    >
      <div className="min-w-0">
        <p className="text-[15px] font-bold text-destructive">{errorSentence(what)}</p>
        <p className="mt-0.5 text-[13px] leading-[1.5] text-warm-secondary">
          {detail ?? 'Nothing was changed. Check your connection and try again.'}
        </p>
      </div>
      <AdminPillButton variant="secondary" size="sm" onClick={onRetry} className="shrink-0">
        Try again
      </AdminPillButton>
    </div>
  );
}

export interface AdminEmptyAction {
  label: string;
  onClick: () => void;
}

export function AdminEmpty({
  title,
  hint,
  action,
  className,
}: {
  title: string;
  hint?: string;
  action?: AdminEmptyAction;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-4 py-8 text-center', className)}>
      <p className="text-[15px] font-bold text-foreground">{title}</p>
      {hint ? <p className="mt-1 max-w-md text-pretty text-[13px] leading-[1.5] text-warm-secondary">{hint}</p> : null}
      {action ? (
        <div className="mt-3">
          <AdminPillButton variant="secondary" size="sm" onClick={action.onClick}>
            {action.label}
          </AdminPillButton>
        </div>
      ) : null}
    </div>
  );
}
