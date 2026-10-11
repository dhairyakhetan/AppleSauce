import * as React from 'react';
import { useNavigate } from 'react-router-dom';

import { useSiteCounts } from '@/hooks/useSiteCounts';
import { ArrowRight, X } from 'lucide-react';

import { Logo } from '@/components/Logo';
import { cn } from '@/lib/utils';
import { hasSeenOnboarding, markOnboardingSeen } from '@/lib/onboarding';
import { isFooterlessPath } from '@/lib/chromeless-routes';
import { PAST_PAPERS_PATH } from '@/lib/nav-config';

import { FREE_PREVIEW_WORD } from '@/lib/free-preview';
import { claimFirstVisitPopup } from '@/lib/first-visit-popup';
/* The one onboarding.
 *
 * There were two, doing the same job in two visual languages: OnboardingModal
 * opened itself once per browser on a full orange screen, and ProductTour
 * opened on a logo tap as four dark cards. A visitor could meet both in a
 * minute, be told the same three facts twice, and reasonably conclude the
 * second one was a bug. They are now this, which runs on first visit AND on
 * every logo tap, so the thing you can re-open is the thing you were shown.
 *
 * The vibe, per the owner's two references: one saturated colour per step
 * edge to edge, a big mascot face carrying the step's mood, an oversized
 * display headline, and a row of real chips at the bottom. Brand palette only
 * - orange, indigo, mint, ink - not the references' pink and lilac.
 *
 * Every number on these screens is fetched. A count that cannot be read is
 * simply not drawn, rather than being filled in with a plausible figure.
 */

export const OPEN_TOUR_EVENT = 'shikshaq:open-tour';

export function openProductTour() {
  window.dispatchEvent(new CustomEvent(OPEN_TOUR_EVENT));
}

export function useProductTour() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_TOUR_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_TOUR_EVENT, onOpen);
  }, []);
  return { open, setOpen };
}

/* ---------------------------------------------------------------------------
   The mascot

   The site already has two mascot treatments and this is deliberately the
   third of nothing: it reuses CornerMascot's exact anatomy (a circular face,
   two rounded eye whites, dark pupils, one catchlight high-left) so the face
   on the welcome screen is recognisably the face on the home page. What it
   adds is a mouth, because these screens carry a mood and CornerMascot's
   eyes-only face cannot.
--------------------------------------------------------------------------- */

type Mood = 'hi' | 'reading' | 'chat' | 'go';

/* Mouth geometry in the face's own percentage space, so the face scales
   without the mouth drifting. */
const MOUTH: Record<Mood, { d: string; open: boolean }> = {
  hi: { d: 'M30 60 Q50 82 70 60', open: true },
  reading: { d: 'M34 64 Q50 74 66 64', open: false },
  chat: { d: 'M32 62 Q50 80 68 62', open: true },
  go: { d: 'M30 58 Q50 84 70 58', open: true },
};

function Mascot({
  mood,
  faceFill,
  eyeWhite,
  ink,
  className,
}: {
  mood: Mood;
  faceFill: string;
  eyeWhite: string;
  ink: string;
  className?: string;
}) {
  const m = MOUTH[mood];
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="50" cy="50" r="50" fill={faceFill} />
      {/* Eyes. Tall rounded capsules, not circles: this is the shape the home
          page's mascot uses, and a circle reads as a different character. */}
      {[34, 66].map((cx) => (
        <g key={cx}>
          <rect x={cx - 11} y={26} width={22} height={30} rx={11} fill={eyeWhite} />
          <circle cx={cx} cy={43} r={8.5} fill={ink} />
          <circle cx={cx - 3} cy={39.5} r={2.6} fill="#FFFFFF" opacity={0.92} />
        </g>
      ))}
      <path
        d={m.d}
        stroke={ink}
        strokeWidth={7}
        strokeLinecap="round"
        fill={m.open ? ink : 'none'}
      />
    </svg>
  );
}

/* ---------------------------------------------------------------------------
   Steps
--------------------------------------------------------------------------- */

interface Step {
  key: string;
  mood: Mood;
  /** Full-bleed background. */
  bg: string;
  /** Ink that measures >= 4.5:1 on `bg`. */
  ink: string;
  /** Softer ink for body copy, still >= 4.5:1. */
  inkSoft: string;
  faceFill: string;
  eyeWhite: string;
  /** Pupil / mouth colour on the face. */
  faceInk: string;
  headline: React.ReactNode;
  body: string;
  chipBg: string;
  chipInk: string;
}

/* Orange carries dark ink and never white: index.css records the measurement
   (white on #FF8000 is 2.52:1, under the 4.5:1 floor) and every other brand
   surface in the app already uses #1F1F1F on it. */
const STEPS: Step[] = [
  {
    key: 'teachers',
    mood: 'hi',
    bg: 'bg-brand',
    ink: 'text-brand-foreground',
    inkSoft: 'text-brand-foreground/80',
    faceFill: '#FCFAF7',
    eyeWhite: '#FFFFFF',
    faceInk: '#1F1F1F',
    headline: (
      <>
        Find a teacher
        <br />
        who teaches
        <br />
        your board.
      </>
    ),
    body: 'Filter by subject, class, board and your part of Kolkata. Every teacher here is verified.',
    chipBg: 'bg-[#FCFAF7]',
    chipInk: 'text-foreground',
  },
  {
    key: 'papers',
    mood: 'reading',
    bg: 'bg-brand-blue',
    ink: 'text-white',
    /* /90, not /85. Composited against #4351FF the softer value measures
       4.37:1, which is under the 4.5:1 floor for 15px body copy; /90 measures
       4.71:1. The orange step's /80 is fine because its ink is near-black. */
    inkSoft: 'text-white/90',
    faceFill: '#FFD84D',
    eyeWhite: '#FFFFFF',
    faceInk: '#1F1F1F',
    headline: (
      <>
        Past papers,
        <br />
        free to read.
      </>
    ),
    body: `Real question papers from real schools, with marks and chapters. The first ${FREE_PREVIEW_WORD} questions need no account at all.`,
    chipBg: 'bg-white',
    chipInk: 'text-brand-blue-deep',
  },
  {
    key: 'direct',
    mood: 'chat',
    bg: 'bg-mint',
    ink: 'text-foreground',
    inkSoft: 'text-warm-prose',
    faceFill: '#FF8000',
    eyeWhite: '#FFFFFF',
    faceInk: '#1F1F1F',
    headline: (
      <>
        Message them
        <br />
        yourself.
        <br />
        No agent.
      </>
    ),
    body: 'You contact the teacher directly and they keep every rupee of their fee. Shikshaq takes no cut and sits in no middle.',
    chipBg: 'bg-white',
    chipInk: 'text-foreground',
  },
];

/* ---------------------------------------------------------------------------
   Counts

   Two numbers, both real, both cheap. Anything a query cannot return is left
   off the screen rather than invented.
--------------------------------------------------------------------------- */
function useTourCounts(_enabled: boolean) {
  /* Delegates to the one hook rather than counting the tables again. The
     `enabled` argument is kept so the call site reads the same, but it no
     longer gates anything: Footer renders on every route and already holds
     ['site','counts'], so this reads a cached value instead of issuing a
     second pair of count queries while a tour is opening. */
  const counts = useSiteCounts();
  return {
    ...counts,
    data: counts.data ? { teachers: counts.data.teachers, papers: counts.data.papers } : undefined,
  };
}

/* ---------------------------------------------------------------------------
   The flow
--------------------------------------------------------------------------- */

export interface ProductTourProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProductTour({ open, onOpenChange }: ProductTourProps) {
  const [i, setI] = React.useState(0);
  const navigate = useNavigate();
  const counts = useTourCounts(open);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const skipRef = React.useRef<HTMLButtonElement>(null);

  /* First visit opens it on its own. The same flag the old modal used, so a
     visitor who already dismissed that one is not shown this. */
  React.useEffect(() => {
    // Not on a work screen: a student opening the paper checker from a link
    // got the parents' marketing tour on top of it (isFooterlessPath).
    if (isFooterlessPath(window.location.pathname)) return;
    if (hasSeenOnboarding()) return;
    /* A beat after mount, and only if no other first-visit pop-up has taken
       this visit's slot (the paper notice claims it immediately). */
    const t = window.setTimeout(() => { if (claimFirstVisitPopup()) onOpenChange(true); }, 250);
    return () => window.clearTimeout(t);
  }, [onOpenChange]);

  React.useEffect(() => {
    if (open) setI(0);
  }, [open]);

  const close = React.useCallback(() => {
    // Recorded before any animation, so the record cannot depend on the tab
    // surviving one.
    markOnboardingSeen();
    onOpenChange(false);
  }, [onOpenChange]);

  /* Escape closes, and focus starts inside the panel rather than wherever the
     logo left it. Without this a keyboard user tabs into the page behind. */
  React.useEffect(() => {
    if (!open) return;
    skipRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight') setI((v) => Math.min(v + 1, STEPS.length - 1));
      if (e.key === 'ArrowLeft') setI((v) => Math.max(v - 1, 0));
    };
    document.addEventListener('keydown', onKey);

    /* The page behind must not scroll under the overlay -- and the lock has to
       go on `html`, not `body`. index.css sets `html { overflow-x: hidden }`,
       which per the CSS Overflow spec stops body's overflow from propagating
       to the viewport: the real scrolling element stays documentElement. The
       old body-only lock therefore did nothing, which is why the page kept its
       scrollbar (and kept scrolling) with the tour open.

       Padding compensates for the bar the lock removes, so the page behind
       does not jump sideways when the tour opens and closes. */
    const root = document.documentElement;
    const prevOverflow = root.style.overflow;
    const prevPadding = root.style.paddingRight;
    const barWidth = window.innerWidth - root.clientWidth;
    root.style.overflow = 'hidden';
    if (barWidth > 0) root.style.paddingRight = `${barWidth}px`;

    return () => {
      document.removeEventListener('keydown', onKey);
      root.style.overflow = prevOverflow;
      root.style.paddingRight = prevPadding;
    };
  }, [open, close]);

  if (!open) return null;

  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  const c = counts.data;

  const advance = () => {
    if (last) {
      close();
      navigate('/all-tuition-teachers-in-kolkata');
      return;
    }
    setI((v) => v + 1);
  };

  /* Chips carry this step's own real number, and are skipped entirely when the
     count has not arrived or is zero. */
  const chips: string[] =
    step.key === 'teachers'
      ? c?.teachers
        ? [`${c.teachers} verified teachers`, 'Free to contact']
        : ['Free to contact']
      : step.key === 'papers'
        ? c?.papers
          ? [`${c.papers.toLocaleString("en-IN")} papers`, 'Marks and chapters']
          : ['Marks and chapters']
        : ['They keep 100%', 'No commission'];

  /* h-[100dvh] rather than inset-0: on a phone the dynamic viewport is the only
     height that excludes the browser's own retracting chrome, and `bottom: 0`
     measures the large viewport, which put the CTA underneath it. */
  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="How Shikshaq works"
      className={cn(
        'fixed inset-x-0 top-0 z-[100] flex h-[100dvh] flex-col overflow-hidden transition-colors duration-500 ease-snap',
        step.bg,
      )}
    >
      {/* Chrome: the mark, and one way out that is always in the same place. */}
      <div className="flex h-14 flex-none items-center justify-between px-5 sm:h-16 short-landscape:h-12">
        <Logo
          size="nav"
          className="tap-44 pointer-events-none [&_img]:[filter:brightness(0)]"
          ariaLabel="Shikshaq"
          priority
        />
        <button
          ref={skipRef}
          type="button"
          onClick={close}
          className={cn(
            'flex h-11 w-11 items-center justify-center rounded-full bg-black/10 transition-colors duration-150 hover:bg-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
            step.ink,
          )}
          aria-label="Skip the introduction"
        >
          <X className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
        </button>
      </div>

      {/* The step.

          `overflow-y-auto` alone is not enough on either axis. On x, the CSS
          Overflow spec forces the other axis to compute as `auto` too, so any
          sub-pixel width (the panel is often xxx.2px wide) raised a horizontal
          scrollbar under content that never actually overflowed sideways --
          hence `overflow-x-hidden`. On y, `justify-center` on a scroll
          container pushes overflowing content off the TOP, where it cannot be
          scrolled back to; `my-auto` on the child centres it while it fits and
          degrades to top-aligned when it does not. */}
      <div className="flex flex-1 flex-col items-center overflow-y-auto overflow-x-hidden px-6 py-2 short:py-1">
        {/* One column stacked, and beside itself on a landscape phone. At
            740x380 the stack cannot fit even at its smallest clamp, and the
            answer there is not a smaller face -- it is the width the screen
            has and the height it does not. */}
        <div className="my-auto flex w-full max-w-[560px] flex-col items-center short-landscape:max-w-[880px] short-landscape:flex-row short-landscape:items-center short-landscape:gap-7 short-landscape:text-left">
          <Mascot
            key={step.key}
            mood={step.mood}
            faceFill={step.faceFill}
            eyeWhite={step.eyeWhite}
            ink={step.faceInk}
            className="mb-[clamp(12px,2.4vh,24px)] h-[clamp(64px,15vh,150px)] w-[clamp(64px,15vh,150px)] flex-none motion-safe:animate-panel-fade short:h-[clamp(60px,11vh,96px)] short:w-[clamp(60px,11vh,96px)] short-landscape:mb-0 short-landscape:h-[clamp(84px,34vh,132px)] short-landscape:w-[clamp(84px,34vh,132px)]"
          />

          <div key={step.key} className="flex min-w-0 flex-col items-center short-landscape:items-start">
            {/* text-balance so a three-line headline does not leave one orphan
                word on the last line at an awkward width. */}
            {/* M32: headline/body/chips now enter together with the step —
                keyed on step.key so each step change remounts (and replays)
                this block, staggered 0/50/100ms so the three read as one
                choreographed beat rather than the background alone moving
                while the copy just swaps in place. tourStepIn is the
                keyframe already used for this same "step change" motion
                elsewhere. */}
            <h2
              className={cn(
                /* The width steps stay exactly as designed (40px, 54px from sm);
                   what is new is the height ceiling. Driving display size off
                   vw as well pulled a 360px phone down to 30px, which is not a
                   display headline -- width was never the axis that ran out. */
                'text-balance text-center font-display text-[max(28px,min(40px,7.2vh))] font-black leading-[0.94] tracking-[-0.055em] sm:text-[max(30px,min(54px,7.2vh))] short-landscape:text-left short-landscape:text-[clamp(28px,4.6vw,40px)] motion-safe:animate-tour-step-in',
                step.ink,
              )}
            >
              {step.headline}
            </h2>

            <p
              className={cn(
                'mt-[clamp(10px,2vh,16px)] max-w-[38ch] text-pretty text-center text-[15px] leading-[1.55] short:text-[14px] short:leading-[1.5] short-landscape:mt-2.5 short-landscape:text-left short-landscape:text-[14px] motion-safe:animate-tour-step-in',
                step.inkSoft,
              )}
              style={{ animationDelay: '50ms' }}
            >
              {step.body}
            </p>

            <div
              className="mt-[clamp(14px,2.8vh,24px)] flex flex-wrap justify-center gap-2 short-landscape:mt-3 short-landscape:justify-start motion-safe:animate-tour-step-in"
              style={{ animationDelay: '100ms' }}
            >
              {chips.map((label) => (
                <span
                  key={label}
                  className={cn(
                    'inline-flex h-9 items-center rounded-full px-4 text-[14px] font-extrabold tabular-nums short:h-8 short:px-3.5 short:text-[13px] short-landscape:h-8 short-landscape:px-3.5 short-landscape:text-[13px]',
                    step.chipBg,
                    step.chipInk,
                  )}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Footer: progress, then the action. */}
      <div className="flex-none px-6 pt-2 pb-[max(clamp(16px,3.5vh,32px),env(safe-area-inset-bottom))] short:pt-1 short-landscape:pb-4 short-landscape:pt-1">
        <div className="mx-auto flex w-full max-w-[560px] flex-col items-center gap-[clamp(10px,2.2vh,16px)]">
          <div className="flex items-center gap-2" role="presentation">
            {STEPS.map((s, n) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setI(n)}
                aria-label={`Step ${n + 1} of ${STEPS.length}`}
                aria-current={n === i ? 'step' : undefined}
                className="tap-44 flex h-2.5 items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-4 focus-visible:ring-offset-transparent"
              >
                <span
                  className={cn(
                    // M1/D4.1: explicit properties, not `transition-all` —
                    // width/opacity/background-color are the only three
                    // this dot ever changes.
                    'block h-2.5 rounded-full transition-[width,opacity,background-color] duration-300 ease-snap',
                    step.ink.replace('text-', 'bg-'),
                    n === i ? 'w-7 opacity-100' : 'w-2.5 opacity-35',
                  )}
                />
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={advance}
            className={cn(
              'flex h-[clamp(48px,7.5vh,56px)] w-full items-center justify-center gap-2 rounded-full text-[16px] font-extrabold transition-transform duration-tap hover:-translate-y-0.5 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
              step.chipBg,
              step.chipInk,
            )}
          >
            {last ? 'Start looking' : 'Next'}
            <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>

          {/* A second way past, for the reader who wants the papers rather than
              a teacher. Only on the last step, where the choice is real. */}
          {last && (
            <button
              type="button"
              onClick={() => {
                close();
                navigate(PAST_PAPERS_PATH);
              }}
              className={cn(
                'flex min-h-11 items-center justify-center text-[14px] font-semibold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current focus-visible:ring-offset-2 focus-visible:ring-offset-transparent',
                step.inkSoft,
              )}
            >
              Take me to the papers instead
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Mounts the tour once for the whole app, owning its own open state.
 *
 * There must be exactly one of these. The logo trigger is a window event, so a
 * second mounted copy would answer the same tap and stack two dialogs on top of
 * each other. It lives in App.tsx rather than on the home page because the
 * first-visit open has to work for someone who arrives on a paper or a teacher
 * profile from search, which is how most first visits actually start.
 */
export function ProductTourHost() {
  const { open, setOpen } = useProductTour();
  return <ProductTour open={open} onOpenChange={setOpen} />;
}

export default ProductTour;
