import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth-context';

/**
 * Shows the "HOD desk" link in the account menu only for an HOD (or an
 * admin, for whom is_hod() is also true). Same caching as useIsCheckerBadge.
 * NOT an authorisation check: every hod_* function checks is_hod() itself.
 */
export function useIsHodBadge(): boolean {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const { data } = useQuery({
    queryKey: ['chrome', 'is-hod', userId],
    enabled: Boolean(userId),
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    queryFn: async () => {
      const { data: result, error } = await supabase.rpc('is_hod' as never);
      if (error) throw error;
      return Boolean(result);
    },
  });

  return data ?? false;
}
