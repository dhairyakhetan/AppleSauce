import { useCallback, useRef, useState } from 'react';

/**
 * One in-flight run per key. A second call with the same key while the first
 * is still running is ignored, so a double click on merge, split, reorder,
 * add, delete, hide, restore, figure or undo cannot send the write twice.
 *
 * The check is on a ref, not on state, because two clicks can land in the
 * same tick, before React has re-rendered with the disabled button.
 */
export function createBusyGuard() {
  const active = new Set<string>();
  return {
    isBusy: (key: string) => active.has(key),
    async run<T>(key: string, fn: () => Promise<T>): Promise<{ ran: boolean; value?: T }> {
      if (active.has(key)) return { ran: false };
      active.add(key);
      try {
        return { ran: true, value: await fn() };
      } finally {
        active.delete(key);
      }
    },
  };
}

/** React wrapper: `run` ignores a repeat, `busy(key)` drives `disabled`. */
export function useBusyActions() {
  const guardRef = useRef(createBusyGuard());
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(new Set());

  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>) => {
    if (guardRef.current.isBusy(key)) return { ran: false as const };
    setBusyKeys((prev) => new Set(prev).add(key));
    try {
      return await guardRef.current.run(key, fn);
    } finally {
      setBusyKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, []);

  const busy = useCallback((key: string) => busyKeys.has(key), [busyKeys]);
  return { run, busy, anyBusy: busyKeys.size > 0 };
}
