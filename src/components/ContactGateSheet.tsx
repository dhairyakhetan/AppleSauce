import * as React from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Sheet, SheetContent, SheetDescription, SheetGrabHandle, SheetTitle } from "@/components/ui/sheet";
import { StripePlaceholder } from "@/components/ui/stripe-placeholder";
import { validateImageSrc } from "@/utils/imageSanitizer";
import { useAuth } from "@/lib/auth-context";
import { saveAuthRedirect } from "@/utils/authRedirect";

/* pages.md §9 "WhatsApp gate" + design.md §3 — "WhatsApp tap (signed out):
   soft sheet slides up — never a route change; after auth, continue straight
   to the redirect that was tapped." Same behaviour covers the save/heart tap.
   This is the one shared sheet used everywhere a signed-out visitor triggers
   a gated action, so the redirect-continuation logic lives in one place.

   Canonical implementation of the "WhatsApp contact gate" pattern — the
   src/components/auth/gate-sheet.tsx `flavor: "whatsapp"` variant was an
   orphaned duplicate (never wired to the real Message-on-WhatsApp flow) and
   was removed in favour of this file. */

interface ContactGateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** What the visitor was trying to do — shapes the copy only. */
  intent?: "message" | "save" | "review";
  /**
   * Who they were trying to reach. account-02-whatsapp-gate.png titles this
   * sheet "Message Anirban Ghosh", and micro-02's copy rule says the same in
   * different words: "One tap, then you are talking to Anjali — names the
   * teacher". The sheet said only "Sign in to message teachers", so someone who
   * tapped Message on Kavita's profile got a generic prompt that never
   * mentioned Kavita — dropping the one piece of context that makes the
   * interruption feel like part of the thing they asked for.
   *
   * Optional: callers that genuinely have no single teacher in view (none
   * today) fall back to the generic wording rather than inventing a name.
   */
  teacherName?: string | null;
  /** Handoff O-005: the object being unlocked gets a real photo (or the
   *  StripePlaceholder ground when there isn't one) — never an icon glyph. */
  teacherImageUrl?: string | null;
  teacherSubject?: string | null;
  teacherArea?: string | null;
}

/* Handoff O-005's copy table, first-person pronoun swapped in from
   teacherPronoun (defaults to a gender-neutral "them" — none of this
   codebase's teacher data carries a pronoun field, so "her/him" from the
   table's own literal example is not something this can know to pick). */
function gateHeading(intent: "message" | "save" | "review", firstName: string | null) {
  if (intent === "message") {
    return firstName ? (
      <>Sign in to <b className="font-extrabold">message {firstName}</b> on WhatsApp.</>
    ) : (
      <>Sign in to <b className="font-extrabold">message on WhatsApp</b>.</>
    );
  }
  if (intent === "review") {
    return firstName ? (
      <>Sign in to <b className="font-extrabold">review {firstName}</b>.</>
    ) : (
      <>Sign in to <b className="font-extrabold">leave a review</b>.</>
    );
  }
  return firstName ? (
    <>Sign in to <b className="font-extrabold">save {firstName}</b> to your shortlist.</>
  ) : (
    <>Sign in to <b className="font-extrabold">save this teacher</b>.</>
  );
}

/* Google's four brand colours, monochrome "G" from account-02's mockup swapped
   for the real mark — same treatment Auth.tsx uses for its own Google button. */
function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

export function ContactGateSheet({
  open,
  onOpenChange,
  intent = "message",
  teacherName,
  teacherImageUrl,
  teacherSubject,
  teacherArea,
}: ContactGateSheetProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { signInWithGoogle } = useAuth();
  const [googleBusy, setGoogleBusy] = React.useState(false);

  const firstName = teacherName ? teacherName.trim().split(/\s+/)[0] : null;
  const safeImage = teacherImageUrl ? validateImageSrc(teacherImageUrl) : null;
  const metaLine = [teacherSubject, teacherArea].filter(Boolean).join(" · ");

  const handleSignIn = () => {
    saveAuthRedirect(location.pathname);
    navigate(`/auth?redirect=${encodeURIComponent(location.pathname)}`);
  };

  const handleGoogle = async () => {
    saveAuthRedirect(location.pathname);
    setGoogleBusy(true);
    try {
      await signInWithGoogle();
      // signInWithGoogle redirects the browser via Supabase OAuth; on return,
      // Auth.tsx reads getAuthRedirect() and lands the user back where they tapped.
    } catch {
      setGoogleBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* Handoff O-005: this sheet only ever offers sign-in actions — no
          "Not now" CTA. The sheet's own close X (rendered by SheetContent)
          and swipe-to-dismiss are the one escape rule 5 requires. */}
      <SheetContent side="bottom" className="border-0 px-5 pb-[26px]">
        <SheetGrabHandle />
        {teacherName ? (
          <div className="flex items-center gap-3">
            <div className="h-[52px] w-[52px] flex-none overflow-hidden rounded-full">
              {safeImage ? (
                <img src={safeImage} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
              ) : (
                <StripePlaceholder name={teacherName} initialSize={20} />
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate text-[16px] font-bold tracking-[-0.02em] text-foreground">{teacherName}</div>
              {metaLine ? <div className="truncate text-[13px] text-warm-meta">{metaLine}</div> : null}
            </div>
          </div>
        ) : null}

        {/* SheetTitle labels the dialog for assistive tech (Radix requires
            one); visually it IS the heading O-005 specifies. */}
        <SheetTitle className={`${teacherName ? 'mt-[18px]' : ''} font-display text-[26px] font-normal leading-[1.1] tracking-[-0.045em] text-foreground`}>
          {gateHeading(intent, firstName)}
        </SheetTitle>
        <SheetDescription className="mt-2.5 text-[15px] leading-[1.55] text-warm-prose">
          One tap with Google. We&rsquo;ll take you straight to {intent === 'review' ? 'the review form' : intent === 'save' ? 'your shortlist' : 'the chat'}.
        </SheetDescription>

        <button
          type="button"
          disabled={googleBusy}
          onClick={handleGoogle}
          className="mt-5 flex h-14 w-full items-center justify-center gap-2.5 rounded-[18px] bg-panel text-[16px] font-extrabold text-background transition-transform duration-tap active:scale-[0.98] disabled:opacity-70"
        >
          <GoogleIcon size={20} />
          {googleBusy ? 'Signing in…' : 'Continue with Google'}
        </button>
        <button
          type="button"
          onClick={handleSignIn}
          className="mt-2 flex h-11 w-full items-center justify-center text-[14px] font-semibold text-warm-prose"
        >
          Other ways to sign in
        </button>
        <p className="mt-1.5 text-center text-[12px] text-warm-label">Free. We never take a commission.</p>
      </SheetContent>
    </Sheet>
  );
}
