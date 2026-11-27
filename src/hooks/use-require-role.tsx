import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';

/**
 * Hook to ensure user has selected a role and agreed to terms.
 * Uses the centralized profile from AuthProvider instead of fetching independently.
 */
export function useRequireRole() {
  const { user, loading: authLoading, profile, profileLoading, profileFailed, retryProfile } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!user) return;
    // The account could not be read (a bad connection). That is NOT "no role yet": sending a teacher to the role
    // chooser here lets them answer it and lose the teacher role (site-wide audit B1). The caller shows a retry.
    if (profileFailed) return;

    if (!profile || !profile.role) {
      navigate('/select-role', { replace: true });
      return;
    }

    if (profile.role === 'teacher' && profile.terms_agreement !== true) {
      navigate('/teacher-terms-agreement', { replace: true });
      return;
    }
  }, [user, authLoading, profile, profileLoading, profileFailed, navigate]);

  return { profileFailed: Boolean(user) && !authLoading && !profileLoading && profileFailed, retryProfile };
}

