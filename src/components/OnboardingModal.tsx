import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { hasSeenOnboarding, markOnboardingSeen } from "@/lib/onboarding";
import { getSubjectPalette } from "@/lib/subject-palette";
import { WhatsAppIcon } from "@/components/BrandIcons";
import { Logo } from "@/components/Logo";

/* Handoff OB-001 — first-open welcome screen (Welcome Screen Redesign.dc.html).
   Full-screen, not a route, shown once per browser behind hasSeenOnboarding().
   Both actions dismiss (markOnboardingSeen()) and the screen never returns —
   this is a hype/welcome moment, not a router: the old three-destination
   picker (Find a teacher / Read papers / I teach) is gone, per the entry's
   full replacement of this component's content and behaviour. */

function useOnboardingCounts(enabled: boolean) {
  return useQuery({
    queryKey: ["onboarding", "counts"],
    enabled,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const [mathsRes, icseRes, ballygungeRes, class10Res, papersRes, teachersRes] = await Promise.all([
        supabase.from("teachers_list").select("id", { count: "exact", head: true }).ilike("subjects", "%Maths%"),
        supabase.from("Shikshaqmine").select("id", { count: "exact", head: true }).ilike('"School Boards Catered"', "%ICSE%"),
        supabase.from("Shikshaqmine").select("id", { count: "exact", head: true }).ilike("Area", "%Ballygunge%"),
        supabase.from("teachers_list").select("id", { count: "exact", head: true }).ilike("classes", "%10%"),
        supabase.from("papers").select("id", { count: "exact", head: true }).eq("is_published", true),
        supabase.from("teachers_list").select("id", { count: "exact", head: true }),
      ]);
      return {
        maths: mathsRes.count ?? null,
        icse: icseRes.count ?? null,
        ballygunge: ballygungeRes.count ?? null,
        class10: class10Res.count ?? null,
        papers: papersRes.count ?? null,
        teachers: teachersRes.count ?? null,
      };
    },
  });
}

export function OnboardingModal() {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const counts = useOnboardingCounts(open);

  useEffect(() => {
    if (!hasSeenOnboarding()) {
      setOpen(true);
    }
  }, []);

  /* Handoff M-013: dismissing fades out over 500ms with no stagger, so the
     panel has to outlive the click. `markOnboardingSeen()` still runs
     immediately — the record that it was seen must not depend on an
     animation finishing (or on the tab surviving it). */
  const dismiss = () => {
    markOnboardingSeen();
    setClosing(true);
    window.setTimeout(() => setOpen(false), 500);
  };

  if (!open) return null;

  const maths = getSubjectPalette("Maths");
  const science = getSubjectPalette("Science");
  const c = counts.data;

  return (
    /* M-013: the panel fades in over 500ms ease-snap and back out over the
       same, no travel and no stagger on the way out. */
    <div
      className={`fixed inset-0 z-[100] flex flex-col overflow-hidden bg-brand transition-opacity duration-500 ease-snap ${
        closing ? "opacity-0" : "animate-panel-fade"
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Shikshaq"
    >
      <div className="flex h-14 items-center justify-between px-5">
        {/* filter:brightness(0) — fully monochrome black, distinct from
            Logo's own onDark (white-invert) or default (dark ink + orange
            accent dot) treatments. */}
        <Logo size="nav" className="tap-44 [&_img]:[filter:brightness(0)]" ariaLabel="Shikshaq home" priority />
        <button
          type="button"
          onClick={dismiss}
          aria-label="Skip"
          /* M3/D1.9: had no hover/focus/pressed state at all, and the fill
             was a raw rgba() literal rather than a token. brand-foreground
             is the same #1F1F1F ink used elsewhere on this screen — it's
             hsl()-wrapped, so the /opacity modifier works on it (unlike the
             raw-hex `warm` tokens CLAUDE.md warns about). */
          className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-foreground/15 text-brand-foreground transition-[background-color,transform] duration-tap hover:bg-brand-foreground/20 active:scale-[0.96] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-brand"
        >
          <X className="h-4 w-4" strokeWidth={2.25} aria-hidden />
        </button>
      </div>

      <div className="relative flex flex-1 flex-col items-center justify-center px-5">
        {/* Handoff C-009: text-brand-foreground (#1F1F1F), not white --
            index.css's own token comment records why: #FF8000 cannot carry
            white text at any size this site uses (measured 2.52:1 against
            AA's 4.5:1 floor). Every other brand-orange surface in the app
            already uses the dark ink; this full-screen headline was the one
            surface still on the pre-fix white. */}
        {/* h2, not h1: this splash sits on top of a page that has its own
            h1, and it renders on a first visit — which is exactly what a
            crawler is. Two h1s, with the overlay's coming first in the DOM,
            meant the homepage's headline of record was an onboarding screen
            the reader dismisses. Styling is unchanged; only the level is. */}
        <h2 className="font-display text-[58px] font-black leading-[0.9] tracking-[-0.06em] text-brand-foreground">
          Search,<br />
          shortlist,<br />
          <span className="inline-block -mx-2 rounded-[6px] bg-[#FCFAF7] px-2 text-[#1F1F1F]">message.</span><br />
          No agent<br />
          in between.
        </h2>

        {/* Handoff OB-001 point 3: five tilted stickers around the headline.

            Handoff M-013: they stagger in at 60ms intervals, each
            opacity 0->1 + translateY(6px->0) over 500ms ease-snap. Built from
            an array rather than five hand-written blocks so the delay index
            counts only the stickers that actually rendered — every one is
            gated on a real count, and indexing over the source order would
            leave a 60ms hole in the rhythm whenever a count is zero.

            The WhatsApp disc rides the same sequence: the spec names five
            pills, but leaving the sixth element of one cluster un-animated
            while the others fade in reads as a bug, not restraint. */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {([
            c?.maths != null && c.maths > 0 && {
              key: 'maths',
              cls: 'absolute left-[6%] top-[18%] h-[34px] rotate-[7deg] items-center whitespace-nowrap rounded-full px-[15px] text-[14px] font-extrabold shadow-[0_8px_22px_rgba(0,0,0,.14)] motion-reduce:rotate-0 lg:rotate-0',
              style: { backgroundColor: maths.tint, color: maths.text, display: 'inline-flex' } as React.CSSProperties,
              body: `Maths · ${c.maths}`,
            },
            c?.icse != null && c.icse > 0 && {
              key: 'icse',
              cls: 'absolute right-[8%] top-[30%] h-[34px] rotate-[-6deg] items-center whitespace-nowrap rounded-full bg-panel px-[15px] text-[14px] font-extrabold text-background shadow-[0_8px_22px_rgba(0,0,0,.14)] motion-reduce:rotate-0 lg:rotate-0',
              style: { display: 'inline-flex' } as React.CSSProperties,
              body: `ICSE · ${c.icse}`,
            },
            c?.ballygunge != null && c.ballygunge > 0 && {
              key: 'ballygunge',
              cls: 'absolute left-[10%] bottom-[26%] h-[34px] rotate-[5deg] items-center whitespace-nowrap rounded-full bg-card px-[15px] text-[14px] font-extrabold text-foreground shadow-[0_8px_22px_rgba(0,0,0,.14)] motion-reduce:rotate-0 lg:rotate-0',
              style: { display: 'inline-flex' } as React.CSSProperties,
              body: `Ballygunge · ${c.ballygunge}`,
            },
            c?.class10 != null && c.class10 > 0 && {
              key: 'class10',
              cls: 'absolute right-[6%] bottom-[12%] h-[34px] rotate-[-4deg] items-center whitespace-nowrap rounded-full px-[15px] text-[14px] font-extrabold shadow-[0_8px_22px_rgba(0,0,0,.14)] motion-reduce:rotate-0 lg:rotate-0',
              style: { backgroundColor: science.tint, color: science.text, display: 'inline-flex' } as React.CSSProperties,
              body: `Class 10 · ${c.class10}`,
            },
            c?.papers != null && c.papers > 0 && {
              key: 'papers',
              cls: 'absolute left-[22%] top-[46%] h-[34px] rotate-[6deg] items-center whitespace-nowrap rounded-full bg-brand-blue-subtle px-[15px] text-[14px] font-extrabold text-brand-blue-deep shadow-[0_8px_22px_rgba(0,0,0,.14)] motion-reduce:rotate-0 lg:rotate-0',
              style: { display: 'inline-flex' } as React.CSSProperties,
              body: `${c.papers.toLocaleString("en-IN")} free papers`,
            },
            {
              key: 'whatsapp',
              cls: 'absolute right-[14%] top-[58%] flex h-8 w-8 rotate-[6deg] items-center justify-center rounded-full bg-whatsapp text-whatsapp-text motion-reduce:rotate-0 lg:rotate-0',
              style: {} as React.CSSProperties,
              body: <WhatsAppIcon className="h-4 w-4" />,
            },
          ].filter(Boolean) as Array<{ key: string; cls: string; style: React.CSSProperties; body: React.ReactNode }>).map((st, i) => (
            <span
              key={st.key}
              className={`animate-sticker-in ${st.cls}`}
              style={{ ...st.style, animationDelay: `${i * 60}ms` }}
            >
              {st.body}
            </span>
          ))}
        </div>
      </div>

      <div className="px-5 pb-8">
        {c?.teachers != null && c.teachers > 0 && (
          <p className="mb-4 text-center text-[15px] leading-[1.5] text-brand-foreground/70">
            {c.teachers} verified teachers in Kolkata. Free to search, free to contact.
          </p>
        )}
        <button
          type="button"
          onClick={dismiss}
          className="flex h-[58px] w-full items-center justify-center gap-2 rounded-full bg-card text-[16px] font-extrabold text-foreground transition-transform duration-tap hover:-translate-y-0.5 active:scale-[0.96] motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-brand"
        >
          Get started
          <ArrowRight className="h-[18px] w-[18px]" aria-hidden />
        </button>
        {/* M4/D1.9: this had no press/hover/focus feedback at all — a
            skippable dismiss control that gave no sign it was interactive. */}
        <button
          type="button"
          onClick={dismiss}
          className="mt-2 flex h-11 w-full items-center justify-center rounded-full text-[14px] font-semibold text-brand-foreground/60 transition-[color,transform] duration-tap hover:text-brand-foreground active:scale-[0.96] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-brand"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
