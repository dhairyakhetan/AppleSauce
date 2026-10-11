import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Logo } from '@/components/Logo';
import { invalidateUserProfileCache } from '@/utils/cache';
import { isSafeRedirect as isValidRedirect } from '@/lib/safe-redirect';
import { BentoStack, BentoPanel } from '@/components/layout/PageContainer';
import { PageLoader } from '@/components/layout/PageLoader';
import { usePageMeta } from '@/hooks/usePageMeta';
import { reportLoadError } from '@/lib/load-error';


export default function TeacherTermsAgreement() {
  usePageMeta(
    'Teacher Terms Agreement | Shikshaq',
    'Review and accept the terms that let your profile go live on Shikshaq.',
  );

  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirect');
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [isTeacher, setIsTeacher] = useState(false);
  const [hasAgreed, setHasAgreed] = useState(false);
  const hasRedirectedRef = useRef(false); // Track if we've already redirected
  const hasCheckedRef = useRef(false); // Track if we've already checked

  // Check if user is a teacher and if they've already agreed
  useEffect(() => {
    // Only check once
    if (hasCheckedRef.current) return;

    let isMounted = true;

    const checkTeacherStatus = async () => {
      // Prevent multiple redirects
      if (hasRedirectedRef.current) return;

      // Wait for auth to finish loading
      if (authLoading) return;

      // If no user, redirect to auth (preserve return URL)
      if (!user) {
        if (isMounted && !hasRedirectedRef.current && location.pathname === '/teacher-terms-agreement') {
          hasRedirectedRef.current = true;
          hasCheckedRef.current = true;
          const to = isValidRedirect(redirectTo) ? `/auth?redirect=${encodeURIComponent(redirectTo)}` : '/auth';
          navigate(to, { replace: true });
        }
        return;
      }

      try {
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('role, terms_agreement')
          .eq('id', user.id)
          .maybeSingle();
        if (profileError) throw profileError;

        if (isMounted && !hasRedirectedRef.current && location.pathname === '/teacher-terms-agreement') {
          hasCheckedRef.current = true;

          if (!profile) {
            // No profile - redirect to select role (preserve return URL)
            hasRedirectedRef.current = true;
            const to = isValidRedirect(redirectTo) ? `/select-role?redirect=${encodeURIComponent(redirectTo)}` : '/select-role';
            navigate(to, { replace: true });
            return;
          }

          if (profile.role !== 'teacher') {
            // Not a teacher - redirect back or home
            hasRedirectedRef.current = true;
            navigate(isValidRedirect(redirectTo) ? redirectTo : '/', { replace: true });
            return;
          }

          // User is a teacher
          setIsTeacher(true);

          if (profile.terms_agreement === true) {
            // Already agreed - redirect back or home
            hasRedirectedRef.current = true;
            setHasAgreed(true);
            navigate(isValidRedirect(redirectTo) ? redirectTo : '/', { replace: true });
            return;
          } else {
            // Needs to agree - show form
            setChecking(false);
          }
        }
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error('Error checking teacher status:', error);
        }
        reportLoadError('teacher-terms.profile', error, { what: 'your account details' });
        if (isMounted) {
          setChecking(false);
          hasCheckedRef.current = true;
        }
      }
    };

    checkTeacherStatus();

    return () => {
      isMounted = false;
    };
  }, [user, authLoading, location.pathname, redirectTo, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!termsAgreed) {
      toast.error('Please agree to the Terms and Privacy Policy to continue');
      return;
    }

    if (!user) {
      toast.error('You must be signed in to continue');
      const to = isValidRedirect(redirectTo) ? `/auth?redirect=${encodeURIComponent(redirectTo)}` : '/auth';
      navigate(to);
      return;
    }

    setLoading(true);

    try {
      // Update profile with terms agreement
      const { error } = await supabase
        .from('profiles')
        .update({
          terms_agreement: true,
        })
        .eq('id', user.id);

      if (error) {
        if (import.meta.env.DEV) console.error('Error updating profile:', error);
        toast.error('Failed to update profile. Please try again.');
        setLoading(false);
        return;
      }

      // Invalidate cache to ensure fresh data on next page load
      if (user) {
        invalidateUserProfileCache(user.id);
      }

      toast.success('Thank you for verifying your consent!');

      // Small delay to ensure cache is cleared, then redirect back or home
      const returnPath = isValidRedirect(redirectTo) ? redirectTo : '/';
      setTimeout(() => {
        navigate(returnPath, { replace: true });
      }, 100);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('Error:', error);
      }
      toast.error('Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  // Show loading state while checking
  if (authLoading || checking) {
    return <PageLoader />;
  }

  // If already agreed or not a teacher, don't render (they should be redirected)
  if (hasAgreed || !isTeacher) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <main>
        <BentoStack>
          {/* Handoff TT-001: header. No dated "last updated" line — unlike
              the Terms of Service page this links to, this consent screen
              isn't itself a versioned document, so there's no real date to
              show for it. Chromeless route, so the brand mark that every
              other page gets from the floating global nav is drawn here. */}
          <BentoPanel fill="card" edge="top" className="pt-[14px] pb-[22px]">
            <Logo size="nav" className="mb-5" />
            <h1 className="font-display text-[27px] font-extrabold tracking-[-0.04em] text-foreground">
              Verify your consent
            </h1>
            <p className="mt-2 text-[15px] leading-[1.5] text-warm-secondary">
              We&rsquo;ve detected that you&rsquo;re a teacher on our platform. Please verify your consent to continue.
            </p>
          </BentoPanel>

          {/* Handoff TT-001: prose panel — the real content here is a short
              consent list, not multi-section legal prose, so that's what
              renders (16px, max-w-[62ch]) rather than fabricated sections. */}
          <BentoPanel fill="card" className="max-w-[62ch]">
            <p className="text-[16px] font-semibold leading-[1.7] text-foreground">
              As a teacher on Shikshaq, you agree to:
            </p>
            <ul className="mt-2 flex list-disc flex-col gap-2 pl-5 text-[16px] leading-[1.7] text-warm-prose">
              <li>Provide accurate information about your qualifications and teaching experience</li>
              <li>Maintain professional conduct when interacting with students and parents</li>
              <li>Respect student privacy and confidentiality</li>
              <li>Follow all applicable laws and regulations</li>
            </ul>
          </BentoPanel>

          {/* Handoff TT-001: accept panel. */}
          <BentoPanel fill="card" edge="bottom" className="flex flex-col gap-5">
            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <div className="flex min-h-11 items-start gap-3">
                <Checkbox
                  id="terms"
                  checked={termsAgreed}
                  onCheckedChange={(checked) => setTermsAgreed(checked === true)}
                  className="mt-0.5 h-5 w-5 rounded-[6px]"
                />
                <label htmlFor="terms" className="text-sm leading-relaxed text-warm-prose cursor-pointer">
                  I agree to the{' '}
                  <a href="/terms-of-service" target="_blank" rel="noopener noreferrer" className="text-brand-blue underline">
                    Terms of Service
                  </a>
                  {' '}and{' '}
                  <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-brand-blue underline">
                    Privacy Policy
                  </a>
                  {' '}and consent to be listed as a teacher on Shikshaq.
                </label>
              </div>

              <Button type="submit" variant="primary" size={54} disabled={loading || !termsAgreed} className="w-full">
                {loading ? 'Verifying...' : 'Verify consent & continue'}
              </Button>
            </form>
          </BentoPanel>
        </BentoStack>
      </main>
    </div>
  );
}
