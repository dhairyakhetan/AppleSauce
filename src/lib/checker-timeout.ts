/**
 * A request that never comes back must fail like a network error does, so the
 * existing paths run (the outbox retries and says "Not saved yet", Undo, Split
 * and the OR tool put their buttons back). Before this a hung request left
 * `sending` or `submitting` true for good and froze every button.
 *
 * Pure: the timer is injectable for tests.
 */

/** How long one checker request may take before it counts as failed. */
export const CHECKER_REQUEST_TIMEOUT_MS = 30_000;

/**
 * The one place the words for "slow or hung" live (13 Nov 2026). Checkers and HODs
 * used to read "Check your internet" (wrong when the server was only slow) or the
 * database's own text ("canceling statement due to statement timeout"). Plain,
 * calm, and it does not blame the person. Use these, do not write new ones.
 */
/** For a read that was slow or hung: a list, a page, a paper. Nothing is lost because nothing was being saved. */
export const SLOW_WORDS = 'This is taking longer than it should. Try again in a minute. Nothing is lost.';
/** For an action (save, undo, edit, hand out) that was slow or hung and may not have gone through. */
export const SLOW_ACTION_WORDS = 'This is taking longer than it should, so that may not have gone through. Try again in a minute.';

/** What a request that took too long rejects with. The text matches none of the
 *  server refusals, so it is retried like a lost connection. It is plain words, so
 *  a screen that shows `error.message` as it is stays readable. */
export class RequestTimeoutError extends Error {
  constructor(_ms: number = CHECKER_REQUEST_TIMEOUT_MS) {
    super(SLOW_WORDS);
    this.name = 'RequestTimeoutError';
  }
}

/**
 * True for a failure that means "slow or unreachable, not refused": our own timeout,
 * the database's statement timeout (57014), a gateway timeout, or a browser fetch that
 * never got an answer. A server refusal written for people is NOT slow, so it is not matched.
 */
export function isSlowError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof RequestTimeoutError) return true;
  const e = (typeof err === 'object' ? err : { message: String(err) }) as { name?: unknown; code?: unknown; message?: unknown; details?: unknown };
  if (e.name === 'RequestTimeoutError' || e.name === 'AbortError' || e.name === 'TimeoutError') return true;
  if (e.code === '57014') return true;
  const text = [e.message, e.details].filter((v) => typeof v === 'string').join(' ');
  return /statement timeout|canceling statement|timed? ?out|took longer than|failed to fetch|networkerror|load failed|gateway time-?out/i.test(text);
}

/**
 * The server's own sentence as written (HOD desk refusals are plain English), unless the
 * failure was only slowness, which gets SLOW_WORDS. `fallback` when there is no message.
 */
export function reasonWords(err: unknown, fallback: string): string {
  if (isSlowError(err)) return SLOW_WORDS;
  const m = err && typeof err === 'object' && 'message' in err ? String((err as { message: unknown }).message).trim() : '';
  return m || fallback;
}

/**
 * Settles with `work` or, after `ms`, rejects with RequestTimeoutError (and
 * calls `onTimeout`, for example to abort the fetch). A late answer from `work`
 * is ignored, and a late failure never becomes an unhandled rejection.
 */
export function withTimeout<T>(
  work: PromiseLike<T>,
  ms: number = CHECKER_REQUEST_TIMEOUT_MS,
  onTimeout?: () => void,
  timers: { set: (cb: () => void, ms: number) => unknown; clear: (id: unknown) => void } = {
    set: (cb, wait) => setTimeout(cb, wait),
    clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const timer = timers.set(() => {
      if (done) return;
      done = true;
      try {
        onTimeout?.();
      } catch {
        /* aborting is best effort */
      }
      reject(new RequestTimeoutError(ms));
    }, ms);
    Promise.resolve(work).then(
      (value) => {
        if (done) return;
        done = true;
        timers.clear(timer);
        resolve(value);
      },
      (error) => {
        if (done) return;
        done = true;
        timers.clear(timer);
        reject(error);
      },
    );
  });
}
