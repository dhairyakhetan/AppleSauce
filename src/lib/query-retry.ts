import { RequestTimeoutError } from '@/lib/checker-timeout';

/* When to try a failed read a second time.

   A read that failed because it was TOO SLOW (the database cuts a request at 8 seconds, 15 for HODs, and the
   screen gives up after its own limit) is not helped by asking again at once: the second try is just as slow, so
   the wait doubles and the person stares at a spinner for twice as long. Those failures show the "Try again"
   button straight away instead. Anything else (a dropped connection, a hiccup) still gets one automatic retry. */

/** True for a call that ran out of time, on the screen's side or on the database's side. */
export function isTimeoutError(err: unknown): boolean {
  if (err instanceof RequestTimeoutError) return true;
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown; name?: unknown };
  // 57014 is Postgres's "query canceled", which is what a statement timeout raises.
  if (e.code === '57014') return true;
  if (e.name === 'RequestTimeoutError') return true;
  const message = typeof e.message === 'string' ? e.message : '';
  return /statement timeout|canceling statement|took longer than/i.test(message);
}

/** react-query's `retry` option: one automatic retry, but never after a timeout. */
export function retryUnlessTimeout(failureCount: number, error: unknown): boolean {
  return failureCount < 1 && !isTimeoutError(error);
}
