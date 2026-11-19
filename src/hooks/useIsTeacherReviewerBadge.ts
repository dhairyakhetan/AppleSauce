import { useQuery } from '@tanstack/react-query';

import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth-context';

/**
 * Shows the "Review teachers" link in the account menu only for a teacher
 * reviewer (or an admin, for whom is_teacher_reviewer() is also true). Same
 * caching as useIsHodBadge. NOT an authorisation check: every reviewer_*
 * function checks is_teacher_reviewer() itself.
 */
export function useIsTeacherReviewerBadge(): boolean {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const { data } = useQuery({
    queryKey: ['chrome', 'is-teacher-reviewer', userId],
    enabled: Boolean(userId),
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    queryFn: async () => {
      const { data: result, error } = await supabase.rpc('is_teacher_reviewer' as never);
      if (error) throw error;
      return Boolean(result);
    },
  });

  return data ?? false;
}
