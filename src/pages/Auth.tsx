import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, ArrowRight } from 'lucide-react';
import { z } from 'zod';
import { isSafeRedirect } from '@/lib/safe-redirect';
import { resolveRoleHome } from '@/lib/role-home-api';
import { saveAuthRedirect, getAuthRedirect, clearAuthRedirect } from '@/utils/authRedirect';
import { Logo } from '@/components/Logo';
import { WhatsAppIcon } from '@/components/BrandIcons';
import { getSubjectPalette } from '@/lib/subject-palette';
import { readAuthIntent, clearAuthIntent } from '@/lib/auth-intent';
import { resolveAuthHero } from '@/components/auth/AuthHero';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useSiteCounts } from '@/hooks/useSiteCounts';

/* C-032 / handoff AU-003a — proof counts above the fold. Counts are real
   (Supabase), never hardcoded; the sticker that needs one simply doesn't
   render until it arrives. Maths/Science added for the sticker cluster's
   two subject pills.

   The paper count itself is NOT fetched here any more: it used to count the
   `papers` table (18 rows, the submit-a-paper flow), which undercounted the
   real library by two orders of magnitude. useSiteCounts() is the canonical
   figure (bank_papers, the ~2,000-row library) and is called separately by
   the component so it shares the app-wide React Query cache instead of
   re-fetching on every visit to this page. */
function useAuthProofCounts() {
  const [teacherCount, setTeacherCount] = useState<number | null>(null);
  const [mathsCount, setMathsCount] = useState<number | null>(null);
  const [scienceCount, setScienceCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [{ count: teachers }, { count: maths }, { count: science }] = await Promise.all([
          supabase.from('teachers_list').select('id', { count: 'exact', head: true }),
          supabase.from('teachers_list').select('id', { count: 'exact', head: true }).ilike('subjects', '%Maths%'),
          supabase.from('teachers_list').select('id', { count: 'exact', head: true }).ilike('subjects', '%Science%'),
        ]);
        if (!cancelled) {
          if (typeof teachers === 'number') setTeacherCount(teachers);
          if (typeof maths === 'number') setMathsCount(maths);
          if (typeof science === 'number') setScienceCount(science);
        }
      } catch {
        // Counts stay null; the pills that need them simply don't render (design.md §0.10).
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return { teacherCount, mathsCount, scienceCount };
}

const emailSchema = z.string().email('Please enter a valid email');
const passwordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[a-zA-Z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one digit');

const signupSchema = z.object({
  fullName: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Please enter a valid email'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[a-zA-Z]/, 'Password must contain at least one letter')
    .regex(/[0-9]/, 'Password must contain at least one digit'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

const signinSchema = z.object({
  email: z.string().email('Please enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

export default function Auth() {
  /* robots.txt disallows this route, so this is not about ranking: without it
     the tab, the history entry and any shared link all read "Find Tuition
     Teachers in Kolkata" while the reader is looking at a sign-in form,
     because index.html's defaults are what a page without its own meta gets. */
  usePageMeta(
    'Sign in | Shikshaq',
    'Sign in to Shikshaq to save teachers you like, keep track of who you have contacted, and pick up where you left off.',
  );

  const [isLogin, setIsLogin] = useState(true);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  // Owner mobile-QA fix (bug 3): the email/password path used to render as a
  // full form directly under Google, matching its visual weight. Google is
  // now the sole primary CTA (bug 1) and email sign-in is a de-emphasized
  // entry point below it — the form only mounts once this is toggled on.
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [processingOAuth, setProcessingOAuth] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: '',
    newPassword: '',
    confirmNewPassword: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const {
    signInWithGoogle,
    signUpWithEmail,
    signInWithEmail,
    resetPasswordForEmail,
    sendMagicLink,
    updatePassword,
    user,
    loading: authLoading
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { mathsCount, scienceCount } = useAuthProofCounts();
  const { data: siteCounts } = useSiteCounts();
  const paperCount = siteCounts?.papers ?? null;

  /* Handoff AU-004a: the hero follows the intent that opened the gate. Read
     once per arrival here — the intent is cleared when the post-sign-in
     redirect resolves, and re-reading on every render would swap the hero
     out from under a visitor who is still looking at it.

     Keyed on location.key, not a bare useState(readAuthIntent) mount-once
     read: a gate elsewhere (e.g. GateSheet's "Other ways to sign in") can
     call setAuthIntent() then navigate('/auth') while this page is ALREADY
     the current route — same pathname both times, so RouteTransition's
     key={location.pathname} never remounts this component and a one-time
     read stays stuck on whatever intent was true the first time /auth was
     visited this session (confirmed: a visitor who'd seen the generic
     "Teaching on Shikshaq" hero once kept seeing it on a later paper-gated
     visit that should have shown the paper hero). location.key is a fresh
     string on every history entry React Router creates — including a
     navigate() to the same path — so this re-reads exactly when a real
     navigation happened, without re-reading on every unrelated re-render
     (typing in the form, etc.), which is what the original comment about
     "swapping the hero out from under them" was actually guarding against. */
  const authIntent = useMemo(readAuthIntent, [location.key]);

  // Save redirect on mount (backup — primary save happens at the click source)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const redirect = urlParams.get('redirect');
    /* saveAuthRedirect validates too; this guard is kept so an unsafe value is
       never even offered to it. Both now go through the same parser-backed
       check rather than a startsWith pair a backslash defeats. */
    if (isSafeRedirect(redirect)) {
      saveAuthRedirect(redirect);
    }
  }, []);

  // Handle OAuth callback and redirect if authenticated
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const resetType = urlParams.get('type');
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const hasAccessToken = hashParams.get('access_token');

    if (resetType === 'reset-password' && hasAccessToken) {
      setShowResetPassword(true);
      setIsLogin(true);
      return;
    }

    const hasError = hashParams.get('error');

    if (hasAccessToken && !showResetPassword) {
      setProcessingOAuth(true);
    }

    if (hasError) {
      const errorDescription = hashParams.get('error_description') || 'Authentication failed';
      toast.error(`Authentication Error: ${errorDescription}`);
      setProcessingOAuth(false);
      window.history.replaceState(null, '', '/auth');
      return;
    }

    if (!authLoading && user && !showResetPassword) {
      setProcessingOAuth(false);

      const checkProfile = async () => {
        // Read redirect at the latest possible moment, right before navigating
        const redirectTo = getAuthRedirect();

        try {
          const { data: profile, error } = await supabase
            .from('profiles')
            .select('id, role, terms_agreement')
            .eq('id', user.id)
            .maybeSingle();

          if (window.location.hash && !showResetPassword) {
            window.history.replaceState(null, '', '/auth');
          }

          if (error) {
            if (import.meta.env.DEV) {
              console.error('Error checking profile:', error);
            }
          }

          if (!profile || !profile.role) {
            const to = redirectTo ? `/select-role?redirect=${encodeURIComponent(redirectTo)}` : '/select-role';
            navigate(to, { replace: true });
          } else if (profile.role === 'teacher' && profile.terms_agreement !== true) {
            const to = redirectTo ? `/teacher-terms-agreement?redirect=${encodeURIComponent(redirectTo)}` : '/teacher-terms-agreement';
            navigate(to, { replace: true });
          } else {
            clearAuthRedirect();
            // AU-004a: the intent has done its job once the redirect resolves.
            clearAuthIntent();
            // Nothing to return to: staff start on their own home (Verify papers, HOD desk, Review teachers, Admin).
            let home: string | null = null;
            if (!redirectTo) {
              try {
                home = await resolveRoleHome(user.id);
              } catch {
                home = null;
              }
            }
            navigate(redirectTo || home || '/', { replace: true });
          }
        } catch (error) {
          if (import.meta.env.DEV) {
            console.error('Error checking profile:', error);
          }
          const to = redirectTo ? `/select-role?redirect=${encodeURIComponent(redirectTo)}` : '/select-role';
          navigate(to, { replace: true });
        }
      };

      setTimeout(checkProfile, hasAccessToken ? 500 : 200);
    }

    if (hasAccessToken && authLoading && !showResetPassword) {
      const waitTimer = setTimeout(() => {
        if (!user) {
          setProcessingOAuth(false);
          toast.error('Authentication timed out. Please try again.');
          window.history.replaceState(null, '', '/auth');
        }
      }, 3000);
      return () => clearTimeout(waitTimer);
    }
  }, [user, authLoading, navigate, showResetPassword]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setErrors({ ...errors, [e.target.name]: '' });
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});

    const result = signupSchema.safeParse(formData);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach((err) => {
        if (err.path[0]) {
          fieldErrors[err.path[0] as string] = err.message;
        }
      });
      setErrors(fieldErrors);
      setLoading(false);
      return;
    }

    try {
      const { error } = await signUpWithEmail(
        formData.email,
        formData.password,
        formData.fullName
      );

      if (error) {
        // Use generic error messages to prevent information disclosure
        if (error.message.includes('already exists') || error.message.includes('already registered')) {
          setErrors({ email: 'An account with this email already exists. Please sign in or use a different email.' });
        } else {
          toast.error('Failed to create account. Please try again.');
        }
        setLoading(false);
      } else {
        toast.success('Account created successfully! Please check your email to verify your account. If you don\'t see it, check your Spam or Junk folder.');
        // Reset form
        setFormData({ fullName: '', email: '', password: '', confirmPassword: '', newPassword: '', confirmNewPassword: '' });
        setErrors({});
        setLoading(false);
      }
    } catch (error: any) {
      toast.error('Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});

    const result = signinSchema.safeParse(formData);
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      result.error.errors.forEach((err) => {
        if (err.path[0]) {
          fieldErrors[err.path[0] as string] = err.message;
        }
      });
      setErrors(fieldErrors);
      setLoading(false);
      return;
    }

    try {
      const { error } = await signInWithEmail(formData.email, formData.password);

      if (error) {
        // Use generic error messages to prevent information disclosure
        if (error.message.includes('Google')) {
          setErrors({ email: 'You previously signed in with Google. Please use the "Continue with Google" button.' });
        } else {
          // Always show generic error for sign-in failures
          setErrors({ password: 'Invalid email or password' });
        }
        setLoading(false);
      } else {
        toast.success('Welcome back!');
        // User will be redirected by useEffect
      }
    } catch (error: any) {
      toast.error('Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  /* "Send me a link" — the primary action account-01-sign-in.png draws.
     Errors surface inline rather than as a toast, because the most likely
     failure here is a project-level mail configuration problem and the person
     reading it needs the actual reason, not "something went wrong". */
  const [magicSent, setMagicSent] = useState(false);
  const [magicLoading, setMagicLoading] = useState(false);
  // Whether the form is in "email me a link" mode. Separate from the
  // send itself: toggling this just swaps which fields/CTA show — it must
  // not fire validation or the send request on its own (that used to happen
  // because the toggle button called handleMagicLink directly, which meant
  // clicking it with an empty Email field immediately painted a destructive
  // ring, as if the user had made an error before typing anything).
  const [magicLinkMode, setMagicLinkMode] = useState(false);

  const handleMagicLink = async () => {
    setErrors({});
    const parsed = emailSchema.safeParse(formData.email);
    if (!parsed.success) {
      setErrors({ email: 'Enter the email you want the link sent to' });
      return;
    }
    setMagicLoading(true);
    const { error } = await sendMagicLink(formData.email);
    setMagicLoading(false);
    if (error) {
      setErrors({ email: error.message });
      return;
    }
    setMagicSent(true);
  };

  const toggleMagicLinkMode = () => {
    setMagicLinkMode((prev) => !prev);
    setErrors({});
    setMagicSent(false);
  };

  const handleGoogleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      toast.error('Failed to sign in with Google');
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});

    const result = emailSchema.safeParse(formData.email);
    if (!result.success) {
      setErrors({ email: result.error.errors[0].message });
      setLoading(false);
      return;
    }

    try {
      const { error } = await resetPasswordForEmail(formData.email);
      if (error) {
        setErrors({ email: error.message || 'Failed to send reset email' });
        setLoading(false);
      } else {
        toast.success('Password reset email sent! Please check your inbox.');
        setShowForgotPassword(false);
        setFormData({ ...formData, email: '' });
        setErrors({});
        setLoading(false);
      }
    } catch (error: any) {
      toast.error('Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});

    const passwordResult = passwordSchema.safeParse(formData.newPassword);
    if (!passwordResult.success) {
      setErrors({ newPassword: passwordResult.error.errors[0].message });
      setLoading(false);
      return;
    }

    if (formData.newPassword !== formData.confirmNewPassword) {
      setErrors({ confirmNewPassword: 'Passwords do not match' });
      setLoading(false);
      return;
    }

    try {
      const { error } = await updatePassword(formData.newPassword);
      if (error) {
        setErrors({ newPassword: error.message || 'Failed to update password' });
        setLoading(false);
      } else {
        toast.success('Password updated successfully! You can now sign in with your new password.');
        setShowResetPassword(false);
        setFormData({ ...formData, newPassword: '', confirmNewPassword: '' });
        setErrors({});
        setIsLogin(true);
        // Clean up URL
        window.history.replaceState(null, '', '/auth');
        setLoading(false);
      }
    } catch (error: any) {
      toast.error('Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  // Switches sign-in / create-account mode. Formerly driven by a segmented
  // tab pill above the Google button (owner mobile-QA fix, bug 2); now
  // triggered by the small "Create an account" / "Sign in" link that sits
  // under the email form's submit button once that form is open.
  const switchAuthMode = (loginMode: boolean) => {
    if (isLogin === loginMode) return;
    setIsLogin(loginMode);
    setErrors({});
    setFormData({ fullName: '', email: '', password: '', confirmPassword: '', newPassword: '', confirmNewPassword: '' });
    setMagicLinkMode(false);
    setMagicSent(false);
  };

  // Show loading state while processing OAuth callback
  if (processingOAuth || (authLoading && window.location.hash.includes('access_token'))) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-panel">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-2 border-white/20 border-b-brand" />
          <p className="text-base text-background/70">Completing sign in...</p>
        </div>
      </div>
    );
  }

  // Redesign S6 (design.md §1, §6.5; changelog C-032) — rebuilt from zero.
  // The whole opener is one near-black ControlBlock-style ground (mockup S6):
  // logo + Skip, a scattered proof mosaic of tilted pills, then a "Free,
  // always" eyebrow, the display headline, Google, and the credentials form.
  // The mockup draws a magic-link ("Send me a link") flow; that machinery does
  // not exist in this app (Supabase email/password + Google only), so the
  // dark field row is reused for the real password form instead — reported.
  // Handoff AU-006: rounded-[18px] (was rounded-xl/12px, not even the
  // entry's own "Before" of 14px), and text-[16px] -- 15px is below the
  // "inputs stay >=16px or iOS zooms on focus" floor the entry warns about.
  const DARK_FIELD =
    'w-full box-border min-h-[54px] h-[54px] px-4 rounded-[18px] bg-white/[0.08] text-[16px] text-background placeholder:text-background/40 outline-none shikshaq-auth-field';
  const DARK_FIELD_ERROR = 'ring-2 ring-destructive';
  /* AU-004a variant A takes the real published paper count for its third
     pill. Variant F's counts are deliberately not passed — see AuthHero. */
  const hero = resolveAuthHero(authIntent, { papers: paperCount });

  return (
    <div className="flex min-h-screen flex-col bg-background max-lg:h-[100dvh] max-lg:overflow-hidden lg:h-screen lg:overflow-hidden">
      {/* Handoff AU-003: the page splits into two stacked blocks with a 6px
          seam, instead of one flat near-black ground. Desktop keeps the same
          two blocks side by side rather than stacked (06's own geometry
          appendix only specifies the 375px stack; this is the least-surprise
          desktop analogue). */}
      {/* lg:items-stretch, not items-center. Centred, the dark sign-in block
          floated at a different height from the orange one and the pair read as
          two unrelated cards dropped on the page. Stretched, they are one
          split panel — which is what AU-003 describes. */}
      {/* Owner call, reversing the two comments this replaces: a
          content-sized, centred 1000px pair of cards left ~450px of empty
          page ground on every side at a real desktop width — "two black
          boxes wasting a lot of space." Full-bleed now: the row fills the
          entire viewport, edge to edge, split into the two halves below.
          max-lg: still a bounded-height flex column so `main` can scroll
          internally on a short mobile viewport. */}
      <div className="max-lg:flex max-lg:h-full max-lg:min-h-0 max-lg:flex-col lg:flex lg:h-full lg:w-full lg:items-stretch">

        {/* Hero block (AU-003 point 1) — nav row, eyebrow, h1, sticker
            cluster. This block is the page's whole accent budget.

            Handoff AU-004a: its fill, ink, eyebrow, sentence and stickers all
            come from the intent that opened the gate (variants A–H). The
            near-black sign-in block below never changes shape — only its
            sub-line and value-note copy follow, per the same entry. */}
        {/* lg:flex-col + the nav pinned by mb-auto's absence: at desktop this
            column is as tall as the sign-in block beside it, and top-aligned
            content left a third of the panel as empty fill. The headline group
            now centres in the space below the nav row. */}
        <div className={`max-lg:shrink-0 rounded-t-bento px-5 pb-[26px] lg:relative lg:flex lg:h-full lg:flex-1 lg:flex-col lg:justify-center lg:overflow-y-auto lg:rounded-none lg:px-16 lg:py-14 ${hero.ink.fill}`}>
          <header className="flex items-center justify-between gap-3 pt-4 lg:absolute lg:inset-x-0 lg:top-0 lg:px-16 lg:pt-10">
            <Logo size="md" ariaLabel="Back to home" onDark={hero.ink.onDark} />
            <Link
              to="/"
              className={`inline-flex min-h-11 items-center px-2 py-1 text-[13px] font-semibold ${hero.ink.quiet}`}
            >
              Skip
            </Link>
          </header>

          {showResetPassword ? (
            <h1 className={`mt-5 font-display text-[34px] font-black leading-[1.02] tracking-[-0.04em] text-balance ${hero.ink.text}`}>
              Reset your password
            </h1>
          ) : (
            <>
              {/* Handoff AU-004: eyebrow on the hero block. */}
              <p className={`mt-5 text-[12px] font-bold uppercase tracking-[0.08em] ${hero.ink.quiet}`}>
                {hero.eyebrow}
              </p>
              {/* h1 46px/.92/-0.055em/400 with the highlighted span at 900 on
                  a block of the inverse value. Line breaks are fixed.
                  Variant H is a single 36px line and carries no highlight. */}
              {/* The weight classes are branched, not layered: leaving
                  `font-normal` on the element and adding `font-black` after it
                  leaves both in the class list at equal specificity, and the
                  stylesheet's own order decides — which resolved to 400. */}
              <h1
                className={`mt-1 font-display leading-[.92] tracking-[-0.055em] text-balance ${
                  hero.compact ? 'text-[36px] font-black' : 'text-[46px] font-normal'
                } ${hero.ink.text}`}
              >
                {hero.sentence}
              </h1>

              {/* Handoff AU-003a / AU-004a: the sticker cluster under the h1,
                  its contents chosen by intent. */}
              {hero.stickers}
            </>
          )}
        </div>

      {/* Handoff O-011 made the help FAB route-aware: on a chromeless route
          like this one it now parks at bottom-24px (not the bottom-nav
          bottom-88px it used to use everywhere), so it only occupies the
          52px circle 24px-76px from the viewport bottom, right-aligned.
          pb-20 keeps the disclaimer's last line clear of that corner
          without the much larger reserve the old route-unaware FAB needed.
          Handoff AU-003 point 2: near-black sign-in block, bg-panel
          rounded-bento p-[22px_20px] flex-1.
          No seam / no rounded-bento here on mobile any more: the two
          blocks used to sit rounded-b-bento / rounded-bento with a 6px
          bg-background seam between them, which put a sliver of page
          ground in the notch where both blocks' corners curved apart —
          a stray line right where the fill changes colour. They now
          share one continuous rounded shape (hero rounded-t-bento, this
          one rounded-b-bento, no gap). At lg both blocks go flush/
          unrounded and fill the whole viewport edge to edge instead —
          see the row div's own comment above. */}
      <main className="flex-1 max-lg:min-h-0 max-lg:overflow-y-auto rounded-b-bento bg-panel p-[22px_20px] pb-20 lg:flex lg:h-full lg:flex-1 lg:flex-col lg:justify-center lg:overflow-y-auto lg:rounded-none lg:px-16 lg:py-14 lg:pb-14">
        <div className="mx-auto w-full max-w-[470px] lg:mx-0 lg:max-w-[420px]">
          <div className="flex flex-col gap-[18px]">
            <div>
              {/* Handoff AU-004: sub-line moves here, first element of the
                  dark block. */}
              {/* AU-004a: the sub-line follows the intent too. The
                  create-account and reset-password wordings still win when
                  the visitor has switched into one of those modes — the
                  intent describes why they arrived, not which form is open. */}
              <p className="text-[15px] leading-[1.6] text-[rgba(249,245,241,.7)]">
                {showResetPassword
                  ? 'Enter your new password below'
                  : isLogin
                  ? hero.subline
                  : 'Join Shikshaq to find the best tutors'}
              </p>
            </div>

            {/* Owner mobile-QA fix (bugs 1 & 2): the sign-in/create-account
                segmented tab pill is removed — Google/email auth here is
                mode-agnostic (signUpWithEmail vs signInWithEmail still run
                as separate Supabase calls, gated below by isLogin, but the
                mode no longer needs a prominent tab switcher up top). Google
                is now the immediate, sole, full-weight CTA right after the
                h1/sentence; email sign-in is a small link beneath it (see
                showEmailForm), and switching sign-in/create-account is a
                small inline link near the email form's submit button. */}
            {!showResetPassword && (
              <div className="flex flex-col gap-[10px]">
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  className="shikshaq-tap flex min-h-[54px] w-full items-center justify-center gap-[10px] rounded-[18px] bg-background text-[15px] font-bold text-foreground transition-transform duration-150 hover:-translate-y-0.5 active:scale-[0.98]"
                >
                  <GoogleIcon size={20} />
                  Continue with Google
                </button>
                {!showForgotPassword && (
                  <button
                    type="button"
                    onClick={() => setShowEmailForm((prev) => !prev)}
                    className="shikshaq-tap mx-auto mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-background/60 underline underline-offset-2"
                  >
                    {showEmailForm ? 'Hide email sign-in' : 'Sign in with email'}
                  </button>
                )}
              </div>
            )}

            {/* Reset Password Form */}
            {showResetPassword ? (
              <form onSubmit={handleResetPassword} className="flex flex-col gap-4">
                <div>
                  <label htmlFor="newPassword" className="mb-2 block text-sm font-semibold text-background">New Password</label>
                  <input
                    id="newPassword"
                    name="newPassword"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Enter new password"
                    value={formData.newPassword}
                    onChange={handleInputChange}
                    className={`${DARK_FIELD} ${errors.newPassword ? DARK_FIELD_ERROR : ''}`}
                  />
                  {errors.newPassword && <p className="mt-2 text-sm text-destructive">{errors.newPassword}</p>}
                </div>

                <div>
                  <label htmlFor="confirmNewPassword" className="mb-2 block text-sm font-semibold text-background">Confirm New Password</label>
                  <input
                    id="confirmNewPassword"
                    name="confirmNewPassword"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Confirm new password"
                    value={formData.confirmNewPassword}
                    onChange={handleInputChange}
                    className={`${DARK_FIELD} ${errors.confirmNewPassword ? DARK_FIELD_ERROR : ''}`}
                  />
                  {errors.confirmNewPassword && <p className="mt-2 text-sm text-destructive">{errors.confirmNewPassword}</p>}
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="shikshaq-tap flex min-h-[54px] w-full items-center justify-center gap-2 rounded-[18px] bg-brand text-[15px] font-bold text-brand-foreground hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {loading ? 'Updating password...' : 'Update Password'}
                </button>
              </form>
            ) : (showEmailForm || showForgotPassword) && (
              /* Regular Sign In / Sign Up form — mounted only once the
                 "Sign in with email" link (or, once inside it, "Forgot
                 password?") has been used; see showEmailForm above. */
              <form
                onSubmit={(e) => {
                  if (magicLinkMode) {
                    e.preventDefault();
                    handleMagicLink();
                    return;
                  }
                  return isLogin ? handleSignIn(e) : handleSignUp(e);
                }}
                className="flex flex-col gap-4"
              >
                {!isLogin && (
                  <div className="animate-fade-slide-up">
                    <label htmlFor="fullName" className="mb-2 block text-sm font-semibold text-background">Full name</label>
                    <input
                      id="fullName"
                      name="fullName"
                      type="text"
                      autoComplete="name"
                      placeholder="Enter your name"
                      value={formData.fullName}
                      onChange={handleInputChange}
                      className={`${DARK_FIELD} ${errors.fullName ? DARK_FIELD_ERROR : ''}`}
                    />
                    {errors.fullName && <p className="mt-2 text-sm text-destructive">{errors.fullName}</p>}
                  </div>
                )}

                {!showForgotPassword && (
                  <div>
                    <label htmlFor="email" className="mb-2 block text-sm font-semibold text-background">Email</label>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder="you@email.com"
                      value={formData.email}
                      onChange={handleInputChange}
                      className={`${DARK_FIELD} ${errors.email ? DARK_FIELD_ERROR : ''}`}
                    />
                    {errors.email && <p className="mt-2 text-sm text-destructive">{errors.email}</p>}

                    {/* "Send me a link" sits immediately under the email field,
                        which is the order account-01-sign-in.png draws: Google,
                        "or", the address, then the link. Putting it above the
                        field — as this first did — asks you to press a button
                        before there is anywhere to type. Password sign-in
                        continues below; this is the default path, not the only
                        one, because eight existing accounts have passwords. */}
                    {isLogin && (magicSent ? (
                      <p className="mt-3 rounded-[18px] bg-white/[0.08] px-4 py-3 text-[14px] leading-[1.5] text-background/80">
                        Link sent to <span className="font-semibold text-background">{formData.email}</span>. Open it on
                        this device and you are in, no password needed.
                      </p>
                    ) : (
                      /* Demoted to a plain-text toggle, not a second full-weight
                         button: Google is the one dominant CTA on this screen
                         (pages.md §8), and the password "Sign in" button below
                         is the form's own submit action. A second orange
                         54px button here competed with both. */
                      <button
                        type="button"
                        onClick={toggleMagicLinkMode}
                        disabled={magicLoading}
                        className="shikshaq-tap mt-2 inline-flex min-h-11 items-center gap-1.5 text-[14px] font-semibold text-indigo-link-on-dark disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {magicLinkMode ? 'Or sign in with a password instead' : 'Or email me a sign-in link instead'}
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                )}

                {!showForgotPassword && !magicLinkMode && (
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <label htmlFor="password" className="text-sm font-semibold text-background">Password</label>
                      {isLogin && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowForgotPassword(true);
                            setErrors({});
                            setFormData({ ...formData, password: '' });
                          }}
                          className="shikshaq-tap -my-3 inline-flex min-h-11 items-center px-1 text-sm font-semibold text-indigo-link-on-dark"
                        >
                          Forgot password?
                        </button>
                      )}
                    </div>
                    <input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete={isLogin ? 'current-password' : 'new-password'}
                      placeholder={isLogin ? 'Enter your password' : 'Create a password'}
                      value={formData.password}
                      onChange={handleInputChange}
                      className={`${DARK_FIELD} ${errors.password ? DARK_FIELD_ERROR : ''}`}
                    />
                    {errors.password && <p className="mt-2 text-sm text-destructive">{errors.password}</p>}
                  </div>
                )}

                {showForgotPassword && (
                  <div>
                    <div className="mb-2">
                      <label htmlFor="forgotEmail" className="mb-2 block text-sm font-semibold text-background">Email</label>
                      <input
                        id="forgotEmail"
                        name="email"
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        autoCapitalize="none"
                        spellCheck={false}
                        placeholder="you@email.com"
                        value={formData.email}
                        onChange={handleInputChange}
                        className={`${DARK_FIELD} ${errors.email ? DARK_FIELD_ERROR : ''}`}
                      />
                      {errors.email && <p className="mt-2 text-sm text-destructive">{errors.email}</p>}
                    </div>
                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowForgotPassword(false);
                          setErrors({});
                          setFormData({ ...formData, email: '' });
                        }}
                        className="shikshaq-tap min-h-12 flex-1 rounded-[18px] bg-white/[0.08] text-sm font-semibold text-background hover:-translate-y-0.5"
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        onClick={handleForgotPassword}
                        disabled={loading}
                        className="shikshaq-tap flex min-h-12 flex-1 items-center justify-center gap-2 rounded-[18px] bg-brand text-sm font-semibold text-brand-foreground hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                      >
                        {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                        {loading ? 'Sending...' : 'Send Reset Link'}
                      </button>
                    </div>
                    <p className="mt-4 text-sm text-background/60">We'll send you a link to reset your password</p>
                  </div>
                )}

                {!isLogin && !showForgotPassword && (
                  <div>
                    <label htmlFor="confirmPassword" className="mb-2 block text-sm font-semibold text-background">Confirm Password</label>
                    <input
                      id="confirmPassword"
                      name="confirmPassword"
                      type="password"
                      autoComplete="new-password"
                      placeholder="Confirm your password"
                      value={formData.confirmPassword}
                      onChange={handleInputChange}
                      className={`${DARK_FIELD} ${errors.confirmPassword ? DARK_FIELD_ERROR : ''}`}
                    />
                    {errors.confirmPassword && <p className="mt-2 text-sm text-destructive">{errors.confirmPassword}</p>}
                  </div>
                )}

                {!showForgotPassword && !(magicLinkMode && magicSent) && (
                  <button
                    type="submit"
                    disabled={magicLinkMode ? magicLoading : loading}
                    className="shikshaq-tap flex min-h-[54px] w-full items-center justify-center gap-2 rounded-[18px] bg-brand text-[15px] font-bold text-brand-foreground transition-transform duration-150 hover:-translate-y-0.5 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:active:scale-100"
                  >
                    {(magicLinkMode ? magicLoading : loading) && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    {magicLinkMode
                      ? (magicLoading ? 'Sending link...' : 'Send link')
                      : (loading ? 'Please wait...' : isLogin ? 'Sign in' : 'Create account')}
                  </button>
                )}
              </form>
            )}

            {/* Owner mobile-QA fix (bug 2): replaces the removed segmented
                tab pill as the only way to reach sign-up — kept small and
                textual rather than a competing full-weight control. Only
                shown once the email form is actually open. */}
            {showEmailForm && !showForgotPassword && !magicLinkMode && (
              <p className="text-center text-[14px] text-background/60">
                {isLogin ? 'New here? ' : 'Already have an account? '}
                <button
                  type="button"
                  onClick={() => switchAuthMode(!isLogin)}
                  className="shikshaq-tap font-semibold text-indigo-link-on-dark underline underline-offset-2"
                >
                  {isLogin ? 'Create an account' : 'Sign in'}
                </button>
              </p>
            )}

            {/* Handoff AU-007 (new): names what signing in actually unlocks —
                the gate sheets elsewhere say this, this page never did. */}
            {!showResetPassword && !showForgotPassword && (
              /* One note, one string. This had been rebuilt as eight per-intent
                 bodies with a tinted left rule, which broke AU-004a twice over
                 — that entry says the dark block "never changes: same Google
                 button, same email link, SAME VALUE NOTE" — and AU-007 calls
                 its body "the only new copy on this page". The eight invented
                 bodies were also the weakest writing here: eight restatements
                 of the same reassurance under one repeated label. This names
                 the three things an account actually does and stops. */
              <div className="rounded-[20px] bg-white/[0.06] p-4">
                <p className="text-[12px] font-bold uppercase tracking-[0.04em] text-[rgba(249,245,241,.5)]">
                  Why sign in
                </p>
                <p className="mt-1.5 text-[14px] leading-[1.55] text-[rgba(249,245,241,.75)]">
                  Message teachers on WhatsApp, save a shortlist, and open past papers. It is all free.
                </p>
              </div>
            )}

            {!showResetPassword && !showForgotPassword && (
              <p className="text-[12px] leading-relaxed text-background/45">
                By continuing you agree to our{' '}
                {/* target="_blank" — not a client-side <Link> — so reading the legal
                    text mid sign-up doesn't unmount this form and lose whatever the
                    person already typed (name/email/password). Matches the same
                    fix already applied on select-role and teacher-terms-agreement. */}
                <a href="/terms-of-service" target="_blank" rel="noopener noreferrer" className="-my-3.5 inline-flex min-h-11 items-center px-0.5 align-middle font-semibold text-background/70 underline">
                  Terms of Service
                </a>{' '}
                and{' '}
                <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="-my-3.5 inline-flex min-h-11 items-center px-0.5 align-middle font-semibold text-background/70 underline">
                  Privacy Policy
                </a>
                . Your number is never shared with a teacher until you message them.
              </p>
            )}
          </div>
        </div>
      </main>
      </div>

      <style>{`
        .shikshaq-auth-field { transition: box-shadow .15s ease; }
        .shikshaq-auth-field:focus { box-shadow: 0 0 0 2px hsl(var(--background)) !important; outline: none; }
      `}</style>
    </div>
  );
}

function GoogleIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
