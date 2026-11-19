import { useState, type Ref } from 'react';
import { cn } from '@/lib/utils';
import { swapsSides, type PageRotation } from '@/lib/page-rotation';

/** Until the picture has loaded its shape is not known; a stored scan is roughly this tall and narrow. */
const FALLBACK_SHAPE = { width: 0.77, height: 1 };

/**
 * A page picture shown upright. With turn 0 it is the plain picture, exactly
 * as before. With 90, 180 or 270 the picture is turned that many degrees
 * clockwise, and for 90 and 270 the box it takes up is swapped, so the page
 * lays out as the upright page and a box drawn over it (as fractions of the
 * upright page) lines up. The caller owns the box and any scrolling.
 *
 *  - className       the picture itself, for turn 0 and 180 (a 180 turn keeps the same box)
 *  - stageClassName  the frame that gives a 90 or 270 turn its upright shape
 */
export function UprightImage({
  src,
  alt,
  rotation = 0,
  onLoad,
  onError,
  onClick,
  className,
  stageClassName,
  imageRef,
}: {
  src: string;
  alt: string;
  rotation?: PageRotation;
  onLoad?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
  onError?: () => void;
  onClick?: () => void;
  className?: string;
  stageClassName?: string;
  imageRef?: Ref<HTMLImageElement>;
}) {
  // The stored picture's own shape, once loaded: a turn of 90 or 270 needs it to size the frame.
  const [shape, setShape] = useState<{ src: string; width: number; height: number } | null>(null);
  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = e.currentTarget;
    if (naturalWidth > 0 && naturalHeight > 0) setShape({ src, width: naturalWidth, height: naturalHeight });
    onLoad?.(e);
  };

  if (!swapsSides(rotation)) {
    return (
      <img
        ref={imageRef}
        key={src}
        src={src}
        alt={alt}
        onError={onError}
        onLoad={handleLoad}
        onClick={onClick}
        draggable={false}
        data-rotation={rotation}
        className={className}
        style={rotation === 180 ? { transform: 'rotate(180deg)' } : undefined}
      />
    );
  }

  const known = shape && shape.src === src ? shape : null;
  const stored = known ?? FALLBACK_SHAPE;
  // The stored picture is stored.width wide and stored.height tall; turned a quarter it is stored.height wide and
  // stored.width tall. The frame has that upright shape, and the picture inside is as wide as the frame is tall.
  return (
    <div
      className={cn('relative', stageClassName)}
      style={{ aspectRatio: `${stored.height} / ${stored.width}` }}
      data-testid="upright-stage"
      data-rotation={rotation}
    >
      <img
        ref={imageRef}
        key={src}
        src={src}
        alt={alt}
        onError={onError}
        onLoad={handleLoad}
        onClick={onClick}
        draggable={false}
        className="absolute left-1/2 top-1/2 block h-auto max-w-none"
        style={{
          width: `${(stored.width / stored.height) * 100}%`,
          transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
        }}
      />
    </div>
  );
}
