import { useCallback, useState } from 'react';

/* A disclosure that remembers whether it was left open, per key, in this
   browser only. It starts OPEN on a key's first visit (so a new admin sees the
   help once) and CLOSED on every visit after, unless it was left open.

   localStorage can be missing, blocked or full (private window, cleared site
   data, a thumbnail renderer). Every access is in try/catch, and with no
   storage the disclosure simply opens on every visit: it still renders and
   still toggles, it just does not remember. */

const PREFIX = 'shikshaq:open:';

interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function store(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Reads the remembered state. A first visit returns true and marks the key as
 *  seen (closed), so the next visit starts closed. */
export function readRememberedOpen(key: string, storage: StorageLike | null = store()): boolean {
  if (!storage) return true;
  try {
    const v = storage.getItem(PREFIX + key);
    if (v === 'o') return true;
    if (v === 'c') return false;
    storage.setItem(PREFIX + key, 'c');
    return true;
  } catch {
    return true;
  }
}

export function writeRememberedOpen(key: string, open: boolean, storage: StorageLike | null = store()): void {
  if (!storage) return;
  try {
    storage.setItem(PREFIX + key, open ? 'o' : 'c');
  } catch {
    // Storage full or blocked: the toggle still works for this visit.
  }
}

export function useRememberedOpen(key: string): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = useState(() => readRememberedOpen(key));
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      writeRememberedOpen(key, next);
    },
    [key],
  );
  return [open, setOpen];
}
