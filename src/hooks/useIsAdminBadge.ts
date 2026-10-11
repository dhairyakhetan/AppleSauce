import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth-context';

/**
 * Shared "does this user get the Admin link" check for the page chrome
 * (Navbar + Footer), and ONLY for that.
 *
 * Both of those render on every route and each used to run its own
 * `admins` select inside a `[user]` effect. Measured on a real Browse load:
 * NINE identical `GET /rest/v1/admins?select=id&id=eq.<uid>` requests fired
 * within 4ms of each other — two components, each double-invoked by
 * StrictMode in dev, each re-running when `user` settles from null to the
 * session object. They then serialised behind the browser's per-host
 * connection limit, and the last one did not resolve for 1,596ms, holding
 * the connection pool (and so the teacher/Shikshaqmine fetches queued
 * behind it) hostage for most of that.
 *
 * One react-query key collapses all of them into a single in-flight
 * request, and the app's default 5-minute staleTime (App.tsx) means a
 * client-side navigation does not refire it at all.
 *
 * NOT an authorisation check. This only decides whether a link is drawn.
 * The real gate on /admin/* is `useAdminGuard` in AdminConsole.tsx, which
 * deliberately keeps its own uncached query, timeout and
 * failed-vs-denied distinction — do not "consolidate" that one into this.
 */
export function useIsAdminBadge(): boolean {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const { data } = useQuery({
    queryKey: ['chrome', 'is-admin', userId],
    enabled: Boolean(userId),
    // Longer than the app default: whether someone is staff does not change
    // mid-session, and a stale `false` costs only a hidden link.
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    queryFn: async () => {
      const { data: row, error } = await supabase
        .from('admins')
        .select('id')
        .eq('id', userId!)
        .maybeSingle();
      if (error) throw error;
      return Boolean(row);
    },
  });

  return Boolean(data);
}
