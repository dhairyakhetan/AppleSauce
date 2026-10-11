import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { GraduationCap, User, BookOpen, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { Logo } from '@/components/Logo';
import { invalidateUserProfileCache } from '@/utils/cache';
import { BentoPanel } from '@/components/layout/PageContainer';
import { PageLoader } from '@/components/layout/PageLoader';
import { usePageMeta } from '@/hooks/usePageMeta';

const FIELD_CLASS = 'flex h-[52px] w-full items-center rounded-2xl bg-muted px-4 text-base text-foreground outline-none shikshaq-role-field';
import { isSafeRedirect as isValidRedirect } from '@/lib/safe-redirect';
import { reportLoadError } from '@/lib/load-error';
const LABEL_CLASS = 'mb-1 block text-[12px] font-bold uppercase tracking-[0.07em] text-warm-label';


export default function SelectRole() {
  usePageMeta(
    'Choose Your Role | Shikshaq',
    'Tell us whether you are a student or a guardian, so Shikshaq can show you the right home.',
  );

  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirect');
  const [role, setRole] = useState<'student' | 'guardian' | ''>('');
  const [schoolCollege, setSchoolCollege] = useState('');
  const [grade, setGrade] = useState('');
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingRole, setCheckingRole] = useState(true);
  const [hasRole, setHasRole] = useState(false);

  // Check once on mount if user already has a role - only run once
  useEffect(() => {
    let isMounted = true;

    const checkExistingRole = async () => {
      // Wait for auth to finish loading
      if (authLoading) return;

      // If no user, allow them to see the sign-in message
      if (!user) {
        if (isMounted) {
          setCheckingRole(false);
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

        if (isMounted) {
          if (profile && profile.role) {
            // User already has a role
            const returnPath = isValidRedirect(redirectTo) ? redirectTo : '/';
            if (profile.role === 'teacher') {
              // If teacher hasn't agreed to terms, redirect to teacher terms agreement (preserve return URL)
              if (profile.terms_agreement !== true) {
                const to = isValidRedirect(redirectTo) ? `/teacher-terms-agreement?redirect=${encodeURIComponent(redirectTo)}` : '/teacher-terms-agreement';
                navigate(to, { replace: true });
                return;
              }
              // If teacher has agreed, redirect back or home
              navigate(returnPath, { replace: true });
            } else {
              // Student or guardian - redirect back or home
              navigate(returnPath, { replace: true });
            }
            setHasRole(true);
          } else {
            // User doesn't have a role - show the form (guarded)
            setCheckingRole(false);
          }
        }
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error('Error checking role:', error);
        }
        reportLoadError('select-role.profile', error, { what: 'your account details' });
        if (isMounted) {
          setCheckingRole(false);
        }
      }
    };

    checkExistingRole();

    return () => {
      isMounted = false;
    };
  }, [user, authLoading, navigate, redirectTo]); // Only run when user or authLoading changes

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!role) {
      toast.error('Please select whether you are a student or guardian');
      return;
    }

    // Redesign S8 (design.md §1) — the role answer only sets home emphasis;
    // it never gates content. School/Grade and Terms are optional/secondary
    // here, not requirements for continuing.
    if (!user) {
      toast.error('You must be signed in to continue');
      const to = isValidRedirect(redirectTo) ? `/auth?redirect=${encodeURIComponent(redirectTo)}` : '/auth';
      navigate(to);
      return;
    }

    setLoading(true);

    try {
      const upsertData = {
        id: user.id,
        role: role,
        ...(termsAgreed ? { terms_agreement: termsAgreed } : {}),
        ...(role === 'student' && schoolCollege.trim() ? { school_college: schoolCollege.trim() } : {}),
        ...(role === 'student' && grade ? { grade } : {}),
      };

      const { error } = await supabase
        .from('profiles')
        .upsert(upsertData, {
          onConflict: 'id'
        });

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

      toast.success('Profile created successfully!');

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

  // Show loading state only while checking auth or initial role check
  if (authLoading || checkingRole) {
    return <PageLoader />;
  }

  // If user already has a role, don't render (they should be redirected)
  if (hasRole) {
    return null;
  }

  // If no user, show sign-in prompt
  if (!user) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        {/* <main>, not <div> — the signed-out branch is the one an unauthenticated
            visitor actually reaches, and it was the only branch of this page with
            no main landmark, so skip-to-content and landmark navigation had
            nothing to target exactly when the page is at its most confusing.
            Centered vertically (not pinned under pt-6/pt-12) and given the Logo
            every other chromeless screen in this flow carries — this is a
            chromeless route with no navbar, so it was the one bare edge case
            with no brand mark at all. */}
        <main className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center sm:px-6">
          <Logo size="lg" className="mb-6" />
          <h1 className="mb-4 text-page-title text-foreground">You must be signed in to continue.</h1>
          <button
            onClick={() => navigate(isValidRedirect(redirectTo) ? `/auth?redirect=${encodeURIComponent(redirectTo)}` : '/auth')}
            className="min-h-12 rounded-lg bg-foreground px-6 text-base font-bold text-background transition-transform duration-150 hover:-translate-y-0.5 active:scale-[0.96]"
          >
            Sign In
          </button>
        </main>
      </div>
    );
  }

  // Redesign S8 (design.md §1; changelog C-033) — rebuilt from zero. Three
  // tiles per the mockup: Student / Guardian set this profile's role (and,
  // per design.md §1, only ever set home emphasis — never gate content).
  // The Teacher tile is visual-parity only: teaching accounts are onboarded
  // through /join (qualifications, verification, etc.), not this role
  // picker, so it navigates there directly instead of calling setRole.
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Handoff SR-001: one full-height panel. */}
      <BentoPanel fill="card" edge="top" className="flex flex-1 flex-col px-5 pb-6 pt-1.5">
        <div className="mx-auto flex w-full max-w-[480px] flex-1 flex-col">
          <Logo size="lg" className="mb-5" />
          <h1 className="font-display text-[30px] font-black leading-[1.05] tracking-[-0.04em] text-foreground">
            Who's using Shikshaq?
          </h1>
          <p className="mt-2.5 text-[15px] leading-[1.55] text-warm-secondary">
            This only changes what your account shows you. You can search either way.
          </p>

          <form onSubmit={handleSubmit} className="mt-[22px] flex flex-1 flex-col gap-[18px]">
            <div className="flex flex-col gap-2.5">
              {/* Handoff SR-001: selection is a ring, never a fill swap — the
                  card must not restyle under the finger. */}
              <button
                type="button"
                onClick={() => setRole('guardian')}
                aria-pressed={role === 'guardian'}
                className={`rounded-[24px] bg-brand-subtle p-5 text-left transition-transform duration-hover ease-settle hover:-translate-y-0.5 active:scale-[0.96] ${
                  role === 'guardian' ? 'shadow-[inset_0_0_0_2px_hsl(var(--brand))]' : ''
                }`}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-brand">
                  <User className="h-[19px] w-[19px] text-foreground" strokeWidth={2} aria-hidden="true" />
                </span>
                <span className="mt-3.5 block font-display text-[21px] font-extrabold tracking-[-0.04em] text-brand-deep">Guardian</span>
                <span className="mt-1 block text-[14px] leading-[1.5] text-warm-prose">
                  Your relationship to the student, plus their details.
                </span>
              </button>

              <button
                type="button"
                onClick={() => setRole('student')}
                aria-pressed={role === 'student'}
                className={`rounded-[24px] bg-brand-blue-subtle p-5 text-left transition-transform duration-hover ease-settle hover:-translate-y-0.5 active:scale-[0.96] ${
                  role === 'student' ? 'shadow-[inset_0_0_0_2px_hsl(var(--brand-blue))]' : ''
                }`}
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-brand-blue">
                  <GraduationCap className="h-[19px] w-[19px] text-white" strokeWidth={2} aria-hidden="true" />
                </span>
                <span className="mt-3.5 block font-display text-[21px] font-extrabold tracking-[-0.04em] text-brand-blue-deep">Student</span>
                <span className="mt-1 block text-[14px] leading-[1.5] text-warm-prose">
                  School, board, class and the subjects you need help with.
                </span>
              </button>

              {/* Retained: real navigation, not in SR-001's two-card spec —
                  teaching accounts onboard through /join, a separate
                  application, not this role toggle, so it stays as its own
                  visually distinct exit rather than being dropped. */}
              <button
                type="button"
                onClick={() => navigate('/join')}
                className="flex min-h-[64px] items-center gap-[14px] rounded-[24px] bg-muted p-[18px] text-left text-foreground transition-[transform,background-color] duration-hover ease-settle hover:-translate-y-0.5 hover:bg-accent active:scale-[0.96]"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-background">
                  <BookOpen className="h-[18px] w-[18px]" strokeWidth={2.1} />
                </span>
                <span className="flex-1">
                  <span className="font-display text-[17px] font-bold tracking-[-0.03em]">Teacher</span>
                  <span className="mt-[3px] block text-[13px] leading-[1.5] text-warm-meta">
                    Apply to teach, a separate application, not a role toggle.
                  </span>
                </span>
                <ChevronRight className="h-[18px] w-[18px] shrink-0 text-warm-meta" strokeWidth={2.4} />
              </button>
            </div>

            {role === 'student' && (
              <div className="animate-in fade-in slide-in-from-top-2 duration-300 flex flex-col gap-[18px]">
                <div>
                  <label htmlFor="school_college" className={LABEL_CLASS}>
                    School / College <span className="text-warm-meta font-normal">(optional)</span>
                  </label>
                  <input
                    id="school_college"
                    placeholder="e.g. Delhi Public School"
                    value={schoolCollege}
                    onChange={(e) => setSchoolCollege(e.target.value)}
                    className={FIELD_CLASS}
                  />
                </div>
                <div>
                  <label htmlFor="grade" className={LABEL_CLASS}>
                    Grade <span className="text-warm-meta font-normal">(optional)</span>
                  </label>
                  <Select value={grade} onValueChange={setGrade}>
                    <SelectTrigger id="grade" className={FIELD_CLASS}>
                      <SelectValue placeholder="Select grade" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Class 1</SelectItem>
                      <SelectItem value="2">Class 2</SelectItem>
                      <SelectItem value="3">Class 3</SelectItem>
                      <SelectItem value="4">Class 4</SelectItem>
                      <SelectItem value="5">Class 5</SelectItem>
                      <SelectItem value="6">Class 6</SelectItem>
                      <SelectItem value="7">Class 7</SelectItem>
                      <SelectItem value="8">Class 8</SelectItem>
                      <SelectItem value="9">Class 9</SelectItem>
                      <SelectItem value="10">Class 10</SelectItem>
                      <SelectItem value="11">Class 11</SelectItem>
                      <SelectItem value="12">Class 12</SelectItem>
                      <SelectItem value="UG, First Year">UG, First Year</SelectItem>
                      <SelectItem value="UG, Second Year">UG, Second Year</SelectItem>
                      <SelectItem value="UG, Third Year">UG, Third Year</SelectItem>
                      <SelectItem value="UG, Fourth Year">UG, Fourth Year</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Terms and Privacy Policy Checkbox */}
            <div className="flex items-start gap-3">
              <Checkbox
                id="terms"
                checked={termsAgreed}
                onCheckedChange={(checked) => setTermsAgreed(checked === true)}
                className="mt-1"
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
                {' '}to connect with teachers.
              </label>
            </div>

            <div className="mt-auto pt-2">
              <button
                type="submit"
                disabled={loading || !role}
                className="flex h-[54px] w-full items-center justify-center rounded-full bg-brand text-[15px] font-extrabold text-brand-foreground transition-transform duration-tap hover:-translate-y-0.5 active:scale-[0.96] disabled:opacity-50 disabled:hover:translate-y-0"
              >
                {loading ? 'Creating profile...' : 'Continue'}
              </button>

              {/* account-03-pick-role.png / pages.md §10: a fourth ghost row lets
                  a visitor move on without choosing. design.md's own rule for this
                  screen — "the answer sets home emphasis... it never gates
                  content" — means role is a personalization hint, not a
                  requirement, so skipping has to be possible. This page had no
                  way out short of picking a role and agreeing to terms. */}
              <button
                type="button"
                onClick={() => navigate(isValidRedirect(redirectTo) ? redirectTo : '/')}
                className="mx-auto mt-3 block min-h-11 px-2 text-center text-sm font-semibold text-warm-meta"
              >
                Skip for now
              </button>
            </div>
          </form>
        </div>
      </BentoPanel>

      <style>{`
        .shikshaq-role-field:focus,
        .shikshaq-role-field:focus-within { box-shadow: 0 0 0 2px hsl(var(--foreground)); outline: none; }
      `}</style>
    </div>
  );
}
