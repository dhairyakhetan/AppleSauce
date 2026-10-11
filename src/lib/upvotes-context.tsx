import { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth-context';
import { toast } from 'sonner';
import { logger } from '@/utils/logger';
import { getCache, setCache, CACHE_TTL } from '@/utils/cache';
import {
  useToggleRelation,
  isDuplicateError,
  setCachedIds,
} from '@/lib/use-toggle-relation';

interface UpvotesContextType {
  isUpvoted: (teacherId: string) => boolean;
  toggleUpvote: (teacherId: string) => Promise<boolean>;
  getUpvoteCount: (teacherId: string) => number;
  loading: boolean;
  upvotedCount: number;
  upvotedTeacherIds: Set<string>;
  upvoteCounts: Map<string, number>; // teacherId -> count
}

const UpvotesContext = createContext<UpvotesContextType | undefined>(undefined);

// upvote_counts is public aggregate data (not per-user), so it keeps its own
// cache key/shape distinct from the shared per-user relation cache. Same
// TTL as before (5 min); the two calls this used to be (value + a separate
// _timestamp key, both read and expiry-checked by hand) are now the shared
// cache.ts helpers everything else on the site already uses.
const COUNTS_CACHE_KEY = 'upvote_counts';

const getCachedCounts = (): Map<string, number> | null => {
  const counts = getCache<Record<string, number>>(COUNTS_CACHE_KEY);
  return counts ? new Map(Object.entries(counts)) : null;
};

const setCachedCounts = (counts: Map<string, number>) => {
  setCache(COUNTS_CACHE_KEY, Object.fromEntries(counts), CACHE_TTL.UPVOTES);
};

export function UpvotesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [upvoteCounts, setUpvoteCounts] = useState<Map<string, number>>(new Map());

  // Per-user "did I upvote this teacher" set: cache, stale-while-revalidate
  // load, shared focus-bus refresh — all handled by the shared hook. Counts
  // are public aggregate data with genuinely different revert semantics (a
  // toggle must keep the id-set and the count map in lockstep), so that part
  // stays bespoke below rather than being forced through the generic toggle.
  const { ids: upvotedTeacherIds, loading, isRelated, setIds: setUpvotedIds } = useToggleRelation({
    table: 'teacher_upvotes',
    ownerColumn: 'user_id',
    targetColumn: 'teacher_id',
    userId: user?.id ?? null,
    cacheKeyPrefix: 'upvotes',
    messages: {
      signInRequired: 'Please sign in to upvote teachers',
      addSuccess: 'Teacher upvoted!',
      removeSuccess: 'Upvote removed',
      genericError: 'Failed to update upvote',
    },
  });

  // Load upvote counts for all teachers (public data)
  useEffect(() => {
    async function loadUpvoteCounts() {
      const cachedCounts = getCachedCounts();
      if (cachedCounts) {
        setUpvoteCounts(cachedCounts);
      }

      try {
        // Pulls from the teacher_upvote_stats view (server-side aggregate)
        // instead of fetching every row of teacher_upvotes and counting
        // client-side — that approach re-downloaded the entire table on
        // every page load for every visitor and only grows worse over time.
        /* Explicitly bounded. 148 teachers today so the cap is nowhere near
           binding, but an unbounded select against PostgREST silently
           truncates at 1000 and returns 200 OK -- which is how the sitemap
           came to advertise 1000 of 1282 papers for weeks without anyone
           noticing. Ordered so that if the table ever does outgrow the cap,
           the rows that survive are the ones worth having. */
        const { data, error } = await supabase
          .from('teacher_upvote_stats')
          .select('teacher_id, upvote_count')
          .order('upvote_count', { ascending: false })
          .limit(1000);

        if (error) {
          logger.error('upvotes-context.loadUpvoteCounts', error);
          if (cachedCounts) return;
          return;
        }

        const counts = new Map<string, number>();
        data?.forEach((row) => {
          if (row.teacher_id) counts.set(row.teacher_id, row.upvote_count || 0);
        });

        setUpvoteCounts(counts);
        setCachedCounts(counts);
      } catch (error) {
        logger.error('upvotes-context.loadUpvoteCounts.catch', error);
      }
    }

    loadUpvoteCounts();
  }, []);

  const getUpvoteCount = useCallback((teacherId: string) => upvoteCounts.get(teacherId) || 0, [upvoteCounts]);

  const toggleUpvote = useCallback(
    async (teacherId: string): Promise<boolean> => {
      if (!user) {
        toast.error('Please sign in to upvote teachers');
        return false;
      }

      const currentlyUpvoted = isRelated(teacherId);
      const newUpvotedState = !currentlyUpvoted;
      const cacheKey = `upvotes_${user.id}`;

      // Optimistic update of the per-user set (mirrors useToggleRelation's own
      // optimistic update so isUpvoted() flips immediately).
      const applyIdsUpdate = (upvoted: boolean) => {
        setUpvotedIds((prev) => {
          const next = new Set(prev);
          if (upvoted) next.add(teacherId);
          else next.delete(teacherId);
          setCachedIds(cacheKey, next);
          return next;
        });
      };

      applyIdsUpdate(newUpvotedState);
      setUpvoteCounts((prev) => {
        const next = new Map(prev);
        const currentCount = next.get(teacherId) || 0;
        next.set(teacherId, newUpvotedState ? currentCount + 1 : Math.max(0, currentCount - 1));
        setCachedCounts(next);
        return next;
      });

      const revert = () => {
        applyIdsUpdate(currentlyUpvoted);
        setUpvoteCounts((prev) => {
          const next = new Map(prev);
          const currentCount = next.get(teacherId) || 0;
          next.set(teacherId, currentlyUpvoted ? currentCount + 1 : Math.max(0, currentCount - 1));
          setCachedCounts(next);
          return next;
        });
      };

      try {
        if (currentlyUpvoted) {
          const { error } = await supabase
            .from('teacher_upvotes')
            .delete()
            .eq('user_id', user.id)
            .eq('teacher_id', teacherId);

          if (error) {
            revert();
            throw error;
          }

          toast.success('Upvote removed');
          return false;
        } else {
          const { error } = await supabase.from('teacher_upvotes').insert({ user_id: user.id, teacher_id: teacherId });

          if (error) {
            revert();

            if (isDuplicateError(error)) {
              toast.error('You have already upvoted this teacher');
              return true;
            }

            throw error;
          }

          toast.success('Teacher upvoted!');
          return true;
        }
      } catch (error: any) {
        logger.error('upvotes-context.toggleUpvote', error);
        toast.error(error.message || 'Failed to update upvote');
        return currentlyUpvoted;
      }
    },
    [user, isRelated, upvotedTeacherIds]
  );

  const value = useMemo<UpvotesContextType>(
    () => ({
      isUpvoted: isRelated,
      toggleUpvote,
      getUpvoteCount,
      loading,
      upvotedCount: upvotedTeacherIds.size,
      upvotedTeacherIds,
      upvoteCounts,
    }),
    [isRelated, toggleUpvote, getUpvoteCount, loading, upvotedTeacherIds, upvoteCounts]
  );

  return <UpvotesContext.Provider value={value}>{children}</UpvotesContext.Provider>;
}

export function useUpvotes() {
  const context = useContext(UpvotesContext);
  if (context === undefined) {
    throw new Error('useUpvotes must be used within an UpvotesProvider');
  }
  return context;
}
