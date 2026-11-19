import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';

/**
 * Hook to ensure user has selected a role and agreed to terms.
 * Uses the centralized profile from AuthProvider instead of fetching independently.
 */
export function useRequireRole() {
  const { user, loading: authLoading, profile, profileLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!user) return;

    if (!profile || !profile.role) {
      navigate('/select-role', { replace: true });
      return;
    }

    if (profile.role === 'teacher' && profile.terms_agreement !== true) {
      navigate('/teacher-terms-agreement', { replace: true });
      return;
    }
  }, [user, authLoading, profile, profileLoading, navigate]);
}

