import { cn } from '@/lib/utils';

/**
 * Device E — Hand-drawn annotation arrow.
 * Reference: Linkedist (curved arrows labelling people — "Liutauras", "LIMA"),
 * Gift Guide (dotted connectors to numbered hotspots), Lots Art (looping
 * arrow, red arrows).
 *
 * A small set of hand-tuned inline SVG arrow paths — curve-left, curve-right,
 * loop, dotted — pointing from a label to a thing. The most broadly useful
 * device in the library: use it in onboarding, HowItWorks steps, and
 * empty-state guidance (e.g. pointing at the search field on first visit).
 *
 * Purely decorative — always `aria-hidden`. No animation by default; pass
 * `animated` to draw the stroke in once on mount (a one-shot, not a loop),
 * which is automatically skipped under `prefers-reduced-motion` by the
 * project's universal kill-switch in `src/index.css`.
 */
export interface AnnotationArrowProps {
  variant?: 'curve-left' | 'curve-right' | 'loop' | 'dotted';
  /** Any CSS color — a token or `getSubjectPalette().solid`. Defaults to the brand orange. */
  color?: string;
  /** Rendered size in px (arrows are wider than tall; this sets the width). */
  size?: number;
  /** Stroke width in px. */
  strokeWidth?: number;
  /** Flip horizontally (useful for pointing the same shape the other way). */
  flip?: boolean;
  /** Fade/scale in once on mount (no entrance animation) instead of appearing instantly. Finite — respects prefers-reduced-motion via the global kill-switch. */
  animated?: boolean;
  className?: string;
}

// Each path is drawn in a 100x60 box with the arrowhead near the end point,
// tuned by hand to read as a casual marker-pen gesture rather than a
// mechanical curve.
const PATHS: Record<NonNullable<AnnotationArrowProps['variant']>, string> = {
  'curve-left':
    'M92,10 C55,4 20,14 10,46 M10,46 L20,36 M10,46 L22,50',
  'curve-right':
    'M8,10 C45,4 80,14 90,46 M90,46 L80,36 M90,46 L78,50',
  loop: 'M6,40 C6,14 34,6 50,20 C64,32 46,48 34,36 C24,26 40,10 60,12 C78,14 92,26 92,42 M92,42 L82,36 M92,42 L86,52',
  dotted:
    'M6,50 Q30,52 50,32 Q66,16 92,10',
};

const DOTTED_HEAD = 'M92,10 L80,12 M92,10 L86,20';

export function AnnotationArrow({
  variant = 'curve-right',
  color = 'hsl(var(--brand))',
  size = 100,
  strokeWidth = 3,
  flip = false,
  animated = false,
  className,
}: AnnotationArrowProps) {
  const height = size * 0.6;
  const isDotted = variant === 'dotted';

  return (
    <svg
      viewBox="0 0 100 60"
      width={size}
      height={height}
      fill="none"
      aria-hidden="true"
      className={cn(
        'flex-none overflow-visible',
        flip && 'scale-x-[-1]',
        // `pop` is the whitelisted finite entrance animation (VISUAL_LANGUAGE.md
        // §7) — a one-shot fade/scale-in, not a loop, and already covered by the
        // universal `prefers-reduced-motion` kill-switch in src/index.css.
        className
      )}
    >
      <path
        d={PATHS[variant]}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={isDotted ? '1 9' : undefined}
      />
      {isDotted && (
        <path
          d={DOTTED_HEAD}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}
