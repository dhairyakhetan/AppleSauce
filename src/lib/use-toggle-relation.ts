import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getCache, setCache, CACHE_TTL } from '@/utils/cache';

/**
 * Shared behaviour extracted from likes-context.tsx, upvotes-context.tsx and
 * studies-with-context.tsx: a Set of related ids for the current user, backed
 * by a localStorage cache with a timestamp, loaded stale-while-revalidate,
 * refreshed on window focus (via one shared listener — see `subscribeFocus`
 * below — instead of each provider adding its own), and toggled optimistically
 * with revert-on-error and duplicate-conflict (Postgres 23505 / PostgREST
 * PGRST409) handling on insert.
 *
 * Each provider (LikesProvider/UpvotesProvider/StudiesWithProvider) still owns
 * its own context/hook with its exact original public shape — this only
 * factors out the plumbing underneath.
 */

export function isDuplicateError(error: any): boolean {
  return (
    error?.code === '23505' ||
    error?.code === 'PGRST409' ||
    !!error?.message?.includes('duplicate') ||
    !!error?.message?.includes('already exists') ||
    !!error?.message?.includes('unique constraint')
  );
}

export function isMissingTableError(error: any): boolean {
  return error?.code === 'PGRST116' || !!error?.message?.includes('does not exist') || !!error?.message?.includes('404');
}

export function isPermissionError(error: any): boolean {
  return error?.code === '42501' || !!error?.message?.includes('permission denied');
}

export function getCachedIds(cacheKey: string): Set<string> | null {
  const ids = getCache<string[]>(cacheKey);
  return ids ? new Set(ids) : null;
}

export function setCachedIds(cacheKey: string, ids: Set<string>) {
  setCache(cacheKey, Array.from(ids), CACHE_TTL.RELATION_IDS);
}

// --- Shared focus bus -------------------------------------------------------
// Previously two of the three providers each registered their own
// `window.addEventListener('focus', ...)`, so a single tab refocus fired two
// independent refetches. This installs exactly one native listener no matter
// how many `useToggleRelation` instances are mounted, and fans out to each
// instance's own stale-check/refetch.
type FocusListener = () => void;
const focusListeners = new Set<FocusListener>();
let focusBusInstalled = false;
function ensureFocusBus() {
  if (focusBusInstalled) return;
  focusBusInstalled = true;
  window.addEventListener('focus', () => {
    focusListeners.forEach((fn) => fn());
  });
}
export function subscribeFocus(fn: FocusListener): () => void {
  ensureFocusBus();
  focusListeners.add(fn);
  return () => focusListeners.delete(fn);
}
// -----------------------------------------------------------------------------

export interface ToggleRelationMessages {
  signInRequired: string;
  addSuccess: string;
  removeSuccess: string;
  /** Shown when an insert 409/23505s because the row already exists (treated as success). */
  duplicateSuccess?: string;
  tableMissing?: string;
  permissionDenied?: string;
  genericError?: string;
}

export interface UseToggleRelationOptions {
  /** Supabase table storing the relation, e.g. 'liked_teachers'. */
  table: string;
  /** Column identifying the current user's row, e.g. 'user_id' / 'student_id'. */
  ownerColumn: string;
  /** Column identifying the related entity, e.g. 'teacher_id'. */
  targetColumn: string;
  /** Current user id, or null/undefined when signed out. */
  userId: string | null | undefined;
  /** localStorage cache key prefix, e.g. 'likes' -> `likes_<userId>`. */
  cacheKeyPrefix: string;
  messages: ToggleRelationMessages;
  /**
   * Optional guard evaluated before a toggle's insert/delete runs (e.g.
   * "only students can indicate they study with a teacher"). Return an error
   * message to block the toggle (a toast is shown and the toggle no-ops), or
   * null/undefined to allow it.
   */
  guard?: () => string | null | undefined;
  /** Whether a permission-denied (42501) load error should be treated as "empty set" rather than kept/thrown. Only likes-context did this originally. */
  handlePermissionDenied?: boolean;
}

export interface UseToggleRelationResult {
  ids: Set<string>;
  loading: boolean;
  isRelated: (targetId: string) => boolean;
  toggle: (targetId: string) => Promise<boolean>;
  /**
   * Escape hatch for providers that need to keep extra state (e.g. upvote
   * counts) in lockstep with the id set on toggle, rather than using `toggle`
   * directly. Most providers should not need this.
   */
  setIds: (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
}

export function useToggleRelation(opts: UseToggleRelationOptions): UseToggleRelationResult {
  const { table, ownerColumn, targetColumn, userId, cacheKeyPrefix, messages, guard, handlePermissionDenied } = opts;

  const [ids, setIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const idsRef = useRef(ids);
  idsRef.current = ids;

  const cacheKey = useCallback((uid: string) => `${cacheKeyPrefix}_${uid}`, [cacheKeyPrefix]);

  const load = useCallback(
    async (forceRefresh = false) => {
      if (!userId) {
        setIds(new Set());
        setLoading(false);
        return;
      }

      const key = cacheKey(userId);
      const cached = forceRefresh ? null : getCachedIds(key);
      if (cached) {
        setIds(cached);
        setLoading(false);
      }

      try {
        const { data, error } = await (supabase as any).from(table).select(targetColumn).eq(ownerColumn, userId);

        if (error) {
          if (import.meta.env.DEV) {
            console.error(`Error fetching ${table}:`, {
              code: (error as any).code,
              message: error.message,
              details: (error as any).details,
              hint: (error as any).hint,
            });
          }

          if (isMissingTableError(error)) {
            setIds(new Set());
            setLoading(false);
            return;
          }
          if (handlePermissionDenied && isPermissionError(error)) {
            setIds(new Set());
            setLoading(false);
            return;
          }
          if (cached) return; // keep serving cached data on transient errors
          throw error;
        }

        const newIds = new Set<string>((data ?? []).map((row: any) => row[targetColumn]).filter(Boolean));
        setIds(newIds);
        setCachedIds(key, newIds);
      } catch (error) {
        if (import.meta.env.DEV) console.error(`Error fetching ${table}:`, error);
        if (!cached) setIds(new Set());
      } finally {
        setLoading(false);
      }
    },
    [userId, table, ownerColumn, targetColumn, cacheKey, handlePermissionDenied]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Refresh on window focus, but only if the cache is stale — coordinated via
  // the shared focus bus so N mounted providers add exactly one native listener.
  useEffect(() => {
    if (!userId) return;
    return subscribeFocus(() => {
      const cached = getCachedIds(cacheKey(userId));
      if (!cached) load(true);
    });
  }, [userId, load, cacheKey]);

  const isRelated = useCallback((targetId: string) => idsRef.current.has(targetId), []);

  /* Ref, so the retry closure below can call the current toggle without
     toggle having to depend on itself. */
  const toggleRef = useRef<(targetId: string) => Promise<boolean>>();

  const toggle = useCallback(
    async (targetId: string): Promise<boolean> => {
      if (!userId) {
        toast.error(messages.signInRequired);
        return false;
      }

      const guardError = guard?.();
      if (guardError) {
        toast.error(guardError);
        return false;
      }

      const currentlyRelated = isRelated(targetId);
      const newState = !currentlyRelated;
      const key = cacheKey(userId);

      setIds((prev) => {
        const next = new Set(prev);
        if (newState) next.add(targetId);
        else next.delete(targetId);
        setCachedIds(key, next);
        return next;
      });

      /* micro-06-non-negotiables rule 5: "Failure reverts the control and says
         what happened in the same pill — with a Retry." The revert and the
         message were both here; the Retry was not, so a like that failed on a
         flaky connection left the user with an error and no way to act on it
         except finding the button again. Attached to every failure toast that
         is worth retrying — not to permission or missing-table errors, which
         will fail again identically and where a Retry button would be a lie. */
      const retry = { label: 'Retry', onClick: () => void toggleRef.current?.(targetId) };

      /* micro-01-keeping-things.png: the success pill "appears for 4s, holds an
         Undo". Undo is the same toggle run again, which is exactly what makes
         these actions safe to take without thinking — the sheet's own subtitle
         is "save, like, follow — all optimistic, all reversible", and reversible
         was the half that was missing. 4s to match the spec; the default is
         shorter and an Undo you cannot reach is decoration. */
      const undo = { label: 'Undo', onClick: () => void toggleRef.current?.(targetId) };
      const undoToast = { action: undo, duration: 4000 };

      const revert = () => {
        setIds((prev) => {
          const next = new Set(prev);
          if (currentlyRelated) next.add(targetId);
          else next.delete(targetId);
          setCachedIds(key, next);
          return next;
        });
      };

      try {
        if (currentlyRelated) {
          const { error } = await (supabase as any).from(table).delete().eq(ownerColumn, userId).eq(targetColumn, targetId);

          if (error) {
            revert();
            if (import.meta.env.DEV) console.error(`Error toggling ${table} (delete):`, error);

            if (isMissingTableError(error)) {
              toast.error(messages.tableMissing ?? `Table not found. Check if ${table} exists in Supabase.`);
              return currentlyRelated;
            }
            if (isPermissionError(error)) {
              toast.error(messages.permissionDenied ?? 'Permission denied. Check RLS policies in Supabase.');
              return currentlyRelated;
            }
            throw error;
          }

          toast.success(messages.removeSuccess, undoToast);
          return false;
        } else {
          const { error } = await (supabase as any).from(table).insert({ [ownerColumn]: userId, [targetColumn]: targetId });

          if (error) {
            revert();
            if (import.meta.env.DEV) console.error(`Error toggling ${table} (insert):`, error);

            if (isDuplicateError(error)) {
              // Matches original behaviour exactly: local state is still
              // reverted above (like any other error), but the call is
              // reported as successful since the row already exists server-side.
              if (messages.duplicateSuccess) toast.error(messages.duplicateSuccess);
              return true;
            }
            if (isMissingTableError(error)) {
              toast.error(messages.tableMissing ?? `Table not found. Check if ${table} exists in Supabase.`);
              return currentlyRelated;
            }
            if (isPermissionError(error)) {
              toast.error(messages.permissionDenied ?? 'Permission denied. Check RLS policies in Supabase.');
              return currentlyRelated;
            }
            throw error;
          }

          toast.success(messages.addSuccess, undoToast);
          return true;
        }
      } catch (error: any) {
        if (import.meta.env.DEV) console.error(`Error toggling ${table}:`, error);
        if (isMissingTableError(error)) {
          /* No Retry here: a missing table fails identically every time, so the
             button would only invite a second identical failure. */
          toast.error(messages.tableMissing ?? `Database table not found for ${table}. Please run the migration in Supabase.`);
        } else {
          toast.error(error?.message || messages.genericError || 'Failed to update', { action: retry });
        }
        return currentlyRelated;
      }
    },
    [userId, table, ownerColumn, targetColumn, cacheKey, guard, isRelated, messages]
  );

  /* Keep the ref pointing at the latest toggle so a Retry pressed on an old
     toast still runs the current one. */
  toggleRef.current = toggle;

  return { ids, loading, isRelated, toggle, setIds };
}
