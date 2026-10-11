import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { Check, ArrowRight } from 'lucide-react';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { getAuthRedirect, clearAuthRedirect } from '@/utils/authRedirect';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { logger } from '@/utils/logger';
import { BentoPanel } from '@/components/layout/PageContainer';
import { usePageMeta } from '@/hooks/usePageMeta';

/* C-044 — "Success is an orange slab with a ghosted check, a 'You're in' sticker, and a green
   button that resumes the exact message the user was about to send." The saved-intent handoff
   (design.md §6.5 / gate-sheet.tsx) is what actually resumes the right destination: the primary
   CTA reads getAuthRedirect() and, if the user tapped WhatsApp before signing in, that redirect
   target IS /tuition-teachers/:slug/whatsapp-click — the interstitial that reopens WhatsApp with
   the message already composed. Never drops back to a generic home page when an intent exists. */
export default function SignUpSuccess() {
  usePageMeta(
    'Welcome to Shikshaq | Shikshaq',
    'Your account is ready. Verify your email to continue.',
  );

  const { user } = useAuth();
  const navigate = useNavigate();
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate('/auth', { replace: true });
    }
  }, [user, navigate]);

  if (!user) {
    return null;
  }

  const redirectTo = getAuthRedirect();
  const hasIntent = Boolean(redirectTo && redirectTo !== '/');

  const handleContinue = () => {
    clearAuthRedirect();
    navigate(redirectTo || '/');
  };

  // Handoff SS-001: "Resend the email" is real functionality, not the
  // mockup's decoration — Supabase's own resend endpoint, since nothing in
  // this codebase already exposed one.
  const handleResend = async () => {
    if (!user.email || resending) return;
    setResending(true);
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email: user.email });
      if (error) throw error;
      toast.success(`Verification email resent to ${user.email}`);
    } catch (error) {
      logger.error('SignUpSuccess.resend', error);
      toast.error("Couldn't resend the email. Try again in a moment.");
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Handoff SS-001: one full-height mint panel, content vertically
          centred. Chromeless route (no navbar), so the brand mark that
          every other page gets from the floating global nav has to be
          drawn here instead. */}
      <BentoPanel fill="mint" edge="top" className="flex min-h-screen flex-col px-5 pb-8 pt-1.5">
        <Logo size="nav" />
        <div className="flex flex-1 flex-col justify-center">
          <span className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[#34B268]">
            <Check className="h-[34px] w-[34px] text-white" strokeWidth={2.5} aria-hidden="true" />
          </span>
          <h1 className="mt-[22px] font-display text-[34px] font-black leading-[1.02] tracking-[-0.045em] text-[#24603D]">
            {hasIntent ? 'Account ready.' : "You're in."}
          </h1>
          <h2 className="mt-3.5 text-[16px] font-bold text-foreground">Verify your email</h2>
          <p className="mt-1.5 text-[15px] leading-[1.55] text-[#3E6F53]">
            We sent a link to <strong className="text-foreground">{user.email}</strong>. Open it
            once and your account is confirmed. You can keep browsing in the meantime.
          </p>

          <div className="mt-[22px] flex flex-col gap-2">
            <Button variant="primary" size={54} onClick={handleContinue} className="w-full !bg-panel !text-background">
              {hasIntent ? 'Continue to WhatsApp' : 'Continue to home'}
              <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
            </Button>
            <button
              type="button"
              onClick={handleResend}
              disabled={resending}
              className="flex h-11 w-full items-center justify-center text-[14px] font-semibold text-[#3E6F53] disabled:opacity-60"
            >
              {resending ? 'Resending…' : 'Resend the email'}
            </button>
          </div>
        </div>
      </BentoPanel>
    </div>
  );
}
