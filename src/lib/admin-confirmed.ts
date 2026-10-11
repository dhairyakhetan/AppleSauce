import { useSyncExternalStore } from 'react';

/**
 * Who the admin guard has confirmed as an admin, if anyone.
 *
 * The shared nav counts must not run for a signed-out visitor or a signed-in
 * non-admin: their reads either fail or, under row level security, come back as
 * numbers scoped to that person's own rows, and the header would show them as
 * admin counts. The guard (`useAdminGuard`) sets this when it grants access and
 * clears it on any other outcome; the counts hook waits for it.
 */

let confirmedFor: string | null = null;
const listeners = new Set<() => void>();

export function setAdminConfirmed(userId: string | null): void {
  if (confirmedFor === userId) return;
  confirmedFor = userId;
  listeners.forEach((l) => l());
}

export function getAdminConfirmed(): string | null {
  return confirmedFor;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** The id of the confirmed admin, or null while nobody is confirmed. */
export function useAdminConfirmedUserId(): string | null {
  return useSyncExternalStore(subscribe, getAdminConfirmed, () => null);
}
