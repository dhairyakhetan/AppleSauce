import { useQuery } from '@tanstack/react-query';

import { useAuth } from '@/lib/auth-context';
import { realGamesApi } from '@/lib/games/api';
import type { GamesRole } from '@/lib/games/rows';

/**
 * The person's role on the games team, for the account menu's "Games team"
 * links: null when they aren't on it. Same caching as useIsHodBadge.
 *
 * NOT an authorisation check: every function in the `games` schema checks the
 * team list itself. Any failure counts as "not on the team" (no link), which is
 * also what happens until the `games` schema is installed. No retries: a
 * failure only hides a link.
 */
export function useGamesRoleBadge(): GamesRole | null {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const { data } = useQuery({
    queryKey: ['chrome', 'games-role', userId],
    enabled: Boolean(userId),
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: false,
    // signed in with a password ('reauth'): no link; the page itself explains if they go there
    queryFn: async () => { const r = await realGamesApi.myRole(); return r === 'reauth' ? null : r; },
  });

  return data ?? null;
}
