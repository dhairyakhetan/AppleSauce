/* The provider every adaptive surface reads from.
 *
 * THE FREEZE RULE, which is the whole reason this is a context and not a hook
 * each surface calls for itself: the index is resolved ONCE per route entry
 * and held still for that view. Without it, recording a signal would
 * re-resolve mid-read, and the page would rearrange under the reader's hands
 * while they were still looking at it. hero-copy.ts learned this the hard way
 * and pinned its line to sessionStorage for the same reason.
 *
 * So: signals recorded during a view are stored immediately and take effect at
 * the NEXT navigation. That one-view delay is not a limitation to work around,
 * it is what makes the adaptation feel like the site keeping up rather than
 * the site twitching.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { useLikes } from '@/lib/likes-context';
import { DEFAULT_INTENT, type IntentIndex } from '@/lib/intent/types';
import { resolveIntent } from '@/lib/intent/resolve';
import {
  resolveExperience,
  type ExperienceDecision,
} from '@/lib/intent/experiences';
import { routeAllowsAdaptation } from '@/lib/intent/guardrails';
import { beginSession } from '@/lib/intent/store';
import { recordSignal } from '@/lib/intent/signals';

interface IntentContextValue {
  /** Frozen for this view. */
  intent: IntentIndex;
  experience: ExperienceDecision;
  /** False on every route that must stay byte-stable for crawlers. */
  adaptive: boolean;
  /** Forces a re-resolve. Debug panel only; surfaces must not call it. */
  refresh: () => void;
}

const IntentContext = createContext<IntentContextValue | undefined>(undefined);

export function IntentProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { user } = useAuth();
  const { likedCount } = useLikes();
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    beginSession();
  }, []);

  const pathname = location.pathname;

  /* Weak by definition, and weighted zero. Recorded so a journey can be read
     end to end in the panel, never so it can move anything. */
  useEffect(() => {
    recordSignal('route_viewed', { path: pathname });
  }, [pathname]);

  /* Resolution is keyed on the pathname, not on the search string: changing a
     filter rewrites the query, and re-resolving there is precisely the
     mid-view shift the freeze rule exists to prevent. Auth and saved-count
     are in the key because both come from outside the page and both change
     what the reader is owed. */
  const intent = useMemo<IntentIndex>(() => {
    try {
      return resolveIntent({
        signedIn: Boolean(user),
        likedCount,
        pathname,
      });
    } catch {
      /* An unreadable envelope must never take a page down with it. */
      return { ...DEFAULT_INTENT };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, user, likedCount, nonce]);

  const experience = useMemo(
    () => resolveExperience(intent, pathname),
    [intent, pathname],
  );

  const adaptive = routeAllowsAdaptation(pathname);

  const value = useMemo<IntentContextValue>(
    () => ({ intent, experience, adaptive, refresh: () => setNonce((n) => n + 1) }),
    [intent, experience, adaptive],
  );

  return <IntentContext.Provider value={value}>{children}</IntentContext.Provider>;
}

/**
 * Reads the frozen index.
 *
 * Returns the default index rather than throwing when no provider is above it,
 * so a surface that ends up outside the tree renders today's site instead of a
 * blank page. Adaptation failing closed is the only acceptable failure here.
 */
export function useIntent(): IntentContextValue {
  const ctx = useContext(IntentContext);
  if (!ctx) {
    return {
      intent: DEFAULT_INTENT,
      experience: { profile: 'DISCOVERY', reason: 'no provider', level: 'none', seoCapped: false },
      adaptive: false,
      refresh: () => {},
    };
  }
  return ctx;
}

/** Records a signal without subscribing to the index, for surfaces that only
 *  write. Stable across renders, so it is safe in an effect's dependency list. */
export function useRecordSignal() {
  const ref = useRef(recordSignal);
  return ref.current;
}
