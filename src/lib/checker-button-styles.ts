import { cn } from '@/lib/utils';

/* Class strings for the checker's chips and buttons, shared by the checker,
   the practice round and the help page so they look and press the same. Pure
   strings: the practice round imports this, so it stays clear of Supabase. */

export const CHIP =
  'tap-44 inline-flex items-center rounded-full px-3 py-1.5 text-[13px] font-semibold transition-transform duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';

export type ActionTone = 'mint' | 'dark' | 'brand' | 'muted';

const ACTION_BUTTON_CLASS =
  'tap-44 rounded-full px-4 py-2.5 text-[15px] sm:px-5 sm:py-3 font-bold transition-transform duration-150 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50 disabled:active:scale-100';

const TONE_CLASS: Record<ActionTone, string> = {
  mint: 'bg-mint text-foreground',
  dark: 'bg-panel text-background',
  brand: 'bg-brand text-foreground',
  muted: 'bg-muted text-warm-secondary',
};

export function actionToneClass(tone: ActionTone): string {
  return cn(ACTION_BUTTON_CLASS, TONE_CLASS[tone]);
}
