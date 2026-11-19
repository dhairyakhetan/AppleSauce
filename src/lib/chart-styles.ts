/* One recipe for the site's "charts" (tactile design pass, stage 2, 12 Nov
   2026). The site has no chart library: its charts are plain coloured bars
   (progress, trust, per-paper, per-kind) and stat tiles. They share this.

   A chart sits on a raised card (the card edge from stage 1, shadow-card). The
   bar's track is a shallow well cut into that card: a hairline ring all round
   and a short shade under the top lip, so the coloured fill reads as something
   poured into a channel. The track keeps whatever background its card gives it
   (bg-card on a grey card, bg-muted on a white panel); only the well is shared.

   Hue carries meaning only: brand orange is "in progress", emerald is "done",
   as it already was. Nothing here animates a figure. */

/** The sunk edge of a bar's track. Add it next to the track's own background and radius. */
export const BAR_WELL = 'shadow-[inset_0_1px_1px_0_rgb(var(--shadow-ink)/0.14),inset_0_0_0_0.5px_rgb(var(--shadow-ink)/0.10)]';

/** A stat tile: the number first (24/32), its label directly under it (13/20), on a raised card.
 *  The label stays first in the page's reading order; flex-col-reverse only changes what is drawn first. */
export const FIGURE_TILE_BASE = 'flex flex-col-reverse rounded-2xl px-4 py-3 shadow-card';
export const FIGURE_TILE = `${FIGURE_TILE_BASE} bg-muted`;
export const FIGURE_NUMBER = 'text-[24px] font-bold leading-8 tabular-nums text-foreground';
export const FIGURE_LABEL = 'text-[13px] font-semibold leading-5 text-warm-secondary';
