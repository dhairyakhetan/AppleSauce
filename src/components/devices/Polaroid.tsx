import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Device F — Polaroid / taped photo.
 * Reference: Linkedist (pinned polaroids), Aiman portfolio (paperclipped photo).
 *
 * A photo in a thick white frame with a caption strip below it, rotated a
 * few degrees, "held" by a strip of tape (composes with the existing `.tape`
 * utility in `src/index.css`).
 *
 * ⚠️ LOUD-SURFACE-ONLY DEVICE (VISUAL_DIRECTION.md §4). The rotation + tape
 * treatment is a first-fold/moment device, not a comparison-surface one.
 * Use it on the home featured-teacher strip, About, and success moments.
 * **Never** place this inside the Browse grid or any scrollable comparison
 * list — those surfaces must stay crisp/un-rotated per §4, and a grid of
 * independently-tilted polaroids is unreadable/unscannable at a glance.
 */
export interface PolaroidProps {
  /** Photo URL. */
  src: string;
  /** Required alt text for the photo itself — the frame/tape chrome around it is aria-hidden. */
  alt: string;
  /** Caption shown in the strip below the photo, e.g. a teacher's name. */
  caption?: ReactNode;
  /** Rotation in degrees. Keep within ±8 per the reference grammar. */
  tilt?: number;
  /** How the photo is "held" onto its surface. */
  hold?: 'tape' | 'tape-corner-left' | 'tape-corner-right' | 'pin' | 'none';
  /** Rendered width in px; height follows a 4:5 photo aspect inside the frame. */
  width?: number;
  className?: string;
}

export function Polaroid({
  src,
  alt,
  caption,
  tilt = -4,
  hold = 'tape',
  width = 180,
  className,
}: PolaroidProps) {
  const tapeClass =
    hold === 'tape' ? 'tape' : hold === 'tape-corner-left' ? 'tape tape--corner-left' : hold === 'tape-corner-right' ? 'tape tape--corner-right' : undefined;

  return (
    <figure
      className={cn('relative inline-block bg-card p-3 pb-4 shadow-md', className)}
      style={{
        width,
        transform: `rotate(${tilt}deg)`,
        boxShadow: '0 8px 20px -6px rgba(0,0,0,0.25)',
      }}
    >
      {tapeClass && <span aria-hidden="true" className={tapeClass} />}
      {hold === 'pin' && (
        <span
          aria-hidden="true"
          className="absolute left-1/2 top-[-8px] h-4 w-4 -translate-x-1/2 rounded-full border-2 border-white shadow"
          style={{ background: 'hsl(var(--brand))' }}
        />
      )}
      <div className="overflow-hidden bg-muted" style={{ aspectRatio: '4 / 5' }}>
        <img src={src} alt={alt} className="h-full w-full object-cover" loading="lazy" />
      </div>
      {caption !== undefined && (
        <figcaption className="mt-2 truncate text-center font-display text-sm font-semibold text-foreground">
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
