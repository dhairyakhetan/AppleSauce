/* One recipe for everything that floats over the page (tactile design pass,
   stage 3, 12 Nov 2026): menus, selects, popovers, tooltips, dialogs, sheets and
   the dim behind them. Class strings, so Tailwind sees them and every overlay
   reads the same. The shared primitives (src/components/ui/*) and the few
   hand-built overlays all build from these.

   The surface is the raised card colour with the overlay shadow. The shadow's
   ring is the edge, so an overlay has no border (a border plus the ring would be
   a double edge). The motion lives in src/index.css ("Overlay motion"): the
   .overlay-* classes below only name which one to play.

   What stayed the site's own (see STAGE3_REPORT.md): the dim behind a dialog or
   sheet is the site's 45% near-black with no blur (Handoff O-001 rule 2: a blur
   repaints the page behind it on every scroll frame); a sheet keeps its 30px top
   corners and a dialog its own 20 to 28px corners; a popover keeps its 24px
   corners (Handoff O-008/O-009); a menu item is 40px with a mouse (the site's pointer
   floor), not the skill's 36. Menus are 8px. */

/** The dim behind a dialog or a sheet. */
export const SCRIM = 'overlay-scrim fixed inset-0 z-50 bg-[#1B1A18]/45';

/** The dim behind a hand-built dialog that is not Radix (plays on mount only). */
export const SCRIM_ENTER = 'overlay-enter-scrim bg-[#1B1A18]/45';

/** A menu or a select list: raised card colour, 8px corners, the menu shadow, 4px inside. Opens from its trigger. */
export const MENU_SURFACE =
  'overlay-menu z-50 min-w-[8rem] overflow-hidden rounded-[8px] bg-popover p-1 text-popover-foreground shadow-menu origin-[var(--radix-popper-transform-origin)]';

/** Items sit 2px apart (the menu is a column with this gap). */
export const MENU_GAP = 'flex flex-col gap-[2px]';

/** A menu item: 40px with a mouse, 44px on a phone, its own fill fades in and out where it is. Never one highlight that slides.
 *  The design skill says 36px, but the site's own floor for a pointer is 40px (CRAFT.md section 4, handoff C-013), so the site wins. */
export const MENU_ITEM =
  'relative flex min-h-11 w-full cursor-default select-none items-center rounded-[6px] px-2.5 py-1.5 text-sm text-popover-foreground outline-none transition-colors duration-150 md:min-h-10 data-[disabled]:pointer-events-none data-[disabled]:opacity-disabled data-[highlighted]:bg-muted';

/** The chosen item: two steps above the menu (one above the highlight), with no tick. Hovering it keeps it chosen. */
export const MENU_ITEM_CHOSEN =
  'data-[state=checked]:bg-accent data-[state=checked]:data-[highlighted]:bg-accent';

/** A group label inside a menu. */
export const MENU_LABEL = 'px-2.5 py-1.5 text-[13px] font-semibold text-warm-secondary';

/** A separator inside a menu: it runs edge to edge. */
export const MENU_SEPARATOR = '-mx-1 my-1 h-px bg-warm-hairline';

/** The chevron of a menu trigger: turns over while the menu is open. Put it on the icon; the trigger carries data-state. */
export const MENU_CHEVRON = 'overlay-chevron transition-transform duration-150 ease-out group-data-[state=open]:rotate-180';

/** An info popover. Keeps the site's 24px corners (Handoff O-008/O-009); the shadow and the arrival are the shared ones. */
export const POPOVER_SURFACE =
  'overlay-menu z-50 w-72 rounded-[24px] bg-card p-2 text-popover-foreground shadow-popover outline-none origin-[var(--radix-popper-transform-origin)]';

/** A tooltip: the small menu surface. It names an action, so it has no delay (set on the provider). */
export const TOOLTIP_SURFACE =
  'overlay-menu z-50 overflow-hidden rounded-[8px] bg-popover px-3 py-1.5 text-[13px] text-popover-foreground shadow-popover origin-[var(--radix-popper-transform-origin)]';

/** A dialog's card: the overlay surface with the modal shadow, no border. Arrives in 240ms with a 16px rise. */
export const MODAL_SURFACE = 'overlay-modal bg-card shadow-modal';

/** A dialog that is not Radix (plays on mount only). */
export const MODAL_ENTER = 'overlay-enter-modal bg-card shadow-modal';

/** A sheet: the same surface and shadow, and it slides from its own side (up 320ms, down 200ms from the bottom). */
export const SHEET_SURFACE = 'bg-card shadow-modal';
export type SheetSide = 'top' | 'bottom' | 'left' | 'right';
export const SHEET_MOTION: Record<SheetSide, string> = {
  top: 'overlay-sheet-top',
  bottom: 'overlay-sheet-bottom',
  left: 'overlay-sheet-left',
  right: 'overlay-sheet-right',
};

/** Dialog and sheet footers: Cancel on the left and the confirm on the right; on a phone the confirm goes on top, full width, 8px apart. */
export const ACTION_FOOTER = 'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end';
