import { useEffect, useState, type ReactNode } from 'react';

/**
 * Suspense fallback wrapper that renders nothing for `delayMs`, then swaps in
 * `children` (the real fallback, e.g. PageLoader) if Suspense is still
 * showing it by then.
 *
 * Without this, an already-warm route (its chunk prefetched on hover by
 * route-prefetch.ts) still rendered a full skeleton for one frame the instant
 * <Suspense> mounted, before the already-resolved import promise let the real
 * page take over — the "skeleton flash on a fast navigation" P1-1/P1-4 speed
 * budget violation (CRAFT.md: "route switch, chunk already prefetched -> next
 * page's shell paints in < 150ms"). Delaying the fallback's OWN appearance
 * means a fetch that resolves inside the delay window never paints a
 * skeleton at all; a genuinely slow one still gets it, just 150ms later than
 * before.
 */
export function DelayedFallback({
  delayMs = 150,
  children,
}: {
  delayMs?: number;
  children: ReactNode;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setShow(true), delayMs);
    return () => window.clearTimeout(t);
  }, [delayMs]);

  if (!show) return null;
  return <>{children}</>;
}

export default DelayedFallback;
