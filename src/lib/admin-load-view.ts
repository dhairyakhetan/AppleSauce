/* Which of the four states an async admin list should show (CRAFT 4).

   The rule that keeps the layout still:
   - Before the FIRST read has settled, show the skeleton.
   - After that, a refetch never brings the skeleton back. The rows stay on
     screen (and keep focus) and the caller marks the region aria-busy.
   - A failed read is "error", never "empty". If rows from an earlier read are
     still held, they stay visible and the caller shows the error beside them.
   - "empty" is only for a read that succeeded and found nothing. */

export type LoadView = 'skeleton' | 'error' | 'empty' | 'list';

export interface LoadViewInput {
  /** True once a read has finished, whether it worked or not. */
  settled: boolean;
  /** True when the latest read failed. */
  error: boolean;
  /** Rows currently held. */
  count: number;
}

export function loadView({ settled, error, count }: LoadViewInput): LoadView {
  if (!settled) return 'skeleton';
  if (count > 0) return 'list';
  if (error) return 'error';
  return 'empty';
}
