// Device-local "recently visited" tracker. Not account-linked — a fresh
// browser/device starts empty even for a signed-in user. Account-level sync
// would need a new Supabase table; deliberately out of scope here.
//
// As of the intent index this is a SHIM over src/lib/intent/store.ts. The
// `recently_visited` key is now a sub-record of `shikshaq.intent.v1`, holding
// the identical RecentVisit shape and the identical cap of 8, so
// HomeActivitySection's rendering is unaffected. The old key is still mirrored
// for one release.

import { recordVisitEntry } from '@/lib/intent/signals';
import { readStore, CAPS } from '@/lib/intent/store';

const MAX_ENTRIES = CAPS.visits;

export interface RecentVisit {
  type: 'teacher' | 'paper';
  id: string;
  title: string;
  subtitle?: string;
  path: string;
  ts: number;
}

export function getRecentlyVisited(): RecentVisit[] {
  try {
    return readStore().visits.slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function recordVisit(entry: Omit<RecentVisit, 'ts'>) {
  try {
    recordVisitEntry(entry);
  } catch {
    // Storage unavailable (private browsing, quota) — visit history is a
    // nicety, fail silently rather than breaking the page.
  }
}
