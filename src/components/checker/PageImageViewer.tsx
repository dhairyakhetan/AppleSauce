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
}: {
  src: string;
  alt: string;
  note: string;
  onError: () => void;
  /** The question's `source` (page, bbox, dpi ...), for the highlight box. */
  source?: Record<string, unknown> | null;
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
    <div className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 rounded-[12px] bg-brand-subtle px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold leading-snug text-foreground">{note}</p>
          {box ? (
            <p className="mt-0.5 text-[12px] leading-snug text-warm-secondary" data-testid="highlight-note">
              {HIGHLIGHT_NOTE}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Zoom the page">
          <ZoomButton label="Zoom out" disabled={atMin} onClick={() => setZoom((z) => stepZoom(z, 'out'))}>
            -
          </ZoomButton>
          <span className="w-10 text-center text-[12px] tabular-nums text-warm-secondary" aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <ZoomButton label="Zoom in" disabled={atMax} onClick={() => setZoom((z) => stepZoom(z, 'in'))}>
            +
          </ZoomButton>
        </div>
      </div>
      <div
        ref={scroller}
        className="max-h-[56vh] w-full overflow-auto rounded-[10px] border border-warm-hairline bg-white lg:max-h-[68vh]"
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
}: {
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
        'tap-44 flex h-11 w-11 items-center justify-center rounded-full bg-white text-[20px] font-semibold leading-none text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-40',
      )}
    >
      {children}
    </button>
  );
}
