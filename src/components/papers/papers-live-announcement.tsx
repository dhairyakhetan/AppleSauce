import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useSiteCounts } from '@/hooks/useSiteCounts';
import { ArrowRight } from 'lucide-react';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { hasSeenOnboarding } from '@/lib/onboarding';
import { PAST_PAPERS_PATH } from '@/lib/nav-config';
import { isFooterlessPath } from '@/lib/chromeless-routes';

import { FREE_PREVIEW_WORD } from '@/lib/free-preview';
import { claimFirstVisitPopup } from '@/lib/first-visit-popup';
/* "Past papers are live" — a one-time announcement, not a second onboarding.
 *
 * Shown once per browser, and deliberately NOT to someone who is meeting the
 * product for the first time: hasSeenOnboarding() gates it, so a first visit
 * gets the tour and nothing else, and this lands on the NEXT visit. Two
 * full-screen "here is the product" moments in one session is exactly the
 * duplication that got OnboardingModal deleted, and this is the same trap one
 * component further along.
 *
 * Every number is fetched. If the counts do not arrive the panel still opens
 * with the sentence that needs no figure, rather than rendering a zero or a
 * plausible-looking guess.
 */
const SEEN_KEY = 'shikshaq.papersLiveSeen';

function hasSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    // Storage unavailable (private mode, quota). Treat as seen: a nudge that
    // cannot remember being dismissed is a nudge that reappears every load.
    return true;
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Nothing to persist; the dismiss still works for this session.
  }
}

function usePapersCounts(_enabled: boolean) {
  /* Delegates to the one hook. This mattered more here than anywhere else:
     the old body called fetchBankSchoolValues(true), which pages every one of
     the 1,282 bank_papers rows -- about 100 KB -- purely to count distinct
     schools, because REST has no distinct-count. That is precisely the query
     site_counts() was written to replace, and this copy was still doing it. */
  const counts = useSiteCounts();
  return {
    ...counts,
    data: counts.data ? { papers: counts.data.papers } : undefined,
  };
}

export function PapersLiveAnnouncement() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const counts = usePapersCounts(open);

  useEffect(() => {
    /* Only for a returning visitor. A first-timer is mid-tour. */
    /* Never over a work screen: it opened on top of the paper checker's
       "Which papers?" picker. */
    if (isFooterlessPath(window.location.pathname)) return;
    if (!hasSeen() && hasSeenOnboarding()) {
      /* One frame late, so it never races the tour's own mount and never
         competes with first paint. */
      const t = window.setTimeout(() => { if (claimFirstVisitPopup()) setOpen(true); }, 900);
      return () => window.clearTimeout(t);
    }
  }, []);

  const dismiss = () => {
    markSeen();
    setOpen(false);
  };

  const go = () => {
    markSeen();
    setOpen(false);
    navigate(PAST_PAPERS_PATH);
  };

  const c = counts.data;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) dismiss(); }}>
      <DialogContent
        aria-describedby="papers-live-body"
        className="w-[calc(100vw-2rem)] overflow-hidden rounded-[28px] p-0 sm:max-w-md"
      >
        {/* Indigo header. Papers are the indigo half of the brand pair
            everywhere else on the site, so the announcement wears the colour of
            the thing it is announcing rather than the generic brand orange. */}
        <div className="relative overflow-hidden bg-brand-blue px-5 pb-6 pt-7 sm:px-6">
          <div aria-hidden="true" className="mb-4 flex justify-center gap-3">
            {/* The mascot, in the papers colourway. Same anatomy as the tour's
                face so it reads as the same character. */}
            {[0, 1].map((i) => (
              <span
                key={i}
                className="relative block h-[46px] w-[40px] overflow-hidden rounded-full bg-white"
              >
                <span className="absolute left-1/2 top-1/2 h-[74%] w-[74%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-panel">
                  <span
                    className={`absolute h-[74%] w-[74%] rounded-full bg-white ${
                      i === 0 ? '-left-[26%]' : '-right-[26%]'
                    } -top-[26%]`}
                  />
                </span>
              </span>
            ))}
          </div>

          <DialogHeader className="items-center text-center">
            <DialogTitle className="text-balance font-display text-[26px] font-black leading-[1.05] tracking-[-0.04em] text-white">
              Past papers are live
            </DialogTitle>
          </DialogHeader>

          <p id="papers-live-body" className="mt-2 text-center text-[15px] leading-[1.55] text-white/90">
            {/* 2026-09-26: dropped the schools clause -- not defensible as
                genuinely Kolkata, see the coordinator's audit (~38 of 190 raw
                values). */}
            {c?.papers
              ? `${c.papers.toLocaleString("en-IN")} real question papers, typed out with their marks and chapters.`
              : 'Real question papers, typed out with their marks and chapters.'}
          </p>
        </div>

        <div className="px-5 pb-5 pt-4 sm:px-6 sm:pb-6">
          <p className="mb-4 text-center text-[14px] leading-[1.55] text-warm-prose">
            The first {FREE_PREVIEW_WORD} questions on every open paper are free to read, no account needed.
          </p>
          <div className="flex flex-col gap-2">
            <Button onClick={go} variant="indigo" size={52} className="w-full">
              Open the library
              <ArrowRight size={17} strokeWidth={2.4} aria-hidden="true" />
            </Button>
            <Button onClick={dismiss} variant="muted" size={44} className="w-full">
              Not now
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default PapersLiveAnnouncement;
