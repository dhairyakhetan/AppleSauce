import { cn } from '@/lib/utils';

/**
 * Device S — Cut-paper shapes.
 * Reference: jazz spring, All That Jazz, dröm, PLAYBOOK, Fusion.
 *
 * Flat, irregular, hand-cut organic shapes — blob, star, squiggle — in
 * saturated color with a heavy outline. Needed because VISUAL_DIRECTION.md
 * §9a rules imagery "illustration-first": use these as accent marks behind a
 * teacher with no photo, in empty states, onboarding, 404, About, and
 * subject-card accents.
 */
export interface CutPaperShapeProps {
  variant?: 'blob' | 'star' | 'squiggle';
  /** Any CSS color — a token or `getSubjectPalette().solid`. */
  color?: string;
  /** Rendered size in px (square viewBox). */
  size?: number;
  /** Adds the shared heavy black outline. */
  outlined?: boolean;
  className?: string;
}

const PATHS: Record<NonNullable<CutPaperShapeProps['variant']>, string> = {
  blob: 'M43.8,-58.6C55.6,-49.8,63.1,-34.9,66.4,-19.1C69.7,-3.3,68.8,13.4,61.6,27.1C54.5,40.8,41.1,51.5,26.2,58.1C11.3,64.7,-5.1,67.2,-20.9,63.5C-36.7,59.8,-51.9,49.9,-60.8,35.7C-69.7,21.5,-72.3,3,-68.5,-13.7C-64.7,-30.4,-54.5,-45.3,-40.9,-54.2C-27.3,-63.1,-13.7,-66,1.6,-68.1C16.8,-70.2,33.7,-71.6,43.8,-58.6Z',
  star: 'M50,3 L61,35 L96,35 L67,55 L78,88 L50,68 L22,88 L33,55 L4,35 L39,35 Z',
  squiggle:
    'M4,50 C4,20 20,20 30,35 C40,50 45,68 55,55 C65,42 65,15 78,15 C90,15 96,35 96,50',
};

export function CutPaperShape({
  variant = 'blob',
  color = 'hsl(var(--brand))',
  size = 96,
  outlined = true,
  className,
}: CutPaperShapeProps) {
  const isOpenPath = variant === 'squiggle';
  return (
    <svg
      viewBox="-10 -10 120 120"
      width={size}
      height={size}
      aria-hidden="true"
      className={cn('flex-none', className)}
    >
      <path
        d={PATHS[variant]}
        fill={isOpenPath ? 'none' : color}
        stroke={outlined ? 'hsl(var(--foreground))' : isOpenPath ? color : 'none'}
        strokeWidth={isOpenPath ? 6 : outlined ? 3 : 0}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
