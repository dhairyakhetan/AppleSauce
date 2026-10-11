import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth-context';

/**
 * D34: shows the "Check papers" link in the account menu only for an
 * active paper checker (or an admin -- is_paper_checker() returns true
 * for both, same shape as is_admin()). Mirrors useIsAdminBadge.ts's
 * caching choices (long staleTime -- this does not change mid-session,
 * so a stale `false` for a few minutes only costs a hidden link) and is
 * NOT an authorisation check: the real gate is server-side, inside every
 * checker_* RPC and inside Checker.tsx's own client-side redirect.
 */
export function useIsCheckerBadge(): boolean {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const { data } = useQuery({
    queryKey: ['chrome', 'is-paper-checker', userId],
    enabled: Boolean(userId),
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    queryFn: async () => {
      const { data: result, error } = await supabase.rpc('is_paper_checker' as never);
      if (error) throw error;
      return Boolean(result);
    },
  });

  return data ?? false;
}
