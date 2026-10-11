import * as React from "react";
import { useNavigate } from "react-router-dom";
import { FileText } from "lucide-react";

import { Sheet, SheetContent, SheetDescription, SheetGrabHandle, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth-context";
import { saveAuthRedirect } from "@/utils/authRedirect";
import { getSubjectPalette } from "@/lib/subject-palette";

/* Redesign F3 (components.md §4, design.md §6.5), restyled to Handoff O-005.

   Papers flavour of the sign-in gate — the same shape as
   src/components/ContactGateSheet.tsx (the canonical teacher-gate
   implementation), with the object being unlocked drawn as a 52x40 paper
   cover instead of an avatar. The two intentionally share the same
   structure: handle -> object -> heading -> support line -> Google button
   -> "Other ways to sign in" -> footnote. This sheet only ever offers
   sign-in actions (rule 5) — no "not now" escape beyond the sheet's own
   close X / swipe-to-dismiss.

   Remembers the intent (via saveAuthRedirect — the same mechanism
   PaperReader / TeacherProfile already use) and replays it after sign-in:
   the caller passes `redirectTo`, this sheet stashes it in localStorage
   before handing off to /auth, and Auth.tsx's existing
   getAuthRedirect()/clearAuthRedirect() flow lands the user back on the
   exact paper they asked for. Never fetches anything gated before auth
   completes. */
export interface GateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where to land the user after a successful sign-in. */
  redirectTo: string;
  flavor: "papers";
  /** Handoff O-005 rule 4: names the specific paper, not a generic prompt. */
  paperTitle?: string | null;
  paperSubject?: string | null;
}

function GateSheet({ open, onOpenChange, redirectTo, paperTitle, paperSubject }: GateSheetProps) {
  const navigate = useNavigate();
  const { signInWithGoogle } = useAuth();
  const [busy, setBusy] = React.useState(false);
  const palette = paperSubject ? getSubjectPalette(paperSubject) : null;

  /* O-005 says "the sheet writes the auth intent before it navigates". It is
     written by PaperReader instead, at the point it opens this sheet, and
     deliberately not duplicated here: the paper intent needs title, board,
     school and subject slug (AU-004a), and this sheet is only given title and
     subject. A partial write here would fail auth-intent.ts's validation and
     knock the hero back to the default — worse than not writing at all. */
  const goAuth = () => {
    saveAuthRedirect(redirectTo);
    navigate("/auth");
  };

  const handleGoogle = async () => {
    saveAuthRedirect(redirectTo);
    setBusy(true);
    try {
      await signInWithGoogle();
      // signInWithGoogle redirects the browser via Supabase OAuth; on return,
      // Auth.tsx reads getAuthRedirect() and lands the user on `redirectTo`.
    } catch {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="border-0 px-5 pb-[26px]">
        <SheetGrabHandle />

        {paperTitle ? (
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-[52px] flex-none items-center justify-center rounded-[6px]"
              style={{ backgroundColor: palette?.tint ?? "hsl(var(--muted))" }}
            >
              <FileText className="h-4 w-4" style={{ color: palette?.text }} aria-hidden="true" />
            </div>
            <div className="min-w-0 text-[14px] font-bold leading-[1.3] text-foreground">{paperTitle}</div>
          </div>
        ) : null}

        <SheetTitle className={`${paperTitle ? 'mt-[18px]' : ''} font-display text-[26px] font-normal leading-[1.1] tracking-[-0.045em] text-foreground`}>
          Sign in to <b className="font-extrabold">open {paperTitle || 'this paper'}</b>.
        </SheetTitle>
        <SheetDescription className="mt-2.5 text-[15px] leading-[1.55] text-warm-prose">
          One tap with Google. Free, and it takes one tap to keep reading.
        </SheetDescription>

        <button
          type="button"
          disabled={busy}
          onClick={handleGoogle}
          className="mt-5 flex h-14 w-full items-center justify-center gap-2.5 rounded-[18px] bg-panel text-[16px] font-extrabold text-background transition-transform duration-tap active:scale-[0.98] disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {busy ? 'Signing in…' : 'Continue with Google'}
        </button>
        {/* copy.md's second option is "Use a phone number" — the app has no
            phone-auth flow implemented (Auth.tsx offers Google and
            email/password only), so this routes to the real /auth entry
            point rather than promising a flow that does not exist. */}
        <button
          type="button"
          onClick={goAuth}
          className="mt-2 flex h-11 w-full items-center justify-center rounded-[10px] text-[14px] font-semibold text-warm-prose focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Other ways to sign in
        </button>

        <p className="mt-1.5 text-center text-[12px] text-warm-label">
          Papers belong to the schools that set them. Reading only, no downloads.
        </p>
      </SheetContent>
    </Sheet>
  );
}

export { GateSheet };
