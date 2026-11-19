import { toast } from 'sonner';
import { logger } from '@/utils/logger';

/* One way for a background read to fail out loud.

   Many reads (footer copy, subjects, guide topics, the home quote rail) used to
   destructure only `data`, so a refused or failed request looked exactly like an
   empty result: a blank list and no clue anything went wrong. These helpers are
   the shared pattern:

   - `unwrap` for react-query query functions: throws the Supabase error so the
     query lands in `isError` and the page can show its retry.
   - `reportLoadError` for plain effects: logs, and shows ONE toast per
     `context` per window with an optional Retry action, so a failure that
     repeats on every route change does not stack toasts. */

const WINDOW_MS = 30_000;
const lastShown = new Map<string, number>();

export interface LoadErrorOptions {
  /** Plain words for what failed, completing "Couldn't load ...". */
  what: string;
  /** Re-runs the read. Adds a Retry button to the toast when given. */
  retry?: () => void;
}

export function reportLoadError(context: string, error: unknown, opts: LoadErrorOptions): boolean {
  logger.error(context, error);
  const now = Date.now();
  const prev = lastShown.get(context);
  if (prev !== undefined && now - prev < WINDOW_MS) return false;
  lastShown.set(context, now);
  toast.error(`Couldn't load ${opts.what}`, {
    description: 'Check your connection and try again.',
    action: opts.retry ? { label: 'Retry', onClick: opts.retry } : undefined,
  });
  return true;
}

/** Throws when a Supabase response carries an error; otherwise returns its data. */
export function unwrap<T>(res: { data: T; error: { message?: string } | null }): T {
  if (res.error) throw res.error;
  return res.data;
}

/** Test seam: forget which contexts have already toasted. */
export function resetLoadErrorWindow() {
  lastShown.clear();
}
