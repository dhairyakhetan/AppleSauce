// As of the intent index this is a SHIM over src/lib/intent/store.ts. The
// `shikshaq_recent_searches` key is now a sub-record of `shikshaq.intent.v1`,
// holding the identical RecentSearch shape and the identical cap of 5, so
// SearchControl's resting overlay is unaffected. The old key is still mirrored
// for one release.
//
// The de-duplication rule (same q AND same mode replaces, otherwise prepends)
// moved into the signal recorder, which applies it identically.

import type { SearchMode } from '@/utils/searchFacets';
import { recordSignal } from '@/lib/intent/signals';
import { readStore, CAPS } from '@/lib/intent/store';

export interface RecentSearch {
  q: string;
  mode: SearchMode;
  ts: number;
}

export function getRecentSearches(): RecentSearch[] {
  try {
    return readStore().searches.slice(0, CAPS.searches);
  } catch {
    return [];
  }
}

export function addRecentSearch(q: string, mode: SearchMode) {
  const trimmed = q.trim();
  if (!trimmed) return;
  try {
    recordSignal('search_submitted', { query: trimmed, mode });
  } catch {
    // localStorage unavailable (private browsing, etc.) — recents just won't persist
  }
}
