import * as React from 'react';
import { cn } from '@/lib/utils';
import { SentenceBuilder, type SentenceSlot } from '@/components/home/SentenceBuilder';

/* Handoff H-023 / S-015 — the eyes panel, one implementation shared by every
   page that has a footer (mode/heading default per route on other pages;
   Home passes its own explicit copy and drives `mode` from the sentence
   builder's own toggle, since the dome's fill is the SAME state that colours
   the toggle pill and the CTA — H-023's binding rule).

   Pupils track the pointer on a mouse; on a touch device they follow
   deviceorientation ONLY (iOS 13+ needs a permission prompt, requested from
   the tap handler, never on mount). A finger drag never moves them on touch —
   a phone is held, not swiped at, and a drag reading through pointermove
   fought the gyro rather than filling a gap before it, so touch devices wait
   for real tilt instead of a stand-in. A 5.2s idle timer blinks them, and a
   tap blinks them too, and grants the iOS permission prompt on the first tap
   where one is required. prefers-reduced-motion disables all of it — pupils
   sit centred, no listeners attached.

   The gyro is CALIBRATED, not absolute: the first orientation sample becomes
   the baseline, and every reading after that is a delta from it. Without this
   the pupils started wherever a fixed beta=45/gamma=0 "neutral" happened to
   land relative to how that particular phone was actually being held, which
   read as pre-tilted and wrong more often than not — a phone is rarely held
   at exactly 45 degrees. Calibrating to the first sample means the eyes
   always start straight, dead centre, however the phone is being held, and
   only move as it tilts away from that starting pose. */

export interface EyesPanelProps {
  mode: 'teachers' | 'papers';
  onModeChange: (mode: 'teachers' | 'papers') => void;
  heading: React.ReactNode;
  subline: string;
  slots: SentenceSlot[];
  onSlotChange: (key: string, value: string) => void;
  onSubmit: () => void;
  count?: number;
  className?: string;
}

const PUPIL_MAX_X = 20;
const PUPIL_MAX_Y = 18;
const PUPIL_DISTANCE_NORM = 260;
const IDLE_BLINK_MS = 5200;
// Handoff M-005: the lid drops for 150ms (how long it stays visually
// closed before reopening) on a 90ms ease-out transition curve (the Eye
// component's own duration-[90ms] class) — two different numbers. This one
// used to reuse the transition's 90ms for the hold too, which meant the
// close-transition and the reopen-transition were racing rather than the
// lid ever settling shut.
const BLINK_HOLD_MS = 150;

type OrientationPermissionState = 'unknown' | 'granted' | 'denied' | 'unsupported';

function usesReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function Eye({
  pupilRef,
  blinking,
  lidFill,
}: {
  pupilRef: React.Ref<HTMLDivElement>;
  blinking: boolean;
  lidFill: string;
}) {
  return (
    <div
      aria-hidden
      /* Bumped from h-[74px] — taller relative to the same width reads
         rounder (less flattened-oval), which is what makes an eye read as
         cute rather than sleepy. */
      className="relative h-[86px] w-[104px] shrink-0 overflow-hidden rounded-[50%] bg-card shadow-[inset_0_3px_6px_rgba(31,31,31,.13)]"
    >
      {/* The pupil carries two catchlights. A flat black disc reads as a dot;
          a highlight is what makes an eye read as wet, lit and alive, and it
          is the cheapest possible way to make this face friendly rather than
          blank. Both sit INSIDE the pupil so they travel with it — a
          highlight fixed to the eye white would slide off as the pupil
          moves. */}
      {/* No CSS transition on the pupil. A `duration-[120ms]` transition was
          being restarted by every single pointermove, so the pupil never
          finished an ease — it just trailed the cursor by a fixed lag and
          read as mushy. The rAF loop below does the smoothing instead, and
          because it writes transform straight to this node the component
          does not re-render while the eyes track. */}
      <div
        ref={pupilRef}
        className="absolute left-1/2 top-1/2 h-[38px] w-[38px] rounded-full bg-panel will-change-transform"
        style={{ transform: 'translate(-50%, -50%)' }}
      >
        <span
          aria-hidden
          className="absolute left-[7px] top-[6px] h-[12px] w-[12px] rounded-full bg-white/90"
        />
        <span
          aria-hidden
          className="absolute bottom-[8px] right-[7px] h-[6px] w-[6px] rounded-full bg-white/45"
        />
      </div>
      {/* Lid: full-bleed div in the dome's own fill, resting off-panel and
          dropping down to blink, sharing the dome's .85s colour curve. */}
      <div
        className={cn(
          'absolute inset-0 transition-[transform,background-color] duration-[850ms] ease-settle',
          lidFill,
          blinking ? 'translate-y-0 duration-[90ms]' : '-translate-y-full',
        )}
      />
    </div>
  );
}

function EyesPanel({
  mode,
  onModeChange,
  heading,
  subline,
  slots,
  onSlotChange,
  onSubmit,
  count,
  className,
}: EyesPanelProps) {
  const reduced = React.useMemo(usesReducedMotion, []);
  const domeRef = React.useRef<HTMLDivElement>(null);
  const leftEyeRef = React.useRef<HTMLDivElement>(null);
  const rightEyeRef = React.useRef<HTMLDivElement>(null);
  const leftPupilRef = React.useRef<HTMLDivElement>(null);
  const rightPupilRef = React.useRef<HTMLDivElement>(null);
  /* Where the pupils are headed, where they actually are, and the last pointer
     sample — all refs, so a 120Hz mouse costs zero React renders. */
  const targetRef = React.useRef({ lx: 0, ly: 0, rx: 0, ry: 0 });
  const currentRef = React.useRef({ lx: 0, ly: 0, rx: 0, ry: 0 });
  const pointerRef = React.useRef<{ x: number; y: number } | null>(null);
  const centresRef = React.useRef<{ lx: number; ly: number; rx: number; ry: number } | null>(null);
  const centresDirtyRef = React.useRef(true);
  const rafRef = React.useRef<number>();
  const lastFrameRef = React.useRef(0);
  /* Low-pass state for the gyro. deviceorientation is a noisy sensor — beta and
     gamma jitter by a degree or two while a phone is held perfectly still — and
     easing the pupils toward a jittering target still tracks the jitter. This
     smooths the READING before it becomes a target. */
  const tiltRef = React.useRef<{ gamma: number; beta: number } | null>(null);
  /** The first smoothed orientation sample, captured once and never updated —
   *  see the header comment on why the eyes calibrate to it instead of a
   *  fixed neutral angle. */
  const baselineRef = React.useRef<{ gamma: number; beta: number } | null>(null);
  const [blinking, setBlinking] = React.useState(false);
  const [orientationPermission, setOrientationPermission] = React.useState<OrientationPermissionState>('unknown');
  const [tiltActive, setTiltActive] = React.useState(false);
  const blinkTimerRef = React.useRef<ReturnType<typeof setTimeout>>();

  const isTouch = React.useMemo(
    () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches,
    [],
  );

  const runBlink = React.useCallback(() => {
    if (reduced) return;
    setBlinking(true);
    window.setTimeout(() => setBlinking(false), BLINK_HOLD_MS);
  }, [reduced]);

  // Idle blink loop.
  React.useEffect(() => {
    if (reduced) return;
    function schedule() {
      blinkTimerRef.current = setTimeout(() => {
        runBlink();
        schedule();
      }, IDLE_BLINK_MS);
    }
    schedule();
    return () => clearTimeout(blinkTimerRef.current);
  }, [reduced, runBlink]);

  /* One rAF loop eases the pupils toward their target and writes the transform
     directly. Two things made the old version feel janky: it called
     setState twice per pointermove (re-rendering this panel, SentenceBuilder
     and all, up to 120x a second), and it measured both eyes with
     getBoundingClientRect on every one of those events — a forced layout per
     sample. Now the moves only record a coordinate; the frame loop does the
     rest, and it stops itself once the pupils have settled. */
  const EASE_PER_FRAME = 0.14;

  const settle = React.useCallback(() => {
    if (rafRef.current !== undefined) return;
    lastFrameRef.current = 0;
    const tick = (now: number) => {
      /* Frame-rate independent: the same visual speed on a 60Hz laptop and a
         120Hz phone. Without this the eases run twice as fast on 120Hz. */
      const dt = lastFrameRef.current === 0 ? 16.67 : Math.min(64, now - lastFrameRef.current);
      lastFrameRef.current = now;
      const k = 1 - Math.pow(1 - EASE_PER_FRAME, dt / 16.67);

      if (centresDirtyRef.current) {
        const l = leftEyeRef.current?.getBoundingClientRect();
        const r = rightEyeRef.current?.getBoundingClientRect();
        if (l && r) {
          centresRef.current = {
            lx: l.left + l.width / 2,
            ly: l.top + l.height / 2,
            rx: r.left + r.width / 2,
            ry: r.top + r.height / 2,
          };
          centresDirtyRef.current = false;
        }
      }

      const p = pointerRef.current;
      const c = centresRef.current;
      if (p && c) {
        const t = targetRef.current;
        for (const [cx, cy, kx, ky] of [
          [c.lx, c.ly, 'lx', 'ly'],
          [c.rx, c.ry, 'rx', 'ry'],
        ] as const) {
          const dx = p.x - cx;
          const dy = p.y - cy;
          const dist = Math.hypot(dx, dy);
          const scale = Math.min(1, dist / PUPIL_DISTANCE_NORM);
          t[kx] = dist === 0 ? 0 : (dx / dist) * scale * PUPIL_MAX_X;
          t[ky] = dist === 0 ? 0 : (dy / dist) * scale * PUPIL_MAX_Y;
        }
      }

      const cur = currentRef.current;
      const tgt = targetRef.current;
      let moving = false;
      for (const key of ['lx', 'ly', 'rx', 'ry'] as const) {
        const d = tgt[key] - cur[key];
        if (Math.abs(d) > 0.03) {
          cur[key] += d * k;
          moving = true;
        } else {
          cur[key] = tgt[key];
        }
      }
      if (leftPupilRef.current) {
        leftPupilRef.current.style.transform = `translate(calc(-50% + ${cur.lx.toFixed(2)}px), calc(-50% + ${cur.ly.toFixed(2)}px))`;
      }
      if (rightPupilRef.current) {
        rightPupilRef.current.style.transform = `translate(calc(-50% + ${cur.rx.toFixed(2)}px), calc(-50% + ${cur.ry.toFixed(2)}px))`;
      }

      if (moving) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = undefined;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  React.useEffect(() => () => {
    if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
  }, []);

  /* The eyes move under the cursor when the page scrolls or resizes, so the
     cached centres are invalidated rather than re-measured per pointer event. */
  React.useEffect(() => {
    if (reduced) return;
    const invalidate = () => {
      centresDirtyRef.current = true;
      if (pointerRef.current) settle();
    };
    window.addEventListener('scroll', invalidate, { passive: true });
    window.addEventListener('resize', invalidate);
    return () => {
      window.removeEventListener('scroll', invalidate);
      window.removeEventListener('resize', invalidate);
    };
  }, [reduced, settle]);

  /* Pointer tracking — desktop only. Touch devices drive the pupils from
     deviceorientation alone: `pointermove` fires for a finger drag too, and
     letting it stand in before tilt was granted meant swiping near the dome
     moved the eyes, which reads as the eyes reacting to a scroll or a stray
     touch rather than to the phone itself. */
  React.useEffect(() => {
    if (reduced || isTouch) return;
    function onPointerMove(e: PointerEvent) {
      pointerRef.current = { x: e.clientX, y: e.clientY };
      settle();
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', onPointerMove);
  }, [reduced, isTouch, settle]);

  /* Only iOS 13+ gates deviceorientation behind a gesture-initiated
     requestPermission(). Every other mobile browser just emits the events —
     but this component waited for a tap on all of them alike, so on Android
     (and on iOS below 13) the gyro never drove the eyes at all unless someone
     happened to tap the dome. Where there is no gate to pass, don't wait. */
  React.useEffect(() => {
    if (reduced || !isTouch || orientationPermission !== 'unknown') return;
    if (typeof window.DeviceOrientationEvent === 'undefined') {
      setOrientationPermission('unsupported');
      return;
    }
    const DOE = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    if (typeof DOE.requestPermission !== 'function') setOrientationPermission('granted');
  }, [reduced, isTouch, orientationPermission]);

  // Device orientation tracking — touch only, once permission is settled.
  React.useEffect(() => {
    if (reduced || !isTouch || orientationPermission !== 'granted') return;
    function onOrientation(e: DeviceOrientationEvent) {
      if (e.gamma == null || e.beta == null) return;
      setTiltActive(true);
      // Exponential smoothing on the raw reading before anything else touches
      // it — deviceorientation jitters by a degree or two even on a phone
      // held dead still, and smoothing the reading (rather than the mapped
      // pupil position) keeps the baseline capture below just as stable.
      const prev = tiltRef.current;
      const gamma = prev ? prev.gamma + (e.gamma - prev.gamma) * 0.2 : e.gamma;
      const beta = prev ? prev.beta + (e.beta - prev.beta) * 0.2 : e.beta;
      tiltRef.current = { gamma, beta };
      // The first smoothed sample IS "straight up": whatever angle the phone
      // happens to be held at becomes zero, and every later reading is a
      // delta from it. A fixed beta=45 baseline put the eyes off-centre for
      // anyone not holding the phone at exactly that angle, which is most
      // people, most of the time.
      const baseline = baselineRef.current ?? { gamma, beta };
      if (!baselineRef.current) baselineRef.current = baseline;
      const dGamma = gamma - baseline.gamma;
      const dBeta = beta - baseline.beta;
      // +/-18 degrees reaches full pupil deflection (was +/-30 / +/-45,
      // wanted more sensitivity so a comfortable, small tilt now reads).
      // Negated: pupils lead in the direction the READER'S VIEW moves as the
      // phone tilts, which is the opposite of which way gamma/beta increase.
      const x = -Math.max(-1, Math.min(1, dGamma / 18)) * PUPIL_MAX_X;
      const y = -Math.max(-1, Math.min(1, dBeta / 18)) * PUPIL_MAX_Y;
      // Tilt drives the same eased target the pointer does, so the gyro gets
      // the identical smoothing — raw orientation samples are noisy and would
      // otherwise jitter the pupils.
      pointerRef.current = null;
      const t = targetRef.current;
      t.lx = x; t.ly = y; t.rx = x; t.ry = y;
      settle();
    }
    window.addEventListener('deviceorientation', onOrientation);
    return () => {
      window.removeEventListener('deviceorientation', onOrientation);
      baselineRef.current = null;
    };
  }, [reduced, isTouch, orientationPermission, settle]);

  const handleTap = React.useCallback(() => {
    runBlink();
    if (reduced || !isTouch || orientationPermission === 'granted') return;
    const DOE = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    if (typeof DOE?.requestPermission === 'function') {
      DOE.requestPermission()
        .then((result) => setOrientationPermission(result === 'granted' ? 'granted' : 'denied'))
        .catch(() => setOrientationPermission('denied'));
    } else if (typeof window.DeviceOrientationEvent !== 'undefined') {
      // No permission gate on this platform — orientation events just start arriving.
      setOrientationPermission('granted');
    } else {
      setOrientationPermission('unsupported');
    }
  }, [reduced, isTouch, orientationPermission, runBlink]);

  const hint = !isTouch
    ? null
    : tiltActive
      ? 'Tilt your phone'
      : orientationPermission === 'granted'
        ? 'Tap, or tilt your phone'
        : 'Tap to wake them up';

  const domeFill = mode === 'papers' ? 'bg-brand-blue' : 'bg-brand';

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-bento bg-card px-0 pb-0 pt-[26px]',
        className,
      )}
    >
      <h2 className="px-[22px] text-center font-display text-[32px] font-normal leading-[1.04] tracking-[-0.05em] text-foreground">
        {heading}
      </h2>
      <p className="mx-auto mt-[10px] max-w-prose px-[22px] text-center text-[14px] text-warm-secondary">
        {subline}
      </p>

      <div
        ref={domeRef}
        onClick={handleTap}
        role="presentation"
        style={{ borderRadius: '50% 50% 0 0 / 98px 98px 0 0' }}
        className={cn(
          'relative mt-[26px] box-border w-[124%] -mx-[12%] px-[12%] pb-[26px] pt-[34px] transition-colors duration-[850ms] ease-settle motion-reduce:transition-none',
          domeFill,
        )}
      >
        <div className="flex items-center justify-center gap-[22px]">
          <div ref={leftEyeRef}>
            <Eye pupilRef={leftPupilRef} blinking={blinking} lidFill={domeFill} />
          </div>
          <div ref={rightEyeRef}>
            <Eye pupilRef={rightPupilRef} blinking={blinking} lidFill={domeFill} />
          </div>
        </div>

        <div className="mt-6 flex flex-col items-center px-5 text-center">
          <div
            role="tablist"
            aria-label="Search mode"
            /* grid-cols-2: same fix as the hero toggle — flex sized each
               segment to its own label, so "Teachers" (92px) and "Past
               papers" (111px) were visibly different pills. */
            className="grid h-11 grid-cols-2 items-center gap-1 rounded-full p-1"
            /* D1.1: was a hard-coded rgba(31,31,31,.14). --foreground is
               defined as bare HSL components (0 0% 12.2%, i.e. #1F1F1F), so
               hsl(var(--foreground) / alpha) is the token-backed equivalent
               rather than a second, independent near-black. Not a Tailwind
               `/opacity` class -- tailwind.config.ts's `foreground` entry has
               no `<alpha-value>` placeholder, so that modifier silently emits
               nothing here (CLAUDE.md's documented gotcha). */
            style={{ backgroundColor: 'hsl(var(--foreground) / 0.14)' }}
          >
            {(['teachers', 'papers'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => onModeChange(m)}
                className={cn(
                  'tap-44 flex h-9 items-center justify-center rounded-full px-4 text-[14px] font-bold transition-colors duration-500',
                  /* This pair sits on the panel's own tinted fill, so the
                     ring needs an offset in that fill rather than the page
                     background, or it reads as a halo with a gap. D11.3: a
                     fixed brand-blue ring read fine on the orange (teachers)
                     dome but was blue-on-blue -- close to invisible -- on the
                     papers dome. White-on-blue is the same pairing Index.tsx's
                     own "Browse past papers" CTA already uses on the same
                     bg-brand-blue fill. */
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
                  mode === 'papers'
                    ? 'focus-visible:ring-white focus-visible:ring-offset-brand-blue'
                    : 'focus-visible:ring-brand-blue focus-visible:ring-offset-transparent',
                  /* Inactive labels carry no alpha. text-[rgba(31,31,31,.7)]
                     on the orange fill measured 3.29:1, and this is a real
                     role="tab" control label, not decoration. The active tab
                     is already distinguished by its bg-panel pill, so the
                     inactive one does not need to be faded to read as
                     inactive. */
                  mode === m ? 'bg-panel text-background' : mode === 'papers' ? 'text-white' : 'text-brand-foreground',
                )}
              >
                {m === 'teachers' ? 'Teachers' : 'Past papers'}
              </button>
            ))}
          </div>

          <SentenceBuilder
            mode={mode}
            slots={slots}
            onChange={onSlotChange}
            onSubmit={onSubmit}
            count={count}
            className="mt-[18px] items-center text-center [&_p]:justify-center [&_p]:text-[26px] [&_p]:font-black [&_p]:leading-[1.25] [&_p]:tracking-[-0.03em] [&_p]:text-card"
          />

          {hint && (
            /* Follows the dome, which is the whole point: this was a fixed
               rgba(31,31,31,.55) while domeFill above already switches between
               bg-brand and bg-brand-blue, so on the papers side dark ink sat on
               indigo and measured 1.96:1 — unreadable. Dark on orange, light on
               indigo, both at full opacity rather than an alpha that eats the
               ratio it was picked for. */
            <p
              className={cn(
                'mt-3 text-[12px] font-bold uppercase tracking-wide',
                mode === 'papers' ? 'text-white' : 'text-brand-foreground',
              )}
            >
              {hint}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export { EyesPanel };
