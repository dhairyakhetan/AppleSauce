import type { ReactNode, CSSProperties } from 'react';
import { cn } from '@/lib/utils';

/**
 * Device O — Signpost cluster.
 * Reference: the Hobbies/PASSIONS/Projects signpost, the road-sign sheets.
 * This is the product's metaphor spine (VISUAL_DIRECTION.md §2) — several
 * directional plates stacked on a post, each a different color, each
 * pointing. Not skeuomorphic: plate shape and direction, not photographic
 * road signs.
 *
 * Stacks `.signpost-plate` (index.css) at alternating rotations on a
 * vertical "post" line. Use on subject navigation on home, the 404, empty
 * states, the papers taxonomy.
 */
export interface SignpostPlate {
  key: string;
  label: ReactNode;
  /** Any CSS color — a token or `getSubjectPalette().solid`. */
  color?: string;
  textColor?: string;
  onClick?: () => void;
  href?: string;
}

export interface SignpostClusterProps {
  plates: SignpostPlate[];
  className?: string;
  /** Renders the vertical post line behind the plates. Defaults on. */
  showPost?: boolean;
}

const TILTS = [-2, 1.5, -1, 2.5, -2.5, 1];

export function SignpostCluster({ plates, className, showPost = true }: SignpostClusterProps) {
  return (
    <div className={cn('relative flex flex-col items-start gap-3 py-2', className)}>
      {showPost && (
        <span
          aria-hidden="true"
          className="absolute left-5 top-0 bottom-0 w-1 rounded-full bg-warm-hairline-strong"
        />
      )}
      {plates.map((plate, i) => {
        const Tag = (plate.onClick || plate.href ? 'button' : 'div') as 'button' | 'div';
        return (
          <Tag
            key={plate.key}
            type={Tag === 'button' ? 'button' : undefined}
            onClick={plate.onClick}
            className={cn(
              'signpost-plate relative z-10 ml-2 outline-thick font-display font-bold text-card-title',
              'transition-transform duration-hover',
              (plate.onClick || plate.href) && 'hover:-translate-y-0.5 active:scale-[0.98]'
            )}
            style={{
              background: plate.color ?? 'hsl(var(--brand))',
              color: plate.textColor ?? '#FFFFFF',
              transform: `rotate(${TILTS[i % TILTS.length]}deg)`,
              ['--outline-color' as string]: 'hsl(var(--foreground))',
            } as CSSProperties}
          >
            {plate.label}
          </Tag>
        );
      })}
    </div>
  );
}
