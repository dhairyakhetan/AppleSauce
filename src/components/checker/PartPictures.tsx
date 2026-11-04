import { useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { noPictureLine, type PartPicture } from '@/lib/checker-pictures';

/* The right-hand column of the verify screen when the question has parts: the
   whole question's printed pictures, one tile per part, in the same order as the
   typed words on the left (owner change request #110: "show me entire question
   with indiv pictures for each subpart"). The tile for the part the highlight pair
   is on gets the same orange ring as the left card; the rest are calm.

   Pure presentation. The screen signs the links and owns the focus; tapping a tile
   only moves the view (see focusedPartId in checker-pictures.ts). */

export function PartPictures({
  parts,
  urls,
  focusId,
  onFocus,
  onEnlarge,
  onCurrentFailed,
}: {
  parts: PartPicture[];
  /** id -> signed link: undefined while on the way, null when missing or failed. */
  urls: Record<string, string | null | undefined>;
  /** The row the highlight pair is on. */
  focusId: string;
  /** Move the highlight pair here (a view aid only). */
  onFocus: (id: string) => void;
  onEnlarge: (src: string, alt: string) => void;
  /** The checked part's own picture would not load (the screen then falls back to the page). */
  onCurrentFailed?: () => void;
}) {
  return (
    <div className="flex flex-col gap-3" data-testid="part-pictures" role="group" aria-label="The printed pictures, part by part">
      {parts.map((p) => (
        <PartPictureTile
          key={p.id}
          part={p}
          url={p.path ? urls[p.id] : null}
          focused={p.id === focusId}
          onFocus={() => onFocus(p.id)}
          onEnlarge={onEnlarge}
          onFailed={p.current ? onCurrentFailed : undefined}
        />
      ))}
    </div>
  );
}

function PartPictureTile({
  part,
  url,
  focused,
  onFocus,
  onEnlarge,
  onFailed,
}: {
  part: PartPicture;
  url: string | null | undefined;
  focused: boolean;
  onFocus: () => void;
  onEnlarge: (src: string, alt: string) => void;
  onFailed?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : url;
  const alt = part.isParent ? 'the printed question' : `the printed ${part.label}`;
  const hasPicture = Boolean(src);
  // First tap moves the highlight pair here; a tap on the picture that already has it enlarges it.
  const onClick = () => {
    if (!focused) onFocus();
    else if (src) onEnlarge(src, alt);
  };
  return (
    <div
      data-testid="part-picture"
      data-part-id={part.id}
      data-focused={focused ? 'true' : undefined}
      data-checked={part.current ? 'true' : undefined}
      data-has-picture={hasPicture ? 'true' : 'false'}
      style={part.isParent ? undefined : { marginLeft: Math.min(Math.max(part.depth - 1, 0), 3) * 12 }}
      className={cn(
        'rounded-[6px] border-2 p-2 transition-shadow duration-150',
        focused ? 'border-brand ring-2 ring-brand/30' : 'border-warm-hairline',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        data-enter-passes="true"
        aria-pressed={focused}
        aria-label={focused && src ? `Enlarge the printed picture of ${part.label}` : `Show ${part.label}`}
        className={cn(
          'flex w-full min-w-0 flex-col gap-1.5 rounded-[4px] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
          focused && src ? 'cursor-zoom-in' : 'cursor-pointer',
        )}
      >
        {/* The enlarge icon lives in this row, never on the picture: a one-line question ends at the
            top-right corner of its picture, and an icon there hid its last word. */}
        <span className="flex items-center justify-between gap-2">
          <span className={cn('text-[12px] font-semibold', focused ? 'text-foreground' : 'text-warm-meta')}>{part.label}</span>
          {focused && src ? (
            <span aria-hidden="true" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
              <Maximize2 className="h-3.5 w-3.5" />
            </span>
          ) : null}
        </span>
        {url === undefined && part.path ? (
          <span className="block h-20 animate-pulse rounded-[4px] bg-muted" aria-label="Loading the picture" />
        ) : src ? (
          <span className="relative block self-center">
            <img
              src={src}
              alt={alt}
              onError={() => {
                setFailed(true);
                onFailed?.();
              }}
              className="mx-auto block h-auto max-w-full"
            />
          </span>
        ) : (
          <span data-testid="no-part-picture" className="block rounded-[4px] bg-muted px-3 py-2 text-[13px] text-warm-secondary">
            {noPictureLine(part.label)}
          </span>
        )}
      </button>
    </div>
  );
}
