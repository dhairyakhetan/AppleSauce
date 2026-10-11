/**
 * "Is this a connection we should be speculative on?"
 *
 * Lifted out of route-prefetch.ts, which had the only correct implementation
 * of this in the codebase while the single largest speculative download in the
 * app -- useSearchIndex's ~550KB of teacher and paper JSON -- had no guard at
 * all. Same rule, one definition.
 *
 * Deliberately conservative about what counts as "metered": Save-Data is an
 * explicit request from the user and is always honoured, and 2g covers the
 * connections where a speculative half-megabyte is the difference between a
 * usable first visit and an unusable one. Anything unknown (no Network
 * Information API, which includes every Safari) is treated as fine, because
 * refusing to prefetch on the majority of iPhones would cost more than it saves.
 */
export function isMeteredConnection(): boolean {
  if (typeof navigator === 'undefined') return false;
  const c = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (!c) return false;
  return Boolean(c.saveData) || /(^|-)2g$/.test(c.effectiveType ?? '');
}
