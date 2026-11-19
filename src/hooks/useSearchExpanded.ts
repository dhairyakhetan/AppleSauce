import { useSyncExternalStore } from 'react';

// Tiny cross-component store so the sticky Navbar can drop below the
// SearchControl's scrim while the control is expanded, without either
// component needing a shared parent or context provider.
let expanded = false;
const listeners = new Set<() => void>();

export function setSearchExpanded(value: boolean) {
  if (expanded === value) return;
  expanded = value;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return expanded;
}

export function useSearchExpanded(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}
