/**
 * "Only the newest request may write." Each call to `next()` starts a new
 * request and retires every earlier one; `isCurrent(token)` is true only for
 * the newest. A slow answer to an old request (expanded paper A, then B;
 * range 30 days, then 90) is checked with `isCurrent` and dropped, so it can
 * never overwrite what the admin is now looking at.
 *
 * `cancel()` retires everything without starting a new request, for when the
 * panel is closed.
 */
export function createLatestGuard() {
  let current = 0;
  return {
    next(): number {
      current += 1;
      return current;
    },
    cancel(): void {
      current += 1;
    },
    isCurrent(token: number): boolean {
      return token === current;
    },
  };
}
