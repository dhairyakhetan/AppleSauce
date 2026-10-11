import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { WALKTHROUGH_STEPS, type WalkthroughStep } from '@/lib/checker-onboarding';
import { actionToneClass } from '@/lib/checker-button-styles';

/* The first-visit walkthrough on /checker. It points at the REAL elements
   (found by data-tour) one at a time: the page picture, the typed question,
   then the four buttons. It is mounted only after the real question is on
   screen, so it never delays or hides the load.

   A transparent shield covers the page while it is open, so a tap meant for
   "Next" can never land on the highlighted "Looks right" and pass a real
   question. Steps whose element is not on screen (a question with no
   picture, say) are left out rather than pointing at nothing. */

const GAP = 12;
const PAD = 6;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

function find(step: WalkthroughStep): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
}

export function CheckerWalkthrough({
  onClose,
  onPractice,
  onShowTarget,
}: {
  onClose: () => void;
  onPractice: () => void;
  /** Called as each step starts, so a phone can switch to the side (Typed or Printed) the step is about. */
  onShowTarget?: (target: WalkthroughStep['target']) => void;
}) {
  const [steps] = useState<WalkthroughStep[]>(() => WALKTHROUGH_STEPS.filter((s) => find(s) !== null));
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [cardH, setCardH] = useState(200);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const step = steps[i];
  const last = i === steps.length - 1;

  const measure = useCallback(() => {
    if (!step) return;
    const el = find(step);
    if (!el) {
      setBox(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step]);

  // Bring a picture or the question into view; the buttons are always on
  // screen (the action footer is sticky).
  useEffect(() => {
    if (!step) return;
    onShowTarget?.(step.target);
    const show = () => {
      const el = find(step);
      if (el && (step.target === 'picture' || step.target === 'question' || step.target === 'tools' || step.target === 'changes')) {
        el.scrollIntoView({ block: step.target === 'picture' || step.target === 'question' ? 'nearest' : 'center', behavior: 'auto' });
      }
      measure();
    };
    show();
    // The side may have just switched (phone tabs): measure again once it has shown.
    const raf = requestAnimationFrame(show);
    const later = window.setTimeout(show, 80);
    nextRef.current?.focus({ preventScroll: true });
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(later);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, measure]);

  useEffect(() => {
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      // The shield stops taps, not the keyboard: keep Tab inside the card so
      // Enter can never land on "Looks right" underneath while the tour is open.
      const card = cardRef.current;
      if (!card) return;
      const focusable = Array.from(card.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!active || !card.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /* Measure the card after each step or move, so it can be placed clear of the target. */
  useLayoutEffect(() => {
    const h = cardRef.current?.offsetHeight;
    if (h && h !== cardH) setCardH(h);
  }, [i, box, cardH]);

  useEffect(() => {
    if (steps.length === 0) onClose();
  }, [steps.length, onClose]);

  if (!step) return null;

  // clientWidth, not innerWidth: innerWidth includes the scrollbar (CLAUDE.md).
  const vw = typeof document === 'undefined' ? 375 : document.documentElement.clientWidth;
  const vh = typeof document === 'undefined' ? 700 : document.documentElement.clientHeight;
  const cardW = Math.min(vw - 2 * GAP, 352);
  let top = vh - cardH - GAP;
  let left = Math.max(GAP, (vw - cardW) / 2);
  if (box) {
    const need = cardH + 2 * GAP;
    const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);
    const centred = clamp(box.left + box.width / 2 - cardW / 2, GAP, vw - cardW - GAP);
    const beside = clamp(box.top, GAP, vh - cardH - GAP);
    const below = vh - (box.top + box.height + PAD);
    const above = box.top - PAD;
    const rightRoom = vw - (box.left + box.width + PAD);
    const leftRoom = box.left - PAD;
    left = centred;
    if (below >= need) top = box.top + box.height + PAD + GAP;
    else if (above >= need) top = box.top - PAD - GAP - cardH;
    else if (rightRoom >= cardW + 2 * GAP) {
      // A tall target (the whole page): sit beside it, not on it.
      left = box.left + box.width + PAD + GAP;
      top = beside;
    } else if (leftRoom >= cardW + 2 * GAP) {
      left = box.left - PAD - GAP - cardW;
      top = beside;
    } else top = box.top + box.height / 2 < vh / 2 ? vh - cardH - GAP : GAP;
  }

  return (
    <>
      {/* Shield: swallows taps so the page underneath cannot be pressed. */}
      <div className="fixed inset-0 z-[60]" aria-hidden="true" />
      {box ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-[61] rounded-2xl ring-2 ring-white"
          style={{
            top: box.top - PAD,
            left: box.left - PAD,
            width: box.width + 2 * PAD,
            height: box.height + 2 * PAD,
            boxShadow: '0 0 0 9999px rgba(15, 15, 20, 0.55)',
          }}
        />
      ) : (
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[61] bg-black/55" />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="checker-tour-title"
        data-testid="checker-walkthrough"
        className="fixed z-[62] rounded-2xl bg-card p-4 shadow-lg animate-in fade-in-0 duration-200"
        style={{ top, left, width: cardW }}
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="text-[12px] font-semibold tabular-nums text-warm-meta">
            Step {i + 1} of {steps.length}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="tap-44 rounded-full px-3 py-1 text-[13px] font-semibold text-warm-secondary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Skip the tour
          </button>
        </div>
        <h2 id="checker-tour-title" className="text-balance text-[16px] font-bold text-foreground">
          {step.title}
        </h2>
        <p className="mt-1 text-pretty text-[14px] leading-snug text-warm-secondary">{step.body}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {i > 0 ? (
            <button type="button" onClick={() => setI(i - 1)} className={actionToneClass('muted')}>
              Back
            </button>
          ) : null}
          {last ? (
            <>
              <button type="button" onClick={onPractice} className={actionToneClass('brand')}>
                Try the practice round
              </button>
              <button ref={nextRef} type="button" onClick={onClose} className={actionToneClass('mint')}>
                Got it
              </button>
            </>
          ) : (
            <button ref={nextRef} type="button" onClick={() => setI(i + 1)} className={actionToneClass('mint')}>
              Next
            </button>
          )}
        </div>
      </div>
    </>
  );
}
