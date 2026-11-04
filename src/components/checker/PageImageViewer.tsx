import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { stepZoom, PAGE_ZOOM_STEPS } from '@/lib/checker-page';
import { HIGHLIGHT_NOTE, questionHighlight, type ImageSize } from '@/lib/checker-highlight';

/**
 * The whole scanned page, zoomable. At zoom 1 the page fits the width of its
 * panel (so at 375px a whole A4 page is readable-small and nothing scrolls
 * sideways); the buttons widen the image and the panel scrolls both ways to
 * pan. Deliberately not pinch-to-zoom on the image itself: that fights the
 * browser's own page zoom on a phone.
 *
 * When the question's position on the page is known and trustworthy
 * (checker-highlight.ts) a box is drawn around it and the panel scrolls to it.
 * When it is not, nothing is drawn and nothing is claimed.
 */
export function PageImageViewer({
  src,
  alt,
  note,
  onError,
  source,
  fill = false,
  onEnlarge,
}: {
  src: string;
  alt: string;
  note: string;
  onError: () => void;
  /** The question's `source` (page, bbox, dpi ...), for the highlight box. */
  source?: Record<string, unknown> | null;
  /** The bento tile: the page fills the tile it is in and pans inside it, instead of growing to a height of its own. */
  fill?: boolean;
  /** Shows an Enlarge button that opens the page full screen. */
  onEnlarge?: () => void;
}) {
  const [zoom, setZoom] = useState<number>(PAGE_ZOOM_STEPS[0]);
  const [size, setSize] = useState<ImageSize | null>(null);
  const atMin = zoom <= PAGE_ZOOM_STEPS[0];
  const atMax = zoom >= PAGE_ZOOM_STEPS[PAGE_ZOOM_STEPS.length - 1];
  const box = useMemo(() => questionHighlight(source, size), [source, size]);
  const scroller = useRef<HTMLDivElement | null>(null);
  const image = useRef<HTMLImageElement | null>(null);

  // A new picture: forget the old picture's size until this one has loaded.
  useEffect(() => {
    setSize(null);
  }, [src]);

  // Bring the box into view inside the panel (never scrolls the whole page),
  // when it appears and each time the zoom changes it.
  useEffect(() => {
    const el = scroller.current;
    const img = image.current;
    if (!box || !el || !img) return;
    const raf = requestAnimationFrame(() => {
      const top = box.top * img.clientHeight;
      const left = box.left * img.clientWidth;
      const boxH = box.height * img.clientHeight;
      const boxW = box.width * img.clientWidth;
      el.scrollTo({
        top: Math.max(0, top - Math.max(16, (el.clientHeight - boxH) / 3)),
        left: Math.max(0, left - Math.max(16, (el.clientWidth - boxW) / 2)),
        behavior: 'auto',
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [box, zoom]);

  return (
    <div className={cn('flex w-full flex-col gap-2', fill && 'h-full min-h-0 flex-1')}>
      <div className={cn('flex items-center gap-2 bg-brand-subtle', fill ? 'shrink-0 rounded-[8px] px-2.5 py-1.5' : 'flex-wrap rounded-[12px] px-3 py-2')}>
        {/* Under 480px the note takes its own line and the zoom buttons wrap under it, so it never squeezes into a four-line column. */}
        <div className="min-w-0 flex-1 [@media(max-width:479px)]:basis-full">
          <p className={cn('font-semibold leading-snug text-foreground', fill ? 'line-clamp-2 text-[13px]' : 'text-[14px]')} title={fill ? note : undefined}>
            {note}
          </p>
          {box ? (
            <p className={cn('mt-0.5 text-[12px] leading-snug text-warm-secondary', fill && 'truncate')} data-testid="highlight-note">
              {HIGHLIGHT_NOTE}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-1 [@media(max-width:479px)]:ml-auto" role="group" aria-label="Zoom the page">
          <ZoomButton small={fill} label="Zoom out" disabled={atMin} onClick={() => setZoom((z) => stepZoom(z, 'out'))}>
            -
          </ZoomButton>
          <span className="w-10 text-center text-[12px] tabular-nums text-warm-secondary" aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <ZoomButton small={fill} label="Zoom in" disabled={atMax} onClick={() => setZoom((z) => stepZoom(z, 'in'))}>
            +
          </ZoomButton>
          {onEnlarge ? (
            <button
              type="button"
              onClick={onEnlarge}
              data-testid="enlarge-page"
              className="tap-44 ml-1 rounded-full bg-white px-3 py-1.5 text-[12px] font-semibold text-foreground transition-transform duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Enlarge
            </button>
          ) : null}
        </div>
      </div>
      <div
        ref={scroller}
        className={cn(
          'w-full overflow-auto border border-warm-hairline bg-white',
          fill ? 'min-h-0 flex-1 rounded-[8px]' : 'max-h-[56vh] rounded-[10px] lg:max-h-[68vh]',
        )}
        tabIndex={0}
        role="region"
        aria-label="The scanned page. Scroll to move around."
      >
        <div className="relative" style={{ width: `${zoom * 100}%` }}>
          <img
            ref={image}
            key={src}
            src={src}
            alt={alt}
            onError={onError}
            onLoad={(e) => setSize({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
            draggable={false}
            className="block h-auto w-full"
          />
          {box ? (
            <div
              aria-hidden="true"
              data-testid="highlight-box"
              className="pointer-events-none absolute rounded-[6px] border-[3px] border-brand bg-brand/15 shadow-[0_0_0_9999px_rgba(27,26,24,0.12)]"
              style={{
                left: `${box.left * 100}%`,
                top: `${box.top * 100}%`,
                width: `${box.width * 100}%`,
                height: `${box.height * 100}%`,
              }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ZoomButton({
  label,
  disabled,
  onClick,
  children,
  small,
}: {
  small?: boolean;
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'tap-44 flex items-center justify-center rounded-full bg-white text-[20px] font-semibold leading-none text-foreground',
        small ? 'h-8 w-8' : 'h-11 w-11',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40',
      )}
    >
      {children}
    </button>
  );
}
