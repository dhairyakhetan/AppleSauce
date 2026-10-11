import * as React from 'react';
import { cn } from '@/lib/utils';

/* "Find a teacher" / "Revise past papers free" felt empty on desktop — a big
   circular mascot face, roughly half the panel, orange for teachers / blue
   for papers, whose eyes track the cursor. First pass tucked this into a tiny
   corner badge; the owner asked for it big and centred instead — a real
   circular face, not a decorative sliver.

   Reuses EyesPanel's own pupil-follow math (distance-normalised offset,
   eased toward target) rather than a second, divergent implementation.

   Desktop only: a touch device has no cursor to follow, and EyesPanel already
   owns the tilt-follow treatment for touch elsewhere on this page.

   Owner spec (mode-driven tiles): the search toggle now drives which of the
   two hero fork panels is "active." The active tile's mascot is awake and
   tracks the pointer, same as before. The inactive one sleeps — eyes closed
   (a lid in the mascot's own fill colour, same trick EyesPanel's dome uses),
   a small looping "Zzz" over its shoulder, and its pointer listener detached
   entirely rather than merely paused. Waking replays a quick blink so the
   switch reads as the character coming to, not a static icon flipping. */

const PUPIL_MAX = 9;
const DISTANCE_NORM = 260;
const EASE_PER_FRAME = 0.2;
/* Lid open/close (asleep <-> awake, "duration-[220ms]" below) is independent
   from the wake blink pulse — same split EyesPanel's own Eye component uses
   (a steady-state transition duration vs. a much shorter blink hold). */
const BLINK_HOLD_MS = 90;
/* How long after waking to let the lid finish opening (220ms above) before
   the "quick blink" flourish plays, so it reads as a second, distinct beat
   rather than interrupting the open. */
const WAKE_BLINK_DELAY_MS = 260;

function usesReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function CornerMascot({
  tone,
  asleep = false,
  compact = false,
}: {
  tone: 'teachers' | 'papers';
  asleep?: boolean;
  /** The inactive tile's own stacked layout (heading on top, mascot pinned
      bottom-right below it) needs a genuinely small face — 64-80px, per the
      owner's review — not just "smaller than the active one." Kept separate
      from `asleep` even though the two currently always match in Index.tsx:
      sizing is a layout concern, sleeping is a behaviour one. */
  compact?: boolean;
}) {
  const reduced = React.useMemo(usesReducedMotion, []);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const leftPupilRef = React.useRef<HTMLDivElement>(null);
  const rightPupilRef = React.useRef<HTMLDivElement>(null);
  const targetRef = React.useRef({ x: 0, y: 0 });
  const currentRef = React.useRef({ x: 0, y: 0 });
  const rafRef = React.useRef<number>();
  const [blinking, setBlinking] = React.useState(false);
  const wasAsleepRef = React.useRef(asleep);

  const settle = React.useCallback(() => {
    if (rafRef.current !== undefined) return;
    const tick = () => {
      const cur = currentRef.current;
      const tgt = targetRef.current;
      const dx = tgt.x - cur.x;
      const dy = tgt.y - cur.y;
      if (Math.abs(dx) > 0.02 || Math.abs(dy) > 0.02) {
        cur.x += dx * EASE_PER_FRAME;
        cur.y += dy * EASE_PER_FRAME;
        const t = `translate(calc(-50% + ${cur.x.toFixed(2)}px), calc(-50% + ${cur.y.toFixed(2)}px))`;
        if (leftPupilRef.current) leftPupilRef.current.style.transform = t;
        if (rightPupilRef.current) rightPupilRef.current.style.transform = t;
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = undefined;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  /* Pointer tracking is fully detached while asleep — not just paused — so a
     sleeping tile costs nothing and never fights the awake one's target. */
  React.useEffect(() => {
    if (reduced || asleep) return;
    function onPointerMove(e: PointerEvent) {
      const root = rootRef.current;
      if (!root) return;
      const r = root.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);
      const scale = Math.min(1, dist / DISTANCE_NORM);
      targetRef.current = {
        x: dist === 0 ? 0 : (dx / dist) * scale * PUPIL_MAX,
        y: dist === 0 ? 0 : (dy / dist) * scale * PUPIL_MAX,
      };
      settle();
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => window.removeEventListener('pointermove', onPointerMove);
  }, [reduced, asleep, settle]);

  React.useEffect(() => () => {
    if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
  }, []);

  /* Falling asleep: stop chasing the cursor and recentre, so the pupils sit
     dead centre (under the now-closed lid) rather than wherever the cursor
     last was — and so waking again starts fresh rather than mid-chase. */
  React.useEffect(() => {
    if (!asleep) return;
    if (rafRef.current !== undefined) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = undefined;
    }
    targetRef.current = { x: 0, y: 0 };
    currentRef.current = { x: 0, y: 0 };
    if (leftPupilRef.current) leftPupilRef.current.style.transform = '';
    if (rightPupilRef.current) rightPupilRef.current.style.transform = '';
  }, [asleep]);

  /* Waking replays one blink once the lid has had time to finish opening —
     the same "come to life" beat EyesPanel's own idle blink gives the
     sentence-builder dome, here fired once on the awake edge instead of on a
     loop. */
  React.useEffect(() => {
    const wasAsleep = wasAsleepRef.current;
    wasAsleepRef.current = asleep;
    if (reduced || asleep || !wasAsleep) return;
    const openTimer = window.setTimeout(() => {
      setBlinking(true);
      window.setTimeout(() => setBlinking(false), BLINK_HOLD_MS);
    }, WAKE_BLINK_DELAY_MS);
    return () => window.clearTimeout(openTimer);
  }, [asleep, reduced]);

  const fill = tone === 'teachers' ? 'bg-brand' : 'bg-brand-blue';
  const eyeWhite = tone === 'teachers' ? 'bg-foreground/[0.14]' : 'bg-white/30';
  /* Teacher vs. student, at a glance: a graduation cap for the teachers
     panel, an open book for the papers/revision one. */
  const badge = tone === 'teachers' ? '🎓' : '📚';

  /* Lid position: closed (asleep or mid-blink), open (awake, steady state),
     or — the optional owner-flagged flourish — half-open on hover while
     asleep, so a stir answers a passing cursor without waking the tile. */
  const lidState = blinking || asleep ? 'translate-y-0' : '-translate-y-full';

  return (
    <div
      ref={rootRef}
      aria-hidden
      /* h-full + aspect-square, not a fixed max-w: the panel's own height
         varies (padding, content length), so sizing off height keeps the
         circle from either looking small in a tall panel or overflowing a
         short one. max-h caps it from getting absurd on a very tall panel. */
      className={cn(
        'group/mascot relative hidden aspect-square h-full w-auto flex-none items-center justify-center gap-4 rounded-full lg:flex',
        /* Compact's own layout is a column (heading on top, mascot pinned
           bottom-right below it via `justify-between` on the full-height
           column) — `self-end` is what pins this face to the right edge of
           that column instead of the left, regardless of the text block's
           own width. Meaningless (and harmless) in the active row layout,
           which has no cross-axis alignment ambiguity to resolve. Kept as a
           class on CornerMascot's own root rather than an extra wrapper div:
           a wrapper with no explicit height broke this component's `h-full`
           percentage sizing entirely (it collapsed to ~16px — the parent's
           height was indeterminate, so `h-full` resolved to auto instead of
           a real number). Staying a direct flex child of the row/column
           keeps that percentage chain intact. */
        compact && 'lg:self-end',
        'lg:transition-[max-height] lg:duration-lift lg:ease-settle',
        /* Both tiles now share one row instead of each getting the full
           panel width, so even the awake face needs to be smaller than the
           standalone-panel 230px it used to render at — and smaller again at
           `lg` (1024-1279) than at `xl`+, or the row is too narrow at 1024
           for a 160px circle to sit beside its own heading without covering
           the tail of it (measured: "Message them" was rendering partly
           under the circle at 1024). The compact tile's face stays inside
           the owner's 64-80px review range at every width — its own layout
           stacks the face under the heading rather than beside it, so it
           never has to shrink further to make room. The size gap between the
           two is itself another awake/asleep cue: the active tile's face is
           visibly bigger. */
        compact ? 'max-h-[68px] xl:max-h-[76px]' : 'max-h-[112px] xl:max-h-[160px]',
        fill,
      )}
    >
      {[leftPupilRef, rightPupilRef].map((ref, i) => (
        <span
          key={i}
          className={`relative h-[30%] w-[22%] shrink-0 overflow-hidden rounded-full ${eyeWhite}`}
        >
          <span
            ref={ref}
            className="absolute left-1/2 top-1/2 h-[46%] w-[46%] rounded-full bg-foreground"
            style={{ transform: 'translate(-50%, -50%)' }}
          >
            {/* Glossy highlight — a flat pupil with no catchlight reads dead,
                not friendly. Fixed to the pupil's own corner, not the cursor-
                tracked wrapper, so it moves with the eye instead of sitting
                static while the pupil slides under it. */}
            <span className="absolute left-[18%] top-[18%] h-[30%] w-[30%] rounded-full bg-white/90" />
          </span>
          {/* Lid: same trick as EyesPanel's dome eyes — a full-bleed span in
              the mascot's own fill colour, resting off-panel and dropping
              down to close. Closed while asleep, open while awake, and a
              hover "stir" (half-open) only ever applies while asleep — an
              awake eye is already fully open, so the hover variant is inert
              for it. */}
          <span
            className={cn(
              'absolute inset-0 transition-transform ease-settle motion-reduce:transition-none',
              blinking ? 'duration-[90ms]' : 'duration-[220ms]',
              fill,
              lidState,
              asleep && !blinking && 'group-hover/mascot:translate-y-1/2 group-hover/mascot:duration-[160ms]',
            )}
          />
        </span>
      ))}

      {/* Corner badge — bare emoji, no coin/disc behind it. The white circle
          read as a UI badge (a notification dot, a status pip) bolted onto
          the face rather than something the face is wearing; dropped for a
          floating "sticker" reading closer to a picked emoji sitting on the
          mascot, per owner review. drop-shadow instead of a card/shadow-
          border backing keeps it legible against the flat fill without
          reintroducing a background shape. Fixed px, not a %-based
          font-size: percent font-sizing resolves off the inherited (body)
          font size, not this box's own dimensions, so it stayed pinned at a
          few px regardless of how big the circle rendered. */}
      <span
        className={cn(
          'absolute bottom-[8%] right-[8%] leading-none transition-[font-size] duration-lift ease-settle [filter:drop-shadow(0_2px_3px_rgb(0_0_0/0.25))]',
          compact ? 'text-[13px]' : 'text-[19px]',
        )}
      >
        {badge}
      </span>

      {/* Sleeping tell: three "z"s drifting up and fading, staggered so they
          read as a loop rather than three identical copies, floating up from
          the mascot's top-right shoulder. Sized (12/15/18px) and coloured for
          real contrast against the tile's own flat fill — the first pass
          used the pupil's own faint ink at every tone, which read fine on
          orange but nearly vanished on the solid blue papers tile; white
          reads clearly there, so the colour is picked per tone rather than
          shared. Always mounted (cheap, aria-hidden, pointer-events-none) and
          driven by opacity alone between asleep/awake so the appear/disappear
          itself is a fade — motion-reduce drops the float loop but keeps the
          Zs visible and static, per spec. */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute -right-1 -top-2 h-12 w-12 transition-opacity duration-[220ms] ease-settle',
          asleep ? 'opacity-100' : 'opacity-0',
        )}
      >
        {[12, 15, 18].map((size, i) => (
          <span
            key={size}
            className={cn(
              'absolute font-black leading-none animate-z-float motion-reduce:animate-none motion-reduce:opacity-90',
              tone === 'papers' ? 'text-white' : 'text-foreground/85',
            )}
            style={{
              right: `${i * 7}px`,
              top: `${8 - i * 9}px`,
              fontSize: `${size}px`,
              animationDelay: `${i * 0.55}s`,
            }}
          >
            z
          </span>
        ))}
      </div>
    </div>
  );
}

export default CornerMascot;
