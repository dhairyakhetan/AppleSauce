import { cn } from '@/lib/utils';

/* Class strings for the checker's chips and buttons, shared by the checker,
   the practice round and the help page so they look and press the same. Pure
   strings: the practice round imports this, so it stays clear of Supabase.

   Tactile layer (12 Nov 2026): every button here wears the shared edge (a ring
   plus a crisp 1px drop: `shadow-button` for a neutral or tinted fill,
   `shadow-solid` for a saturated one, whose edge is a darker shade of its own
   colour) and the shared press (`active:scale-press`, .97 in 150ms; the chip is
   a smaller target and squeezes a little more). Keyboard focus is the one
   `ring-focus` colour, not orange: orange on the cream page is 2.3:1, under the
   3:1 a focus ring needs. */

export const CHIP =
  'tap-44 inline-flex items-center rounded-full px-3 py-1.5 text-[13px] font-semibold shadow-button transition-[transform,box-shadow] duration-150 active:scale-press-small focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus';

export type ActionTone = 'mint' | 'dark' | 'brand' | 'muted' | 'outline';

const ACTION_BUTTON_CLASS =
  'tap-44 inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-[15px] sm:px-5 sm:py-3 font-bold transition-[transform,box-shadow] duration-150 active:scale-press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 disabled:opacity-disabled disabled:active:scale-100';

const TONE_CLASS: Record<ActionTone, string> = {
  mint: 'bg-mint text-foreground shadow-button',
  dark: 'bg-panel text-background shadow-solid',
  brand: 'bg-brand text-foreground shadow-solid [--tactile-edge:var(--brand-deep)]',
  muted: 'bg-muted text-warm-secondary shadow-button',
  // Ask the HOD on the verify screen: an orange outline, the quietest way to say "not for me".
  outline: 'border-2 border-brand bg-card text-foreground hover:bg-brand-subtle',
};

export function actionToneClass(tone: ActionTone): string {
  return cn(ACTION_BUTTON_CLASS, TONE_CLASS[tone]);
}

/** The icon-and-label row inside an action button, so every button of the bar lines up the same way. */
export const ACTION_ICON_CLASS = 'h-[18px] w-[18px] shrink-0';
