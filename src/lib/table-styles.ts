/* One recipe for every table on the site (tactile design pass, stage 2,
   12 Nov 2026). Class strings, so Tailwind sees them and every table reads the
   same: a hairline frame with the table's one-pixel drop under it, 0.5px rules
   and column dividers, a quiet header, an ink step down for the body cells.

   Two kinds of table use it:
     - a table that sits on the page by itself (the HOD Verifiers table): it
       draws its own frame, TABLE_FRAME.
     - a table that sits inside a panel that is already the raised card (every
       admin list): the panel is the frame, so only the rules, header, ink and
       row behaviour apply. A second border would be a double border.

   Radius stays the site's 16px (rounded-2xl), the same as the grey cards next
   to a table, not the 8px of the design skill: a table beside 16px cards with
   8px corners would be the odd one out. */

/** The frame of a table that sits on the page on its own. */
export const TABLE_FRAME = 'rounded-2xl border-[0.5px] border-warm-hairline-strong bg-muted shadow-table';

/** A rule between two rows (the top of a row). The last row's bottom has none: the frame is the only bottom line. */
export const TABLE_ROW_RULE = 'border-t-[0.5px] border-warm-hairline-strong';

/** A divider between two columns (the left of a cell that is not in the first column). */
export const TABLE_COLUMN_RULE = 'border-l-[0.5px] border-warm-hairline-strong';

/** The header label: small, tracked capitals as the site already has them, but in the secondary ink (5:1), not the quaternary one that missed 4.5:1. */
export const TABLE_HEAD_LABEL = 'text-[12px] font-bold uppercase tracking-[.04em] text-warm-secondary';

/** A row you press to open something: the card-level squeeze, but not while a button inside the row is the thing being pressed. */
export const TABLE_ROW_PRESS =
  'transition-[background-color,transform] duration-150 [&:active:not(:has(button:active))]:scale-press-card';
