import type { CSSProperties, ReactNode } from 'react';
import { X } from 'lucide-react';
import type { SearchMode } from '@/utils/searchFacets';

/**
 * The applied-filter row shared by Browse (teachers) and PastPapers (papers).
 * Purely presentational: callers own the URL-param state (q, filter_subjects,
 * filter_classes, filter_boards, filter_areas, filter_schools) and pass in
 * already-resolved chip labels + removal handlers.
 *
 * DESIGN_SYSTEM.md §11: on mobile this is a horizontal snap-scroll row, never
 * wrapped into ragged rows. Every chip is a 44px-minimum tap target.
 */

export interface FilterChipItem {
  /** Stable, unique key for this chip's value (e.g. `subjects:Maths`). */
  key: string;
  /** Display label — copy is owned by the caller, rendered verbatim. */
  label: string;
  /** Removes only this value. */
  onRemove: () => void;
}

export interface FilterChipsHandoff {
  /** Full button copy, e.g. "See papers instead →" — owned by the caller. */
  label: string;
  onClick: () => void;
}

export interface FilterChipsProps {
  /** Current page's search mode — drives the value-chip tint pair. The handoff button (if any) uses the *other* mode's tint automatically. */
  mode: SearchMode;
  /** One chip per selected filter value. */
  chips: FilterChipItem[];
  /** Shown only when chips.length > 0. */
  onClearAll?: () => void;
  /** Right-aligned cross-mode handoff button (e.g. "See papers with these filters"). Omit to hide. */
  handoff?: FilterChipsHandoff;
  /** Optional one-sentence note under the row naming what carries over on handoff (Browse only per spec). */
  carryOverNote?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/* Handoff B-009: applied chips are subject-tinted, not solid — an applied
   filter reads as a tint pill (matching the chip tone matrix's facet-on /
   facet-on-papers pair, S-006), not the saturated mode accent. */
const SELECTED_TINT: Record<SearchMode, string> = {
  teachers: 'bg-brand-subtle text-brand-deep',
  papers: 'bg-brand-blue-subtle text-brand-blue-deep',
};


export function FilterChips({
  mode,
  chips,
  onClearAll,
  handoff,
  carryOverNote,
  className,
  style,
}: FilterChipsProps) {
  const hasRow = chips.length > 0 || Boolean(handoff);
  if (!hasRow) return null;

  /* Handoff B-009: h44, px-[14px], 13.5px trailing X; Clear all bg-muted/text-warm-secondary. */
  const pillBase = `flex h-11 flex-none snap-start items-center whitespace-nowrap rounded-full px-[14px] text-[14px] font-medium transition-[color,background-color,transform] duration-tap ease-tap active:scale-[0.96] motion-reduce:active:scale-100 ${FOCUS}`;

  return (
    <div className={className} style={style}>
      <div className="flex snap-x items-center gap-2 overflow-x-auto scrollbar-hide sm:flex-wrap sm:overflow-visible">
        {/* Every applied chip wears the MODE's selected tint, orange on the
            teachers surface and indigo on papers. Subject chips used to paint
            themselves in the subject palette's saturated `solid` instead, so
            filtering by English produced a fully saturated teal pill sitting
            where the reader expects the site's own "this is on" colour, and
            a second accent on a page whose accent is orange. Subject colour
            still belongs on cards and covers; it does not belong on a control
            whose whole job is to say "selected". */}
        {chips.map((chip) => {
          return (
            <button
              key={chip.key}
              type="button"
              onClick={chip.onRemove}
              aria-label={`Remove filter ${chip.label}`}
              className={`${pillBase} gap-2 ${SELECTED_TINT[mode]}`}
            >
              <span className="max-w-[12rem] truncate">{chip.label}</span>
              <X className="h-[13px] w-[13px] flex-none opacity-70" aria-hidden="true" />
            </button>
          );
        })}

        {chips.length > 0 && onClearAll && (
          <button
            type="button"
            onClick={onClearAll}
            className={`${pillBase} bg-muted font-semibold text-warm-secondary hover:text-foreground`}
          >
            Clear all
          </button>
        )}

        {handoff && (
          <div className="ml-auto flex flex-none items-center gap-2">
            <button
              type="button"
              onClick={handoff.onClick}
              className={`${pillBase} bg-panel font-bold text-background`}
            >
              {handoff.label}
            </button>
          </div>
        )}
      </div>

      {carryOverNote && <p className="mt-2 text-sm text-muted-foreground">{carryOverNote}</p>}
    </div>
  );
}
